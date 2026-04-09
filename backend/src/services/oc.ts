import { Sandbox } from '@opencomputer/sdk';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { ModelProvider } from '../types/index.js';
import { sendOutput, sendTaskStatus } from './websocket.js';
import { execute, queryOne } from '../db/index.js';

// Secret for signing gateway URLs (use env var or fallback)
const GATEWAY_SECRET = process.env.GATEWAY_SECRET || process.env.SESSION_SECRET || 'gateway-secret-change-me';

// Generate HMAC signature for gateway access
export function generateGatewaySignature(agentId: string): string {
  return crypto.createHmac('sha256', GATEWAY_SECRET).update(agentId).digest('hex').substring(0, 16);
}

// Verify HMAC signature
export function verifyGatewaySignature(agentId: string, signature: string): boolean {
  const expected = generateGatewaySignature(agentId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export interface SandboxInfo {
  id: string;
  url?: string;
}

// Database record for sandbox tracking
interface SandboxRecord {
  id: string;
  session_key: string;
  e2b_sandbox_id: string;
  provider: string;
  status: string;
  created_at: string;
  last_used_at: string;
  expires_at?: string;
}

// Event emitter for streaming terminal output
export const terminalEvents = new EventEmitter();
terminalEvents.setMaxListeners(100); // Allow many concurrent listeners

// Store partial output for polling
const partialOutputs: Map<string, string[]> = new Map();

export function getPartialOutput(sessionId: string): string[] {
  return partialOutputs.get(sessionId) || [];
}

export function clearPartialOutput(sessionId: string): void {
  partialOutputs.delete(sessionId);
}

// OpenComputer snapshot aliases - pre-built on app.opencomputer.dev
// Snapshots have tools pre-installed for faster startup
// Without snapshots configured, tools will be installed at runtime
const SNAPSHOTS: Record<ModelProvider, string | undefined> = {
  'claude-code': process.env.OPENCOMPUTER_SNAPSHOT_CLAUDE_CODE || 'claude-code-agent',
  'aider': process.env.OPENCOMPUTER_SNAPSHOT_AIDER || 'aider-agent',
  'opencode': process.env.OPENCOMPUTER_SNAPSHOT_OPENCODE || 'opencode-agent',
};

// OpenComputer API key
const OC_API_KEY = process.env.OPENCOMPUTER_API_KEY || '';

// Sandbox timeout in seconds - extended on each activity
// 30 minutes base timeout, extended during active command execution
const SANDBOX_TIMEOUT_S = 10; // 10 seconds - aggressive kill for dev

// How often to extend sandbox timeout during active execution (2 minutes)
const KEEP_ALIVE_INTERVAL_MS = 2 * 60 * 1000; // still ms for setInterval

// ============================================
// SANDBOX KEY GENERATION
// ============================================

/**
 * Surface types for sandbox isolation
 * - playground: Owner testing their agent (isolated from SDK users)
 * - portal: Portal visitors (already isolated by portalSessionId)
 * - embed: Embed users (already isolated by embedUserId)
 * - sdk: SDK/API access (can be shared or isolated via sdkSessionId)
 */
export type SandboxSurface = 'playground' | 'portal' | 'embed' | 'sdk';

export interface SandboxKeyContext {
  agentId: string;
  surface: SandboxSurface;
  sdkSessionId?: string;     // For SDK-created isolated sessions
  portalSessionId?: string;  // For Portal (already used as portal-{id})
  embedUserId?: string;      // For Embed (already used as embed-{id})
}

/**
 * Generate a sandbox key based on the surface and context.
 * This determines which sandbox instance will be used.
 * 
 * Keys:
 * - playground: `{agentId}:owner` - Owner testing, separate from SDK
 * - portal: `portal-{portalSessionId}` - Per-visitor isolation
 * - embed: `embed-{embedUserId}` - Per-embed-user isolation
 * - sdk (with session): `{agentId}:sdk:{sdkSessionId}` - Isolated SDK session
 * - sdk (no session): `{agentId}` - Shared default (backward compatible)
 */
export function getSandboxKey(context: SandboxKeyContext): string {
  switch (context.surface) {
    case 'playground':
      return `${context.agentId}:owner`;
    
    case 'portal':
      if (!context.portalSessionId) {
        throw new Error('portalSessionId required for portal surface');
      }
      return `portal-${context.portalSessionId}`;
    
    case 'embed':
      if (!context.embedUserId) {
        throw new Error('embedUserId required for embed surface');
      }
      return `embed-${context.embedUserId}`;
    
    case 'sdk':
      // SDK can optionally have isolated sessions
      return context.sdkSessionId 
        ? `${context.agentId}:sdk:${context.sdkSessionId}`
        : context.agentId;  // Default shared sandbox (backward compatible)
    
    default:
      return context.agentId;
  }
}

export class OCService {
  private sandboxes: Map<string, Sandbox> = new Map();
  private ptysessions: Map<string, any> = new Map(); // Store PTY sessions by sessionId

  async createSandbox(sessionId: string, provider?: ModelProvider): Promise<SandboxInfo> {
    // Use pre-built snapshot if available, otherwise use default
    const snapshotName = provider ? SNAPSHOTS[provider] : undefined;

    console.log(`[Sandbox] Creating sandbox${snapshotName ? ` with snapshot ${snapshotName}` : ' (default)'} with ${SANDBOX_TIMEOUT_S / 60}min timeout`);

    // OpenComputer API: Sandbox.create({ snapshot, timeout, apiKey })
    const sandbox = await Sandbox.create({
      snapshot: snapshotName,
      timeout: SANDBOX_TIMEOUT_S,
      apiKey: OC_API_KEY,
    });

    this.sandboxes.set(sessionId, sandbox);

    // Save to database for reconnection after restarts
    try {
      const expiresAt = new Date(Date.now() + SANDBOX_TIMEOUT_S * 1000).toISOString();
      await execute(
        `INSERT INTO sandboxes (id, session_key, e2b_sandbox_id, provider, status, expires_at)
         VALUES ($1, $2, $3, $4, 'running', $5)
         ON CONFLICT(session_key) DO UPDATE SET 
           e2b_sandbox_id = excluded.e2b_sandbox_id,
           provider = excluded.provider,
           status = 'running',
           last_used_at = NOW(),
           expires_at = excluded.expires_at`,
        [uuidv4(), sessionId, sandbox.sandboxId, provider || 'claude-code', expiresAt]
      );
      console.log(`[Sandbox] Saved sandbox ${sandbox.sandboxId} to database for session ${sessionId}`);
    } catch (error) {
      console.error(`[Sandbox] Failed to save sandbox to database:`, error);
      // Continue anyway - sandbox still works, just won't survive restarts
    }

    return {
      id: sandbox.sandboxId,
    };
  }

  /**
   * Warm up a sandbox for an agent - creates sandbox and installs tools ahead of time
   * This significantly improves first-request performance
   * 
   * If sandbox already exists:
   * - Extends the sandbox lifetime (keepAlive)
   * - Returns status indicating sandbox was already warm
   * 
   * If sandbox doesn't exist:
   * - Creates new sandbox
   * - Installs tools in background
   * - Returns status indicating sandbox was newly created
   */
  async warmupSandbox(agentId: string): Promise<{ 
    success: boolean; 
    sandboxId?: string; 
    status?: 'created' | 'already_warm' | 'extended';
    error?: string;
  }> {
    try {
      console.log(`[Sandbox] Warming up sandbox for agent ${agentId}...`);
      
      // Get agent configuration to determine provider
      const agent = await queryOne<{ provider: string }>(
        'SELECT provider FROM agent_configs WHERE session_id = $1',
        [agentId]
      );
      
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }
      
      const provider = agent.provider as ModelProvider;
      
      // Check if sandbox already exists and is warm
      const existingSandbox = this.sandboxes.get(agentId);
      if (existingSandbox) {
        console.log(`[Sandbox] Sandbox already warm for agent ${agentId}, extending lifetime...`);
        
        // Extend the sandbox lifetime so it stays warm longer
        try {
          await this.keepAlive(agentId);
          console.log(`[Sandbox] Extended lifetime for sandbox ${existingSandbox.sandboxId}`);
          return { 
            success: true, 
            sandboxId: existingSandbox.sandboxId,
            status: 'extended'
          };
        } catch (keepAliveError) {
          // Sandbox might have expired between check and keepAlive
          console.warn(`[Sandbox] Failed to extend sandbox lifetime, will create new one:`, keepAliveError);
          this.sandboxes.delete(agentId);
          // Fall through to create new sandbox
        }
      }
      
      // Create new sandbox
      const sandboxInfo = await this.createSandbox(agentId, provider);
      
      // Install tools in background (don't wait for completion)
      this.installAgentTools(agentId, provider).then(result => {
        if (result.success) {
          console.log(`[Sandbox] Tools installed for warmed sandbox ${sandboxInfo.id}`);
        } else {
          console.warn(`[Sandbox] Failed to install tools for warmed sandbox: ${result.error}`);
        }
      }).catch(error => {
        console.error(`[Sandbox] Error installing tools for warmed sandbox:`, error);
      });
      
      console.log(`[Sandbox] Sandbox ${sandboxInfo.id} warmed up for agent ${agentId}`);
      
      return { 
        success: true, 
        sandboxId: sandboxInfo.id,
        status: 'created'
      };
      
    } catch (error) {
      console.error(`[Sandbox] Failed to warm up sandbox for agent ${agentId}:`, error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Warm up sandboxes for multiple agents in parallel
   */
  async warmupMultipleSandboxes(agentIds: string[]): Promise<{ 
    success: boolean; 
    results: Array<{ agentId: string; success: boolean; sandboxId?: string; error?: string }>;
  }> {
    console.log(`[Sandbox] Warming up sandboxes for ${agentIds.length} agents...`);
    
    const promises = agentIds.map(async (agentId) => {
      const result = await this.warmupSandbox(agentId);
      return { agentId, ...result };
    });
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`[Sandbox] Warmed up ${successCount}/${agentIds.length} sandboxes`);
    
    return {
      success: successCount > 0,
      results
    };
  }

  async installAgentTools(sessionId: string, provider: ModelProvider): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    // Check if tool is already installed (from template)
    // Include common paths where tools might be installed
    const pathSetup = 'export PATH="$HOME/go/bin:$HOME/.local/bin:/usr/local/bin:$PATH"';
    const checkCmd = provider === 'claude-code' ? `${pathSetup} && claude --version`
      : provider === 'aider' ? `${pathSetup} && aider --version`
      : `${pathSetup} && opencode -v`;
    
    const checkResult = await sandbox.exec.run(checkCmd, { timeout: 10 });
    if (checkResult.exitCode === 0) {
      console.log(`[Sandbox] ${provider} already installed (template working)`);
      return { success: true };
    }

    console.log(`[Sandbox] ${provider} not found, installing...`);

    try {
      if (provider === 'claude-code') {
        // Install Node.js and Claude Code CLI
        const installResult = await sandbox.exec.run(
          'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs && sudo npm install -g @anthropic-ai/claude-code',
          { timeout: 300 }
        );
        console.log(`[Sandbox] Claude Code install: exit=${installResult.exitCode}`);
        
        if (installResult.exitCode !== 0) {
          return { success: false, error: `Failed to install Claude Code: ${installResult.stderr?.slice(0, 500)}` };
        }
      } else if (provider === 'aider') {
        // Install Python and Aider with pipx for isolation
        const installResult = await sandbox.exec.run(
          'sudo apt-get update && sudo apt-get install -y python3 python3-pip python3-venv pipx && pipx install aider-chat && pipx ensurepath',
          { timeout: 300 }
        );
        console.log(`[Sandbox] Aider install: exit=${installResult.exitCode}`);
        
        if (installResult.exitCode !== 0) {
          // Fallback to pip with --break-system-packages
          console.log('[Sandbox] pipx failed, trying pip fallback...');
          const fallbackResult = await sandbox.exec.run(
            'pip3 install --break-system-packages aider-chat',
            { timeout: 300 }
          );
          if (fallbackResult.exitCode !== 0) {
            return { success: false, error: `Failed to install Aider: ${fallbackResult.stderr?.slice(0, 500)}` };
          }
        }
      } else if (provider === 'opencode') {
        // Install Go and OpenCode
        const installResult = await sandbox.exec.run(
          'sudo apt-get update && sudo apt-get install -y golang-go && go install github.com/opencode-ai/opencode@latest',
          { timeout: 300 }
        );
        console.log(`[Sandbox] OpenCode install: exit=${installResult.exitCode}`);
        
        if (installResult.exitCode !== 0) {
          // Try downloading binary directly
          console.log('[Sandbox] Go install failed, trying binary download...');
          const binaryResult = await sandbox.exec.run(
            'curl -fsSL https://github.com/opencode-ai/opencode/releases/latest/download/opencode_linux_amd64.tar.gz | tar -xzf - -C /usr/local/bin',
            { timeout: 120 }
          );
          if (binaryResult.exitCode !== 0) {
            return { success: false, error: `Failed to install OpenCode: ${binaryResult.stderr?.slice(0, 500)}` };
          }
        }
      }

      return { success: true };
    } catch (error) {
      console.error(`[Sandbox] Install ${provider} error:`, error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Configure Claude Code settings in the sandbox
   * - Sets up MCP servers via .mcp.json (project-scoped)
   * - Configures settings to auto-enable MCP
   * - System prompt is passed via --append-system-prompt flag
   * - Also generates MCP tool instructions for the system prompt
   * - Adds knowledge base gateway instructions if KB attached
   */
  async configureClaudeSettings(
    sessionId: string,
    options: {
      systemPrompt?: string;
      mcpServers?: Array<{
        id: string;
        name: string;
        transport: 'sse' | 'streamable-http';
        url: string;
        headers?: Record<string, string>;
      }>;
      secrets?: Record<string, string>;
      agentId?: string;  // For knowledge base access
      hasKnowledgeBases?: boolean;  // Whether agent has knowledge bases attached
      gatewayBaseUrl?: string;  // Base URL for gateway APIs (dynamic based on request origin)
      skipFileSystemSetup?: boolean;  // When true, only build the prompt string — skip all sandbox commands (for subsequent messages when sandbox already configured)
    }
  ): Promise<{ success: boolean; systemPrompt?: string; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    try {
      // When skipFileSystemSetup is true, we only need to rebuild the system prompt string.
      // CLAUDE.md, skill files, MCP config, Python libs — all already configured on first setup.
      if (!options.skipFileSystemSetup) {
        // Ensure Python document generation libraries are installed
        // (may not be present in older sandbox templates)
        const checkPython = await sandbox.exec.run(
          'python3 -c "import pptx" 2>&1 && echo "PPTX_OK" || echo "PPTX_MISSING"',
          { timeout: 10 }
        );
        console.log(`[Sandbox] Python pptx check: ${checkPython.stdout?.trim()}`);
        
        if (!checkPython.stdout?.includes('PPTX_OK')) {
          console.log('[Sandbox] Installing Python document libraries...');
          
          // First ensure python3 and pip3 are available
          const pythonCheck = await sandbox.exec.run(
            'which python3 && which pip3 || (sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip)',
            { timeout: 120 }
          );
          console.log(`[Sandbox] Python/pip check: exit=${pythonCheck.exitCode}`);
          
          // Install the document libraries
          const installResult = await sandbox.exec.run(
            'pip3 install --break-system-packages python-pptx openpyxl python-docx 2>&1',
            { timeout: 120 }
          );
          console.log(`[Sandbox] Document libs install: exit=${installResult.exitCode}, output=${installResult.stdout?.slice(0, 200)}`);
          
          // Verify installation
          const verifyResult = await sandbox.exec.run(
            'python3 -c "from pptx import Presentation; print(\'PPTX installed successfully\')"',
            { timeout: 10 }
          );
          console.log(`[Sandbox] PPTX verify: ${verifyResult.stdout?.trim() || verifyResult.stderr?.trim()}`);
        }
      }
      
      // Build enhanced system prompt with MCP tool information
      let enhancedSystemPrompt = '';
      
      // CRITICAL: Add file bucket instructions FIRST so Claude sees them immediately
      const gatewayBaseUrl = options.gatewayBaseUrl || process.env.PUBLIC_URL;
      if (gatewayBaseUrl) {
        enhancedSystemPrompt += `
# ⚠️ CRITICAL FILE CREATION RULES ⚠️

**YOU MUST CREATE ALL USER-FACING FILES IN FILE BUCKETS, NOT IN ~/workspace DIRECTLY!**

## Workspace Layout
- \`~/workspace/skills/\` — Agent skill/instruction files (read-only, do NOT modify)
- \`~/workspace/input/\` — Reference files uploaded by the user (read-only, do NOT modify)
- \`~/workspace/output/\` — Output directory for files YOU create (writable)

**IMPORTANT: Reference files in ~/workspace/input/ are provided by the user for context. Read and use them when relevant to the user's request.**

When creating files for users:
1. **ALWAYS** create files directly in \`~/workspace/output/\` (NOT in a subdirectory under it)
2. **IMMEDIATELY** call notification API after creating each file
3. Tell user the filename only (not the full path)

**File Notification API (REQUIRED after EVERY file creation):**
\`\`\`bash
# Create file directly in output directory
echo "content" > ~/workspace/output/my_file.txt

# Notify immediately (use the bucket name from: ls ~/workspace/output/)
BUCKET=$(basename $(ls -d ~/workspace/output/ 2>/dev/null))
curl -X POST "${gatewayBaseUrl}/api/portal/file-gateway/notify" \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId": "${sessionId}", "sig": "${generateGatewaySignature(sessionId)}", "files": [{"path": "/my_file.txt", "bucketName": "output"}]}'
\`\`\`

---

`;
      }
      
      // Add user's system prompt after the critical instructions
      enhancedSystemPrompt += options.systemPrompt || '';
      
      // Add information about configured environment variables/secrets
      if (options.secrets && Object.keys(options.secrets).length > 0) {
        const secretNames = Object.keys(options.secrets);
        enhancedSystemPrompt += `

# Configured Environment Variables

The following environment variables are pre-configured and available in this session:
${secretNames.map(name => `- \`${name}\``).join('\n')}

You can use these directly in shell commands or code. For example:
- \`echo $${secretNames[0]}\` to access the value
- \`curl -H "Authorization: Bearer $${secretNames[0]}"\` for API calls
`;
        console.log(`[Sandbox] Added ${secretNames.length} secret names to system prompt: ${secretNames.join(', ')}`);
      }
      
      // Add knowledge base gateway instructions if available (reuse gatewayBaseUrl from above)
      if (gatewayBaseUrl && options.agentId && options.hasKnowledgeBases) {
        // Generate HMAC signature for secure gateway access
        const sig = generateGatewaySignature(options.agentId);
        
        enhancedSystemPrompt += `

# Knowledge Base Access

You have access to knowledge bases with relevant documentation and context. Use the Knowledge Base Gateway to search for information:

**List available knowledge bases:**
\`\`\`bash
curl -s "${gatewayBaseUrl}/api/kb-gateway/list?agentId=${options.agentId}&sig=${sig}"
\`\`\`

**Search for relevant information:**
\`\`\`bash
curl -s "${gatewayBaseUrl}/api/kb-gateway/search?agentId=${options.agentId}&sig=${sig}&query=YOUR_SEARCH_QUERY&limit=5"
\`\`\`

When you need context or documentation about the codebase, project, or domain, search the knowledge base first to get relevant information.
`;
        console.log(`[Sandbox] Added knowledge base gateway instructions for agent ${options.agentId}`);
      }
      
      // Configure MCP servers
      if (options.mcpServers && options.mcpServers.length > 0) {
        const mcpConfig: Record<string, any> = {};
        const mcpInstructions: string[] = [];
        
        for (const server of options.mcpServers) {
          // Resolve secret placeholders in headers
          const resolvedHeaders: Record<string, string> = {};
          if (server.headers) {
            for (const [key, value] of Object.entries(server.headers)) {
              let resolvedValue = value;
              if (options.secrets) {
                resolvedValue = value.replace(/\{\{(\w+)\}\}/g, (_, secretName) => {
                  return options.secrets?.[secretName] || `{{${secretName}}}`;
                });
              }
              resolvedHeaders[key] = resolvedValue;
            }
          }

          // Use URL-based MCP config (SSE or Streamable HTTP)
          mcpConfig[server.name] = {
            url: server.url,
            ...(Object.keys(resolvedHeaders).length > 0 && { headers: resolvedHeaders }),
          };
          
          // Add instructions for calling this MCP server via our gateway API
          // E2B sandboxes run in the cloud, so they need a public URL to reach our backend
          // Use the dynamically passed gatewayBaseUrl from the request origin
          const mcpGatewayBaseUrl = options.gatewayBaseUrl || process.env.PUBLIC_URL || null;
          
          // Skip MCP gateway instructions if no public URL is available
          if (!mcpGatewayBaseUrl) {
            console.log(`[Sandbox] Skipping MCP gateway instructions - PUBLIC_URL not set`);
            mcpInstructions.push(`
## ${server.name} MCP Server
Server URL: ${server.url}

**Note:** MCP gateway not available - PUBLIC_URL not configured.
You can still access ${server.name} data via their public REST API if available.
`);
            continue;
          }
          
          // Generate signature for this server URL
          const mcpSig = generateGatewaySignature(server.url);
          
          mcpInstructions.push(`
## ${server.name} MCP Server

**List available tools:**
\`\`\`bash
curl -s "${mcpGatewayBaseUrl}/api/mcp-gateway/tools?serverUrl=${encodeURIComponent(server.url)}&sig=${mcpSig}"
\`\`\`

**Call a tool:**
\`\`\`bash
curl -s -X POST "${mcpGatewayBaseUrl}/api/mcp-gateway/tools/call" \\
  -H "Content-Type: application/json" \\
  -d '{"serverUrl": "${server.url}", "sig": "${mcpSig}", "agentId": "${sessionId}", "toolName": "TOOL_NAME", "arguments": {"arg1": "value1"}}'
\`\`\`

First list the tools to see what's available, then call the appropriate tool with the required arguments.
`);
        }

        // Add MCP instructions to system prompt
        if (mcpInstructions.length > 0) {
          enhancedSystemPrompt += `

# Available MCP Servers
The following MCP servers are configured. You can interact with them using WebFetch or curl:
${mcpInstructions.join('\n')}
`;
        }

        // Write .mcp.json and settings.json only on first setup
        if (!options.skipFileSystemSetup) {
          const mcpJson = JSON.stringify({ mcpServers: mcpConfig }, null, 2);
          await sandbox.exec.run(
            `cat > ~/workspace/.mcp.json << 'MCPEOF'
${mcpJson}
MCPEOF`,
            { timeout: 10 }
          );
          console.log(`[Sandbox] Wrote .mcp.json with ${options.mcpServers.length} MCP servers`);

          // Configure settings to auto-enable project MCP servers
          const settingsJson = JSON.stringify({
            enableAllProjectMcpServers: true,
            permissions: {
              "mcp": "allowWithPermission"
            }
          }, null, 2);

          await sandbox.exec.run(
            `mkdir -p ~/.claude && cat > ~/.claude/settings.json << 'SETTINGSEOF'
${settingsJson}
SETTINGSEOF`,
            { timeout: 10 }
          );
          console.log(`[Sandbox] Configured settings.json with enableAllProjectMcpServers: true`);
        }
      }

      // --- Filesystem setup: CLAUDE.md, skill scanning, bucket listing ---
      // Only run on first setup. On subsequent messages, CLAUDE.md and skills
      // are already configured; we only need the prompt string.
      if (!options.skipFileSystemSetup) {

      // Write CLAUDE.md with enhanced system prompt
      if (enhancedSystemPrompt) {
        await sandbox.exec.run(`mkdir -p ~/workspace && cat > ~/workspace/CLAUDE.md << 'CLAUDE_EOF'
${enhancedSystemPrompt}
CLAUDE_EOF`, { timeout: 10 });
        console.log(`[Sandbox] Wrote CLAUDE.md with enhanced system prompt (${enhancedSystemPrompt.length} chars)`);
      }

      // =========================================================================
      // Comprehensive skill/rule file loading
      // =========================================================================
      // Searches synced buckets (~/workspace/files/{bucket}/) for skill, rule,
      // and instruction files from ALL major AI coding tools:
      //
      //   Claude Code:  CLAUDE.md, .claude/skills/
      //   Cursor:       .cursorrules, .cursor/rules/, .cursor/skills/
      //   Codex:        AGENTS.md, .codex/system.md, .codex/skills/
      //   Cline:        .clinerules, .cline/rules/
      //   Windsurf:     .windsurfrules, .windsurf/rules/
      //   GitHub Copilot: .github/copilot-instructions.md
      //   Amp:          .agents/skills/
      //   Generic:      skills/, rules/, ai/skills/, CONVENTIONS.md, SKILL.md, RULE.md
      //
      // All content is concatenated into ~/workspace/CLAUDE.md for Claude Code.
      // =========================================================================
      const foundSkillFiles: string[] = [];
      try {
        // ----- Step 1: Root-level special files -----
        // Search up to 4 levels deep so we find files whether they're at the
        // bucket root OR inside a project subfolder (e.g., bucket/my-repo/CLAUDE.md).
        // Deduplication: track paths we've already processed to avoid double-importing.
        const processedPaths = new Set<string>();
        const specialFiles = [
          'CLAUDE.md',            // Claude Code (scoped instructions at any level)
          'AGENTS.md',            // Codex / Amp
          'CONVENTIONS.md',       // Team conventions
          'SKILL.md',             // Standalone skill file
          'RULE.md',              // Cursor rule creator format
          'skills.md',            // Generic skills
          'rules.md',             // Generic rules
          '.cursorrules',         // Cursor (legacy single-file)
          '.clinerules',          // Cline
          '.windsurfrules',       // Windsurf
        ];
        for (const fileName of specialFiles) {
          const findResult = await sandbox.exec.run(
            `find ~/workspace/files ~/workspace/skills ~/files -maxdepth 5 -name "${fileName}" -type f 2>/dev/null | head -10 || true`,
            { timeout: 8 }
          );
          
          if (findResult.stdout?.trim()) {
            const paths = findResult.stdout.trim().split('\n').filter(Boolean);
            for (const sourcePath of paths) {
              if (processedPaths.has(sourcePath)) continue;
              processedPaths.add(sourcePath);
              
              if (sourcePath === `/home/sandbox/workspace/${fileName}`) {
                foundSkillFiles.push(fileName);
                continue;
              }
              
              // Derive a relative context label (e.g., "my-repo/CLAUDE.md")
              const relPath = sourcePath.replace(/.*\/files\/[^/]+\//, '');
              
              if (fileName === 'CLAUDE.md') {
                // Append to existing CLAUDE.md
                await sandbox.exec.run(
                  `echo "\n\n# --- Imported: ${relPath} ---\n" >> ~/workspace/CLAUDE.md && cat "${sourcePath}" >> ~/workspace/CLAUDE.md`,
                  { timeout: 5 }
                );
                console.log(`[Sandbox:skills] Appended ${relPath} from ${sourcePath}`);
              } else {
                // Copy to workspace root AND append to CLAUDE.md
                await sandbox.exec.run(
                  `cp "${sourcePath}" ~/workspace/${fileName} 2>/dev/null; echo "\n\n# --- Imported: ${relPath} ---\n" >> ~/workspace/CLAUDE.md && cat "${sourcePath}" >> ~/workspace/CLAUDE.md`,
                  { timeout: 5 }
                );
                console.log(`[Sandbox:skills] Imported ${relPath} from ${sourcePath}`);
              }
              foundSkillFiles.push(fileName);
            }
          }
        }
        
        // ----- Step 2: Direct skill/rule folders -----
        // Search for .md and .mdc files in well-known skill/rule directories.
        // We use a single find command that searches ALL known folder names at
        // any depth, which handles both bucket-root and nested-repo layouts:
        //   bucket/.cursor/rules/*.md           (bucket root)
        //   bucket/my-project/.cursor/rules/*.md (nested repo)
        let skillFilesFound = 0;
        
        const directFolderNames = [
          // Generic
          'skills', 'rules',
          // Claude Code
          'claude/skills', '.claude/skills', '.claude/rules', '.claude/commands',
          // Cursor
          'cursor/skills', '.cursor/skills', '.cursor/rules',
          // Codex
          '.codex/skills', '.codex/rules',
          // Cline
          '.cline/rules',
          // Windsurf
          '.windsurf/rules',
          // Amp
          '.agents/skills', '.agents/rules',
          // AI generic
          'ai/skills', 'ai/rules',
        ];
        
        // Build a single find command for efficiency instead of N separate ones
        // Search for *.md and *.mdc files directly inside any of these folders
        const findDirectResult = await sandbox.exec.run(
          `find ~/workspace/files ~/workspace/skills ~/files -maxdepth 8 \\( -name "*.md" -o -name "*.mdc" \\) -type f 2>/dev/null | grep -E '/(${directFolderNames.map(f => f.replace(/[/.]/g, '\\\\$&')).join('|')})/[^/]+\\.(md|mdc)$' | head -50 || true`,
          { timeout: 10 }
        );
        
        if (findDirectResult.stdout?.trim()) {
          const skillPaths = findDirectResult.stdout.trim().split('\n').filter(Boolean);
          
          for (const skillPath of skillPaths) {
            if (processedPaths.has(skillPath)) continue;
            processedPaths.add(skillPath);
            
            const fileName = skillPath.split('/').pop() || 'skill';
            const skillName = fileName.replace(/\.(md|mdc)$/, '');
            // Extract the folder context (e.g., ".cursor/rules")
            const folderMatch = skillPath.match(/\/(\.?[a-z]+(?:\/[a-z]+)*)\/[^/]+$/i);
            const source = folderMatch ? folderMatch[1].replace(/^\./, '') : 'skills';
            await sandbox.exec.run(
              `echo "\n\n## Skill: ${skillName} (from ${source})\n" >> ~/workspace/CLAUDE.md && cat "${skillPath}" >> ~/workspace/CLAUDE.md`,
              { timeout: 5 }
            );
            skillFilesFound++;
          }
        }
        
        // ----- Step 3: Nested skill/rule folders -----
        // Format: .tool/skills/skill-name/{instruction.md|SKILL.md|RULE.md|README.md|index.md}
        // Search at any depth so we find skills inside uploaded repos too.
        const nestedEntryFiles = ['instruction.md', 'SKILL.md', 'RULE.md', 'README.md', 'index.md'];
        const nestedFolderPatterns = [
          '.claude/skills', '.cursor/skills', '.cursor/rules',
          '.codex/skills', '.agents/skills', '.cline/rules',
          '.windsurf/rules', 'skills', 'rules',
        ];
        
        // Search for all nested entry files in one command
        const entryFilePattern = nestedEntryFiles.map(f => `-name "${f}"`).join(' -o ');
        const nestedGrepPattern = nestedFolderPatterns.map(f => f.replace(/[/.]/g, '\\$&')).join('|');
        
        const findNestedResult = await sandbox.exec.run(
          `find ~/workspace/files ~/workspace/skills ~/files -maxdepth 10 \\( ${entryFilePattern} \\) -type f 2>/dev/null | grep -E '/(${nestedGrepPattern})/[^/]+/(instruction|SKILL|RULE|README|index)\\.md$' | head -50 || true`,
          { timeout: 10 }
        );
        
        if (findNestedResult.stdout?.trim()) {
          const skillPaths = findNestedResult.stdout.trim().split('\n').filter(Boolean);
          
          for (const skillPath of skillPaths) {
            if (processedPaths.has(skillPath)) continue;
            processedPaths.add(skillPath);
            
            const parts = skillPath.split('/');
            const skillName = parts[parts.length - 2] || 'skill';
            // Find which parent folder pattern matched
            const folderMatch = skillPath.match(new RegExp(`(${nestedFolderPatterns.map(f => f.replace(/[/.]/g, '\\$&')).join('|')})/`));
            const source = folderMatch ? folderMatch[1].replace(/^\./, '') : 'skills';
            await sandbox.exec.run(
              `echo "\n\n## Skill: ${skillName} (from ${source}/${skillName})\n" >> ~/workspace/CLAUDE.md && cat "${skillPath}" >> ~/workspace/CLAUDE.md`,
              { timeout: 5 }
            );
            skillFilesFound++;
          }
        }
        
        // ----- Step 4: System/config files -----
        // Special files with known paths. Search at depth to handle nested repos.
        const systemFiles = [
          { name: 'system.md', dir: '.codex', label: 'Codex System Prompt' },
          { name: 'copilot-instructions.md', dir: '.github', label: 'GitHub Copilot Instructions' },
          { name: 'settings.local.json', dir: '.claude', label: 'Claude Local Settings' },
        ];
        
        for (const { name: sysFileName, dir: sysDir, label } of systemFiles) {
          const findSystemResult = await sandbox.exec.run(
            `find ~/workspace/files ~/workspace/skills ~/files -maxdepth 8 -path "*/${sysDir}/${sysFileName}" -type f 2>/dev/null | head -5 || true`,
            { timeout: 8 }
          );
          
          if (findSystemResult.stdout?.trim()) {
            const paths = findSystemResult.stdout.trim().split('\n').filter(Boolean);
            for (const sourcePath of paths) {
              if (processedPaths.has(sourcePath)) continue;
              processedPaths.add(sourcePath);
              
              if (sysFileName.endsWith('.json')) {
                // JSON config files: copy to workspace, don't concat into CLAUDE.md
                const destPath = `~/workspace/${sysDir}/${sysFileName}`;
                await sandbox.exec.run(
                  `mkdir -p "$(dirname ${destPath})" && cp "${sourcePath}" "${destPath}"`,
                  { timeout: 5 }
                );
                console.log(`[Sandbox:skills] Copied ${sysDir}/${sysFileName} to workspace`);
              } else {
                await sandbox.exec.run(
                  `echo "\n\n# --- ${label} ---\n" >> ~/workspace/CLAUDE.md && cat "${sourcePath}" >> ~/workspace/CLAUDE.md`,
                  { timeout: 5 }
                );
                console.log(`[Sandbox:skills] Added ${sysDir}/${sysFileName} to CLAUDE.md`);
              }
              skillFilesFound++;
            }
          }
        }
        
        // ----- Step 5: Claude Code custom commands -----
        // .claude/commands/*.md — custom slash commands. Copy the folder structure.
        const findCommandsResult = await sandbox.exec.run(
          `find ~/workspace/files ~/workspace/skills ~/files -maxdepth 8 -path "*/.claude/commands/*.md" -type f 2>/dev/null | head -20 || true`,
          { timeout: 8 }
        );
        
        if (findCommandsResult.stdout?.trim()) {
          const commandPaths = findCommandsResult.stdout.trim().split('\n').filter(Boolean);
          await sandbox.exec.run(`mkdir -p ~/workspace/.claude/commands`, { timeout: 3 });
          for (const cmdPath of commandPaths) {
            if (processedPaths.has(cmdPath)) continue;
            processedPaths.add(cmdPath);
            
            const cmdFileName = cmdPath.split('/').pop() || 'command.md';
            await sandbox.exec.run(
              `cp "${cmdPath}" ~/workspace/.claude/commands/${cmdFileName}`,
              { timeout: 5 }
            );
            skillFilesFound++;
            console.log(`[Sandbox:skills] Copied Claude command: ${cmdFileName}`);
          }
        }
        
        if (skillFilesFound > 0) {
          console.log(`[Sandbox:skills] Loaded ${skillFilesFound} skill/rule files into CLAUDE.md`);
          foundSkillFiles.push(`${skillFilesFound} skill files`);
        }
        
        // Add explicit instructions about skill files to the system prompt
        if (foundSkillFiles.length > 0) {
          enhancedSystemPrompt += `

# Custom Skill Files

The following custom skill/instruction files are available in your workspace:
${foundSkillFiles.map(f => `- \`~/workspace/${f}\` - Read this file for custom instructions and capabilities`).join('\n')}

**Important:** Read these files at the start of each task to understand available skills and custom instructions.
`;
          console.log(`[Sandbox] Added skill file instructions for: ${foundSkillFiles.join(', ')}`);
        }
        
        // List all attached file buckets and their contents summary
        const listBucketsResult = await sandbox.exec.run(
          `(ls -1 ~/workspace/files 2>/dev/null; ls -1 ~/workspace/skills 2>/dev/null; ls -1 ~/workspace/input 2>/dev/null; ls -1 ~/workspace/output 2>/dev/null) | sort -u || true`,
          { timeout: 5 }
        );
        
        const bucketNames = listBucketsResult.stdout?.trim() 
          ? listBucketsResult.stdout.trim().split('\n').filter(Boolean)
          : [];
        
        // Determine the output directory - check for ~/workspace/output/ first (portal-sandbox), fallback to ~/workspace/files/
        const outputDirCheck = await sandbox.exec.run(
          `ls -d ~/workspace/output/*/ 2>/dev/null | head -1 || true`,
          { timeout: 3 }
        );
        const hasOutputDir = !!outputDirCheck.stdout?.trim();
        const outputBasePath = hasOutputDir ? '~/workspace/output' : '~/workspace/files';
        
        // Find the specific output bucket name
        let outputBucketName = bucketNames[0] || 'bucket-name';
        if (hasOutputDir) {
          const outputBuckets = await sandbox.exec.run(
            `ls -1 ~/workspace/output 2>/dev/null || true`,
            { timeout: 3 }
          );
          if (outputBuckets.stdout?.trim()) {
            outputBucketName = outputBuckets.stdout.trim().split('\n')[0];
          }
        }
        
        // Always add file notification instructions if gatewayBaseUrl is available
        if (options.gatewayBaseUrl || process.env.PUBLIC_URL) {
          let bucketInfo = `

# File Buckets & Creation

`;
          
          if (bucketNames.length > 0) {
            bucketInfo += `The following file buckets are available in your workspace:

`;
            
            for (const bucketName of bucketNames) {
              // Get file count and top-level structure (search in all possible directories)
              const infoResult = await sandbox.exec.run(
                `find ~/workspace/files/${bucketName} ~/workspace/skills/${bucketName} ~/workspace/input/${bucketName} ~/workspace/output/${bucketName} -maxdepth 2 -type f 2>/dev/null | wc -l && (ls -1 ~/workspace/files/${bucketName} 2>/dev/null; ls -1 ~/workspace/skills/${bucketName} 2>/dev/null; ls -1 ~/workspace/input/${bucketName} 2>/dev/null; ls -1 ~/workspace/output/${bucketName} 2>/dev/null) | sort -u | head -10`,
                { timeout: 5 }
              );
              
              if (infoResult.stdout?.trim()) {
                const lines = infoResult.stdout.trim().split('\n');
                const fileCount = parseInt(lines[0]) || 0;
                const topLevelItems = lines.slice(1).filter(Boolean);
                
                // Determine the actual path for this bucket
                const bucketActualPath = await sandbox.exec.run(
                  `ls -d ~/workspace/output/${bucketName} 2>/dev/null && echo "output" || (ls -d ~/workspace/input/${bucketName} 2>/dev/null && echo "input" || (ls -d ~/workspace/files/${bucketName} 2>/dev/null && echo "files" || (ls -d ~/workspace/skills/${bucketName} 2>/dev/null && echo "skills")))`,
                  { timeout: 3 }
                );
                const bucketDir = bucketActualPath.stdout?.trim().split('\n').pop() || 'files';
                
                bucketInfo += `## ~/workspace/${bucketDir}/${bucketName}/
- **Files:** ${fileCount} files
- **Top-level contents:** ${topLevelItems.length > 0 ? topLevelItems.join(', ') : '(empty)'}
${topLevelItems.length === 10 ? '  *(showing first 10)*' : ''}

`;
              }
            }
            
            bucketInfo += `**Usage:** 
- **Write files to:** \`${outputBasePath}/${outputBucketName}/\`
- **Read reference files from:** \`~/workspace/input/\` (user-uploaded context)
- **Read skill files from:** \`~/workspace/skills/\` (agent instructions)

`;
          } else {
            bucketInfo += `File buckets may be available at \`~/workspace/files/\`. Check with \`ls ~/workspace/files\`.

`;
          }
          
          bucketInfo += `**CRITICAL - Where to Create Files:**

${bucketNames.length > 0 ? `When creating files for the user, you MUST create them directly in the output directory:
- \`~/workspace/output/\`

DO NOT create files in \`~/workspace\` directly - they won't be visible to users!
DO NOT create subdirectories under ~/workspace/output/ unless the user asks for organization.` : `When file buckets are available, create files in \`~/workspace/output/\` NOT in \`~/workspace\` directly.`}

**File Notification (REQUIRED):**

After creating ANY file in a bucket, immediately call this API:

\`\`\`bash
curl -X POST "${options.gatewayBaseUrl || process.env.PUBLIC_URL}/api/portal/file-gateway/notify" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "${sessionId}",
    "sig": "${generateGatewaySignature(sessionId)}",
    "files": [{"path": "/filename.txt", "bucketName": "output"}]
  }'
\`\`\`

**Complete Workflow:**
\`\`\`bash
# 1. Create file IN THE OUTPUT BUCKET
echo "content" > ${outputBasePath}/${outputBucketName}/output.txt

# 2. IMMEDIATELY notify (required!)
curl -X POST "${options.gatewayBaseUrl || process.env.PUBLIC_URL}/api/portal/file-gateway/notify" \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId": "${sessionId}", "sig": "${generateGatewaySignature(sessionId)}", "files": [{"path": "/output.txt", "bucketName": "${outputBucketName}"}]}'

# 3. Tell user
echo "I created output.txt"
\`\`\`

**Rules:**
- Create files in the output bucket ONLY (${outputBasePath}/${outputBucketName}/)
- Call notification API immediately after each file
- Path is relative to bucket: "/file.txt" not "/bucket/file.txt"
- Never mention sandbox paths to users

**Creating Office Documents:**

For PowerPoint (.pptx):
\`\`\`python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[5])  # Blank layout
title = slide.shapes.title
title.text = "My Presentation"
# Add text box
txBox = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1))
txBox.text_frame.paragraphs[0].text = "Content here"
prs.save('~/workspace/files/${bucketNames[0] || 'bucket-name'}/presentation.pptx')
\`\`\`

For Excel (.xlsx): Use \`openpyxl\` library
For Word (.docx): Use \`python-docx\` library

Always save office documents to the bucket path, then notify the API.
`;

          
          enhancedSystemPrompt += bucketInfo;
          
          // Also append bucket info to CLAUDE.md so it persists across messages
          // (CLAUDE.md was written earlier before we had bucket info)
          await sandbox.exec.run(`cat >> ~/workspace/CLAUDE.md << 'BUCKET_EOF'
${bucketInfo}
BUCKET_EOF`, { timeout: 10 });
          
          console.log(`[Sandbox] Added file notification instructions to CLAUDE.md (buckets: ${bucketNames.length > 0 ? bucketNames.join(', ') : 'none yet'})`);
        }
        
        // Debug: Verify CLAUDE.md exists and show first 500 chars
        const verifyResult = await sandbox.exec.run(
          `ls -la ~/workspace/CLAUDE.md 2>&1 && echo "--- CLAUDE.md PREVIEW ---" && head -c 1000 ~/workspace/CLAUDE.md`,
          { timeout: 10 }
        );
        console.log(`[Sandbox] CLAUDE.md verification:\n${verifyResult.stdout?.slice(0, 1500)}`);
      } catch (error) {
        console.error(`[Sandbox] Error copying user skill files:`, error);
        // Continue anyway - these are optional
      }

      } else {
        // skipFileSystemSetup=true — sandbox already configured, just return the prompt
        console.log(`[Sandbox] Skipping filesystem setup (sandbox already configured), returning prompt only (${enhancedSystemPrompt.length} chars)`);
      }

      return { success: true, systemPrompt: enhancedSystemPrompt };
    } catch (error) {
      console.error(`[Sandbox] Configure Claude settings error:`, error);
      return { success: false, error: String(error) };
    }
  }

  async runAgentCommand(
    sessionId: string,  // This is actually the sandboxKey (may include :owner, :sdk-xxx suffix)
    provider: ModelProvider,
    prompt: string,
    apiKey: string,
    model?: string,  // Optional model override
    allApiKeys?: Record<string, string>,  // All configured API keys for OpenCode
    customSecrets?: Record<string, string>,  // Per-agent custom environment variables/secrets
    systemPrompt?: string,  // System prompt for Claude Code (injected via --append-system-prompt)
    extendedThinking?: { enabled: boolean; budgetTokens?: number }  // Extended thinking configuration
  ): Promise<{ stdout: string; stderr: string; exitCode: number; debugLog?: any[] }> {
    // Extract the plain session/agent ID from sandbox key for WebSocket broadcasting
    // Sandbox key format: {agentId}:owner or {agentId}:sdk-{userId}
    const plainSessionId = sessionId.includes(':') ? sessionId.split(':')[0] : sessionId;
    
    let sandbox = this.sandboxes.get(sessionId);
    
    // Auto-restart sandbox if not found (expired/crashed)
    if (!sandbox) {
      console.log(`[Sandbox] Sandbox not found for ${sessionId}, attempting auto-restart...`);
      try {
        await this.createSandbox(sessionId, provider);
        sandbox = this.sandboxes.get(sessionId);
        
        if (!sandbox) {
          throw new Error('Failed to create new sandbox after restart');
        }
        
        console.log(`[Sandbox] Successfully restarted sandbox for ${sessionId}`);
        
        // Re-install agent tools after restart
        const installResult = await this.installAgentTools(sessionId, provider);
        if (!installResult.success) {
          console.warn(`[Sandbox] Failed to reinstall tools after restart: ${installResult.error}`);
          // Continue anyway - basic functionality might still work
        }
        
      } catch (error) {
        console.error(`[Sandbox] Failed to auto-restart sandbox for ${sessionId}:`, error);
        throw new Error(`Agent is temporarily unavailable. Please try again in a moment.`);
      }
    }

    // Extend sandbox lifetime on each command (keeps it alive during active use)
    await this.keepAlive(sessionId);

    // Escape the prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    let command: string;
    let commandArgs: string[] | undefined;
    
    // Build custom secrets - use export for child processes to inherit them
    const exportStatements: string[] = [];
    if (customSecrets && Object.keys(customSecrets).length > 0) {
      for (const [key, value] of Object.entries(customSecrets)) {
        // Escape single quotes in the value
        const escapedValue = value.replace(/'/g, "'\\''");
        exportStatements.push(`export ${key}='${escapedValue}'`);
      }
      console.log(`[Sandbox] Custom secrets configured: ${Object.keys(customSecrets).join(', ')}`);
    }
    const exportPrefix = exportStatements.length > 0 ? exportStatements.join(' && ') + ' && ' : '';

    if (provider === 'claude-code') {
      // Claude Code: use stdin pipe for prompt (works better in E2B sandbox)
      // -p for non-interactive, --dangerously-skip-permissions for sandbox
      // --output-format stream-json --verbose for real-time streaming output
      
      // Debug: Check if CLAUDE.md exists before running command
      const claudeMdCheck = await sandbox.exec.run(
        `ls -la ~/workspace/CLAUDE.md 2>&1 && echo "CLAUDE_MD_EXISTS" || echo "CLAUDE_MD_MISSING"`,
        { timeout: 5 }
      );
      console.log(`[Sandbox] Pre-run CLAUDE.md check: ${claudeMdCheck.stdout?.trim()}`);
      
      // Fix known-bad model names from before we had correct model IDs
      const MODEL_CORRECTIONS: Record<string, string> = {
        'claude-sonnet-4-5-20250514': 'claude-sonnet-4-5-20250929',  // Wrong date -> correct date
        'claude-opus-4-5-20250514': 'claude-opus-4-5-20251101',      // Wrong date -> correct date
      };
      const correctedModel = model ? (MODEL_CORRECTIONS[model] || model) : undefined;
      if (model && MODEL_CORRECTIONS[model]) {
        console.log(`[Sandbox] Corrected model name: ${model} -> ${correctedModel}`);
      }
      
      const modelFlag = correctedModel ? `--model ${correctedModel}` : '';
      
      // Build system prompt flag if provided
      let systemPromptFlag = '';
      if (systemPrompt) {
        // Write system prompt to a temp file to avoid shell escaping issues
        const escapedSystemPrompt = systemPrompt.replace(/'/g, "'\\''");
        systemPromptFlag = `--append-system-prompt '${escapedSystemPrompt}' `;
      }
      
      // Streaming flag - ALWAYS include for real-time streaming UX
      // Without --include-partial-messages, Claude outputs everything at the end
      // With it, we get stream_event wrappers with text_delta for character-by-character streaming
      const streamingFlag = '--include-partial-messages ';
      
      // Extended thinking - try using trigger words in prompt prefix
      // Claude Code CLI supports "think", "megathink", "ultrathink" keywords
      // which enable different thinking budgets (4k, 10k, 32k tokens)
      // This works in both interactive and non-interactive modes
      let thinkingPrefix = '';
      if (extendedThinking?.enabled) {
        // Use ultrathink for maximum thinking budget (32k tokens)
        // The budget from config determines which trigger word to use
        const budget = extendedThinking.budgetTokens || 10000;
        if (budget >= 30000) {
          thinkingPrefix = 'ultrathink: ';
        } else if (budget >= 8000) {
          thinkingPrefix = 'megathink: ';
        } else {
          thinkingPrefix = 'think: ';
        }
        console.log(`[Sandbox] Extended thinking: ${thinkingPrefix.trim()} (budget: ${budget})`);
      }
      
      // Write prompt and system prompt to temp files in sandbox to avoid OS arg length limits
      // (the system prompt + conversation can easily exceed the ~128KB execve limit)
      const promptWithThinking = thinkingPrefix ? `${thinkingPrefix}${prompt}` : prompt;
      await sandbox.files.write('/tmp/.agent_prompt', promptWithThinking);

      // Build a small shell script that reads from files
      let scriptLines = [
        '#!/bin/bash',
        'mkdir -p ~/workspace',
        'cd ~/workspace',
      ];
      if (exportPrefix) {
        scriptLines.push(exportPrefix.replace(/ && $/, ''));
      }
      if (systemPrompt) {
        await sandbox.files.write('/tmp/.agent_system_prompt', systemPrompt);
        scriptLines.push(`cat /tmp/.agent_prompt | ANTHROPIC_API_KEY='${apiKey}' claude ${modelFlag} --append-system-prompt "$(cat /tmp/.agent_system_prompt)" ${streamingFlag}-p --dangerously-skip-permissions --output-format stream-json --verbose`);
      } else {
        scriptLines.push(`cat /tmp/.agent_prompt | ANTHROPIC_API_KEY='${apiKey}' claude ${modelFlag} ${streamingFlag}-p --dangerously-skip-permissions --output-format stream-json --verbose`);
      }
      await sandbox.files.write('/tmp/.agent_run.sh', scriptLines.join('\n'));
      command = '/bin/bash';
      // Pass script path as args since exec.start uses fork/exec (not sh -c)
      commandArgs = ['/tmp/.agent_run.sh'];
      console.log(`[Sandbox] Claude command written to /tmp/.agent_run.sh (prompt ${promptWithThinking.length} chars, system prompt ${systemPrompt?.length || 0} chars)`);
    } else if (provider === 'aider') {
      // Aider uses --model flag (e.g., gpt-4o, claude-3-5-sonnet)
      const modelFlag = model ? `--model ${model}` : '';
      // Write prompt to file and run via script (exec.start uses fork/exec, not shell)
      await sandbox.files.write('/tmp/.agent_prompt', prompt);
      const aiderScript = [
        '#!/bin/bash',
        'mkdir -p ~/workspace',
        'cd ~/workspace',
        'export PATH="$HOME/.local/bin:$PATH"',
        `${exportPrefix}OPENAI_API_KEY='${apiKey}' aider ${modelFlag} --yes-always --no-git --message "$(cat /tmp/.agent_prompt)"`,
      ].join('\n');
      await sandbox.files.write('/tmp/.agent_run.sh', aiderScript);
      command = '/bin/bash';
      commandArgs = ['/tmp/.agent_run.sh'];
    } else if (provider === 'opencode') {
      // OpenCode uses config file for model selection
      // Format: "provider/org/model" -> "provider:model" for OpenCode
      const opencodeModel = model || 'anthropic/claude-sonnet-4-5-20250929';
      const modelProvider = opencodeModel.split('/')[0].toLowerCase();
      
      // Convert model format: "huggingface/org/model" -> "huggingface:org/model"
      // Keep the FULL repo ID after the provider prefix
      const firstSlashIndex = opencodeModel.indexOf('/');
      const opencodeModelFormat = firstSlashIndex > -1
        ? `${opencodeModel.substring(0, firstSlashIndex)}:${opencodeModel.substring(firstSlashIndex + 1)}`
        : opencodeModel;
      
      console.log(`[Sandbox] OpenCode using model: ${opencodeModel} -> ${opencodeModelFormat} (provider: ${modelProvider})`);
      console.log(`[Sandbox] allApiKeys provided: ${allApiKeys ? Object.keys(allApiKeys).join(', ') : 'NONE'}`);
      
      // Build OpenCode config (opencode.json) and auth (auth.json)
      // Config: ~/.config/opencode/opencode.json - model selection
      // Auth: ~/.local/share/opencode/auth.json - API keys
      
      // Provider-specific configurations for OpenCode
      // Built-in providers work natively, others need OpenAI-compatible SDK
      const providerConfigs: Record<string, object> = {
        // OpenRouter - uses OpenAI-compatible API
        'openrouter': {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenRouter',
          options: {
            baseURL: 'https://openrouter.ai/api/v1'
          }
        },
        // Built-in providers
        'anthropic': {},
        'openai': {},
        'google': {},
        'groq': {},
        'mistral': {},
        'xai': {},
        // Providers that need OpenAI-compatible SDK
        'together': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Together AI',
          options: {
            baseURL: 'https://api.together.xyz/v1'
          }
        },
        'deepseek': {
          npm: '@ai-sdk/openai-compatible',
          name: 'DeepSeek',
          options: {
            baseURL: 'https://api.deepseek.com'
          }
        },
        // HuggingFace - NOT SUPPORTED by OpenCode v0.0.55
        // Use OpenRouter or Together AI for open-source models instead
        'huggingface': {
          npm: '@ai-sdk/openai-compatible',
          name: 'Hugging Face',
          options: {
            baseURL: 'https://api-inference.huggingface.co/v1/'
          },
          _unsupported: true  // Mark as unsupported
        },
      };
      
      const configObj = {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
          [modelProvider]: providerConfigs[modelProvider] || {}
        },
        "model": opencodeModelFormat
      };
      
      // Check if provider is unsupported
      const providerConfig = providerConfigs[modelProvider] as { _unsupported?: boolean; npm?: string } | undefined;
      if (providerConfig?._unsupported) {
        throw new Error(`Provider '${modelProvider}' is not supported by OpenCode. Use OpenRouter or Together AI for open-source models.`);
      }
      
      // Build auth.json with ONLY the selected provider's API key
      // This prevents OpenCode from falling back to other providers
      const authObj: Record<string, { apiKey: string }> = {};
      const providerApiKeyMap: Record<string, string> = {
        'openrouter': 'OPENROUTER_API_KEY',
        'anthropic': 'ANTHROPIC_API_KEY',
        'openai': 'OPENAI_API_KEY',
        'google': 'GOOGLE_API_KEY',
        'groq': 'GROQ_API_KEY',
        'together': 'TOGETHER_API_KEY',
        'deepseek': 'DEEPSEEK_API_KEY',
        'mistral': 'MISTRAL_API_KEY',
        'xai': 'XAI_API_KEY',
      };
      
      // Only add the API key for the selected model's provider
      const selectedEnvKey = providerApiKeyMap[modelProvider];
      if (selectedEnvKey && allApiKeys?.[selectedEnvKey]) {
        authObj[modelProvider] = { apiKey: allApiKeys[selectedEnvKey] };
      }
      
      const configJson = JSON.stringify(configObj);
      const authJson = JSON.stringify(authObj);
      
      console.log(`[Sandbox] Writing OpenCode config: ${configJson}`);
      console.log(`[Sandbox] Writing OpenCode auth for providers: ${Object.keys(authObj).join(', ')}`);
      
      // Check if provider needs additional npm package
      const needsNpmPackage = providerConfig?.npm;
      
      // Write config and auth to correct locations
      // Also remove any workspace-level opencode.json that could override our config
      await sandbox.exec.run(`
        # Remove any workspace config that could override
        rm -f ~/workspace/opencode.json ~/workspace/.opencode/config.json 2>/dev/null || true
        
        # Create directories
        mkdir -p /home/sandbox/.config/opencode /home/sandbox/.local/share/opencode

        # Write config files
        echo '${configJson}' > /home/sandbox/.config/opencode/opencode.json
        echo '${authJson}' > /home/sandbox/.local/share/opencode/auth.json

        # Fix permissions
        chmod 600 /home/sandbox/.local/share/opencode/auth.json
      `);
      console.log(`[Sandbox] OpenCode config and auth written`);
      
      // Install required npm package for OpenAI-compatible providers
      if (needsNpmPackage) {
        console.log(`[Sandbox] Installing required npm package: ${needsNpmPackage}`);
        const installResult = await sandbox.exec.run(`
          cd ~/workspace && npm install ${needsNpmPackage} --save-dev 2>&1 || yarn add ${needsNpmPackage} --dev 2>&1 || echo "Package install skipped"
        `);
        console.log(`[Sandbox] Package install result: ${installResult.stdout.slice(0, 200)}`);
      }
      
      // Build environment variables string with all API keys
      // OpenCode will pick the right one based on the model
      const envVars: string[] = [];
      
      // Map provider prefix to env var name
      const providerEnvMap: Record<string, string> = {
        'openrouter': 'OPENROUTER_API_KEY',
        'anthropic': 'ANTHROPIC_API_KEY',
        'openai': 'OPENAI_API_KEY',
        'google': 'GOOGLE_API_KEY',
        'groq': 'GROQ_API_KEY',
        'mistral': 'MISTRAL_API_KEY',
        'deepseek': 'DEEPSEEK_API_KEY',
        'together': 'TOGETHER_API_KEY',
        'xai': 'XAI_API_KEY',
      };
      
      // ONLY add the API key for the selected provider
      // Adding all keys causes OpenCode to prefer Anthropic if ANTHROPIC_API_KEY is present
      const primaryEnvKey = providerEnvMap[modelProvider];
      if (primaryEnvKey && allApiKeys?.[primaryEnvKey]) {
        envVars.push(`${primaryEnvKey}='${allApiKeys[primaryEnvKey]}'`);
      } else if (apiKey) {
        // Fallback to the passed apiKey
        envVars.push(`${primaryEnvKey || 'API_KEY'}='${apiKey}'`);
      }
      
      // Set model via environment variable (OpenCode may support this)
      envVars.push(`OPENCODE_MODEL='${opencodeModelFormat}'`);
      envVars.push(`OPENCODE_PROVIDER='${modelProvider}'`);
      
      const envString = envVars.join(' ');
      console.log(`[Sandbox] OpenCode env vars: ${envVars.map(v => v.split('=')[0]).join(', ')}`);
      
      // Verify the config files and permissions
      const verifyResult = await sandbox.exec.run(`
        echo "=== File ownership ==="
        ls -la /home/sandbox/.config/opencode/ 2>/dev/null || echo "config dir missing"
        ls -la /home/sandbox/.local/share/opencode/ 2>/dev/null || echo "data dir missing"
        echo "=== opencode.json ==="
        cat /home/sandbox/.config/opencode/opencode.json 2>/dev/null || echo "NOT FOUND"
        echo "=== auth.json (keys redacted) ==="
        cat /home/sandbox/.local/share/opencode/auth.json 2>/dev/null | sed 's/apiKey":"[^"]*"/apiKey":"***"/g' || echo "NOT FOUND"
        echo "=== Workspace config check ==="
        find ~/workspace -name "opencode.json" -o -name "config.json" 2>/dev/null | head -5 || echo "none found"
        echo "=== Env var check ==="
        echo "OPENROUTER_API_KEY=\${OPENROUTER_API_KEY:+SET}"
        echo "ANTHROPIC_API_KEY=\${ANTHROPIC_API_KEY:+SET}"
        echo "=== OpenCode version ==="
        opencode -v 2>&1 || echo "version check failed"
      `);
      console.log(`[Sandbox] Verify:\n${verifyResult.stdout}`);
      
      // Add custom secrets to env vars for OpenCode
      if (customSecrets && Object.keys(customSecrets).length > 0) {
        for (const [key, value] of Object.entries(customSecrets)) {
          const escapedValue = value.replace(/'/g, "'\\''");
          envVars.push(`${key}='${escapedValue}'`);
        }
        console.log(`[Sandbox] OpenCode custom secrets: ${Object.keys(customSecrets).join(', ')}`);
      }
      
      // Run opencode with env vars exported inline
      // Format: export VAR1=val; export VAR2=val; command
      const exportPrefix = envVars.map(v => `export ${v}`).join(' && ');
      
      // Write prompt to file and run via script (exec.start uses fork/exec, not shell)
      await sandbox.files.write('/tmp/.agent_prompt', prompt);
      const scriptLines = [
        '#!/bin/bash',
        'mkdir -p ~/workspace',
        'cd ~/workspace',
        exportPrefix,
        'stdbuf -oL opencode -d -p "$(cat /tmp/.agent_prompt)" -q 2>&1',
      ].filter(Boolean);
      await sandbox.files.write('/tmp/.agent_run.sh', scriptLines.join('\n'));
      command = '/bin/bash';
      commandArgs = ['/tmp/.agent_run.sh'];
      console.log(`[Sandbox] OpenCode will use model from config: ${opencodeModelFormat}`);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    console.log(`[Sandbox] Running ${provider} agent${model ? ` with model ${model}` : ''}...`);
    console.log(`[Sandbox] Full command (redacted API keys):`);
    console.log(command.replace(/[A-Z_]+_API_KEY='[^']*'/g, 'API_KEY=***'));
    
    const startTime = Date.now();
    
    // Emit start event for terminal streaming
    console.log(`[Sandbox:Events] Emitting start event to terminal:${sessionId}`);
    terminalEvents.emit(`terminal:${sessionId}`, {
      type: 'start',
      command: command.replace(/[A-Z_]+_API_KEY='[^']*'/g, 'API_KEY=***'),
      timestamp: Date.now(),
    });

    let stdout = '';
    let stderr = '';
    let lineCount = 0;
    
    console.log(`[Sandbox] === BEGIN STREAMING OUTPUT ===`);
    
    // Initialize partial output storage
    partialOutputs.set(sessionId, []);
    
    // For Claude Code, we'll build up the text output separately
    let textOutput = '';
    
    // Accumulate all thinking content for persistence
    let thinkingOutput = '';
    
    // Buffer for incomplete JSON lines (stdout comes in chunks that may split lines)
    let lineBuffer = '';
    
    // Track active tools for timing
    const activeTools = new Map<string, { name: string; startTime: number; input?: any }>();
    
    // Debug log to store for replay/debugging
    const debugLog: Array<{
      type: 'text' | 'tool' | 'tool_result' | 'thinking' | 'status' | 'error';
      content: string;
      timestamp: number;
      duration?: number;
      raw?: any;
    }> = [];
    
    // Keep-alive tracking - extend sandbox timeout during active execution
    let lastKeepAlive = Date.now();
    const extendTimeoutIfNeeded = async () => {
      const now = Date.now();
      if (now - lastKeepAlive >= KEEP_ALIVE_INTERVAL_MS) {
        lastKeepAlive = now;
        try {
          await sandbox?.setTimeout(SANDBOX_TIMEOUT_S);
          console.log(`[Sandbox] Extended sandbox timeout during active execution`);
        } catch (err) {
          console.warn(`[Sandbox] Failed to extend sandbox timeout:`, err);
        }
      }
    };
    
    let result;
    
    try {
      if (!sandbox) {
        throw new Error('Sandbox not available');
      }
      
      // Use exec.start for streaming (exec.run doesn't support callbacks in OpenComputer)
      const execSession = await sandbox.exec.start(command, {
      args: commandArgs,
      timeout: 3600, // 1 hour max - let agents run as long as needed
      onStdout: (rawData: Uint8Array) => {
        const data = new TextDecoder().decode(rawData);
        stdout += data;
        lineCount++;

        // Debug: Log stdout milestones
        if (lineCount <= 3 || lineCount % 500 === 0) {
          console.log(`[Sandbox:stdout] Chunk ${lineCount}, ${rawData.length} raw bytes, decoded ${data.length} chars: ${data.slice(0, 120).replace(/\n/g, '\\n')}...`);
        }
        
        // Extend sandbox timeout during active execution
        extendTimeoutIfNeeded();
        
        // For Claude Code stream-json format, parse and extract text
        if (provider === 'claude-code') {
          // Buffer data and process complete lines only
          // stdout chunks may split JSON lines, so we need to buffer
          lineBuffer += data;
          
          // Process complete lines (ending with newline)
          const lines = lineBuffer.split('\n');
          // Keep the last incomplete line in the buffer
          lineBuffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const json = JSON.parse(line);
              
              // Handle stream_event wrapper format (newer Claude Code versions)
              if (json.type === 'stream_event' && json.event) {
                const event = json.event;
                
                // Log content_block_start events (tools, text, thinking blocks)
                if (event.type === 'content_block_start' && event.content_block?.type) {
                  console.log(`[Sandbox] Block start: ${event.content_block.type}`);
                }
                
                // Handle content_block_start for thinking
                if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
                  console.log(`[Sandbox:thinking_block_start] Thinking block started`);
                  // Don't emit an initial marker - actual thinking content will be streamed via content_block_delta
                }
                
                // Handle content_block_start for tool_use (tool started)
                if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                  const block = event.content_block;
                  const toolId = block.id || `tool-${Date.now()}`;
                  let toolName = block.name || 'tool';
                  let isMcpTool = false;
                  
                  // Check if this is a Bash command calling an MCP tool via gateway
                  if (toolName === 'Bash' && block.input?.command) {
                    const cmd = block.input.command as string;
                    // Look for MCP gateway tool calls: curl ... /mcp-gateway/call ... "toolName":"xxx"
                    const mcpToolMatch = cmd.match(/"toolName"\s*:\s*"([^"]+)"/);
                    if (mcpToolMatch) {
                      toolName = mcpToolMatch[1]; // Extract actual MCP tool name
                      isMcpTool = true;
                    }
                  } else {
                    // Detect if this is an MCP tool (tools with underscores that aren't standard Cursor tools)
                    const standardTools = ['Read', 'Write', 'Edit', 'Bash', 'Shell', 'Glob', 'Grep', 'Task', 'WebFetch', 'Fetch'];
                    isMcpTool = !standardTools.includes(toolName) && toolName.includes('_');
                  }
                  
                  console.log(`[Sandbox] Tool start: ${toolName}${isMcpTool ? ' (MCP)' : ''}`);
                  
                  activeTools.set(toolId, {
                    name: toolName,
                    startTime: Date.now(),
                    input: block.input
                  });
                  
                  const emoji = isMcpTool ? '🔧' : '⚙️';
                  const detail = isMcpTool ? `Calling MCP tool: ${toolName}` : `Using tool: ${toolName}`;
                  const statusMsg = `${emoji} ${toolName}...`;
                  
                  // Send to WebSocket for Chat tab (as status/stderr)
                  sendOutput(plainSessionId, statusMsg, 'stderr');
                  
                  // Emit tool_start event with the actual tool name (not "Bash") and include input
                  terminalEvents.emit(`terminal:${sessionId}`, {
                    type: 'tool_start',
                    toolId,
                    toolName,
                    data: statusMsg,
                    detail,
                    timestamp: Date.now(),
                    input: block.input, // Include tool input for frontend exploration
                  });
                  continue;
                }
                
                // Handle content_block_delta events (streaming text/thinking)
                if (event.type === 'content_block_delta' && event.delta) {
                  if (event.delta.type === 'text_delta' && event.delta.text) {
                    // Streaming text content - accumulate and emit for real-time UI
                    const textChunk = event.delta.text;
                    textOutput += textChunk;
                    // Send to WebSocket for Chat tab (uses sendOutput -> type: 'output')
                    sendOutput(plainSessionId, textChunk, 'stdout');
                    // Also emit to terminal events for SSE/Portal
                    terminalEvents.emit(`terminal:${sessionId}`, {
                      type: 'stdout',
                      data: line, // Complete JSON line for portal to parse
                      timestamp: Date.now(),
                    });
                  } else if (event.delta.type === 'thinking_delta') {
                    // Streaming thinking content - handle both 'thinking' and 'text' fields
                    const thinkingText = event.delta.thinking || event.delta.text || '';
                    if (thinkingText) {
                      // Only emit the dedicated thinking event (not stdout) to avoid
                      // duplicate processing in the portal SSE handler
                      terminalEvents.emit(`terminal:${sessionId}`, {
                        type: 'thinking',
                        data: thinkingText,
                        timestamp: Date.now(),
                      });
                    }
                  }
                }
                // Skip other stream events (message_start, message_delta, etc.)
                continue;
              }
              
              // Handle assistant message format - thinking blocks appear here
              if (json.type === 'assistant' && json.message?.content) {
                for (const block of json.message.content) {
                  if (block.type === 'thinking' && block.thinking) {
                    // Extended thinking block - Claude's internal reasoning
                    const thinkingText = block.thinking;
                    console.log(`[Sandbox:thinking] ${thinkingText.slice(0, 100)}...`);
                    
                    // Accumulate thinking for persistence
                    thinkingOutput += thinkingText + '\n\n';
                    
                    debugLog.push({
                      type: 'thinking',
                      content: thinkingText,
                      timestamp: Date.now(),
                    });
                    // Emit thinking event for frontend
                    terminalEvents.emit(`terminal:${sessionId}`, {
                      type: 'thinking',
                      data: thinkingText,
                      timestamp: Date.now(),
                    });
                  } else if (block.type === 'text' && block.text && !textOutput) {
                    // This is actual response text (fallback if streaming didn't work)
                    textOutput += block.text + '\n';
                    sendOutput(plainSessionId, block.text, 'stdout');
                    debugLog.push({
                      type: 'text',
                      content: block.text,
                      timestamp: Date.now(),
                    });
                  } else if (block.type === 'tool_use') {
                    // Track tool start for timing
                    const toolId = block.id || `tool-${Date.now()}`;
                    let toolName = block.name || 'tool';
                    let isMcpToolCall = false;
                    
                    // Check if this is a Bash command calling an MCP tool via gateway
                    if (toolName === 'Bash' && block.input?.command) {
                      const cmd = block.input.command as string;
                      console.log(`[Sandbox:tool] Checking Bash command for MCP tool: ${cmd.substring(0, 200)}...`);
                      // Look for MCP gateway tool calls: curl ... /mcp-gateway/call ... "toolName":"xxx"
                      const mcpToolMatch = cmd.match(/"toolName"\s*:\s*"([^"]+)"/);
                      if (mcpToolMatch) {
                        toolName = mcpToolMatch[1]; // Extract actual MCP tool name
                        isMcpToolCall = true;
                        console.log(`[Sandbox:tool] ✅ EXTRACTED MCP TOOL: ${toolName}`);
                      } else {
                        console.log(`[Sandbox:tool] ❌ No MCP tool found in Bash command`);
                      }
                    }
                    
                    activeTools.set(toolId, { 
                      name: toolName, 
                      startTime: Date.now(),
                      input: block.input 
                    });
                    
                    // Show what tool is being used as a status update
                    let statusMsg = '';
                    let detailedMsg = '';
                    
                    if (isMcpToolCall) {
                      // This is an MCP tool call
                      statusMsg = `🔧 ${toolName}...`;
                      detailedMsg = `Calling MCP tool: ${toolName}`;
                    } else if (toolName === 'Read') {
                      const filePath = block.input?.file_path || 'file';
                      statusMsg = `📖 Reading ${filePath}...`;
                      detailedMsg = `Reading file: ${filePath}`;
                    } else if (toolName === 'Glob') {
                      const pattern = block.input?.pattern || block.input?.glob || '';
                      statusMsg = `🔍 Finding files: ${pattern}...`;
                      detailedMsg = `Searching for files matching: ${pattern}`;
                    } else if (toolName === 'Grep') {
                      const pattern = block.input?.pattern || '';
                      statusMsg = `🔍 Searching: ${pattern}...`;
                      detailedMsg = `Searching content for: ${pattern}`;
                    } else if (toolName === 'Edit') {
                      const filePath = block.input?.file_path || 'file';
                      statusMsg = `✏️ Editing ${filePath}...`;
                      detailedMsg = `Editing file: ${filePath}`;
                    } else if (toolName === 'Write') {
                      const filePath = block.input?.file_path || 'file';
                      statusMsg = `📝 Writing ${filePath}...`;
                      detailedMsg = `Writing to file: ${filePath}`;
                    } else if (toolName === 'Bash' || toolName === 'Shell') {
                      const cmd = block.input?.command?.slice(0, 60) || 'command';
                      statusMsg = `💻 Running: ${cmd}${block.input?.command?.length > 60 ? '...' : ''}`;
                      detailedMsg = `Executing: ${block.input?.command || 'command'}`;
                    } else if (toolName === 'Task') {
                      statusMsg = `🤔 ${block.input?.description || 'Thinking'}...`;
                      detailedMsg = block.input?.description || 'Processing task';
                    } else if (toolName === 'WebFetch' || toolName === 'Fetch') {
                      const url = block.input?.url || 'URL';
                      statusMsg = `🌐 Fetching ${url}...`;
                      detailedMsg = `Fetching URL: ${url}`;
                    } else if (toolName.startsWith('mcp_') || toolName === 'mcp') {
                      statusMsg = `🔧 Using MCP: ${toolName.replace('mcp_', '')}...`;
                      detailedMsg = `Calling MCP tool: ${toolName}`;
                    } else {
                      // Default handler for all other tools (including MCP tools without mcp_ prefix)
                      // MCP tools from Claude Code often come through with their original names
                      const standardTools = ['Read', 'Write', 'Edit', 'Bash', 'Shell', 'Glob', 'Grep', 'Task', 'WebFetch', 'Fetch'];
                      const isMcpTool = !standardTools.includes(toolName) && toolName.includes('_');
                      statusMsg = isMcpTool ? `🔧 ${toolName}...` : `⚙️ ${toolName}...`;
                      detailedMsg = isMcpTool ? `Calling MCP tool: ${toolName}` : `Using tool: ${toolName}`;
                    }
                    
                    if (statusMsg) {
                      sendOutput(plainSessionId, statusMsg, 'stderr'); // Use stderr for status
                      console.log(`[Sandbox:tool] ${statusMsg}`);
                      debugLog.push({
                        type: 'tool',
                        content: statusMsg,
                        timestamp: Date.now(),
                        raw: { toolId, tool: toolName, input: block.input, detail: detailedMsg },
                      });
                      // Emit tool_start event for frontend with input data
                      terminalEvents.emit(`terminal:${sessionId}`, {
                        type: 'tool_start',
                        toolId,
                        toolName,
                        data: statusMsg,
                        detail: detailedMsg,
                        timestamp: Date.now(),
                        input: block.input, // Include tool input for frontend exploration
                      });
                    }
                  }
                }
              } else if (json.type === 'user' && json.message?.content) {
                // User messages contain tool_result blocks
                for (const block of json.message.content) {
                  if (block.type === 'tool_result') {
                    const toolId = block.tool_use_id;
                    const toolInfo = activeTools.get(toolId);
                    const duration = toolInfo ? Date.now() - toolInfo.startTime : 0;
                    
                    // Generate result summary
                    let resultSummary = '';
                    const content = block.content;
                    if (typeof content === 'string') {
                      const lines = content.split('\n').length;
                      const chars = content.length;
                      if (chars > 200) {
                        resultSummary = `Result: ${lines} lines, ${chars} chars`;
                      } else {
                        resultSummary = content.slice(0, 100);
                      }
                    } else if (Array.isArray(content)) {
                      resultSummary = `Result: ${content.length} item(s)`;
                    }
                    
                    const toolName = toolInfo?.name || 'tool';
                    console.log(`[Sandbox:tool_result] ${toolName} completed in ${duration}ms`);
                    
                    debugLog.push({
                      type: 'tool_result',
                      content: resultSummary,
                      timestamp: Date.now(),
                      duration,
                      raw: { toolId, toolName, isError: block.is_error },
                    });
                    
                    // Emit tool_end event for frontend with input and result data
                    terminalEvents.emit(`terminal:${sessionId}`, {
                      type: 'tool_end',
                      toolId,
                      toolName,
                      duration,
                      data: block.is_error ? `❌ ${toolName} failed` : `✓ ${toolName} (${duration}ms)`,
                      isError: block.is_error,
                      timestamp: Date.now(),
                      input: toolInfo?.input, // Include tool input for frontend exploration
                      result: content, // Include full result content for frontend exploration
                    });
                    
                    // Clean up tracking
                    activeTools.delete(toolId);
                  }
                }
              } else if (json.type === 'result' && json.result) {
                // Final result - this is the clean text output, use it as the definitive response
                console.log(`[Sandbox] Captured result message, text length: ${json.result.length}`);
                textOutput = json.result;
                debugLog.push({
                  type: 'text',
                  content: `[Final Result]\n${json.result}`,
                  timestamp: Date.now(),
                });
              }
              // Also handle system messages if they contain useful info
            } catch {
              // Not valid JSON - ignore
              console.log(`[Sandbox:skip] Non-JSON: ${line.slice(0, 40)}...`);
            }
          }
        } else {
          // For other providers, send raw output
          sendOutput(plainSessionId, data, 'stdout');
          debugLog.push({
            type: 'text',
            content: data,
            timestamp: Date.now(),
          });
        }
        
        // Store for polling
        const current = partialOutputs.get(sessionId) || [];
        current.push(data);
        partialOutputs.set(sessionId, current);
        
        // Log to console (only every 50th line to reduce spam from streaming events)
        if (lineCount % 50 === 0) {
          console.log(`[Sandbox:stdout:${lineCount}] ${data.replace(/\n$/, '').slice(0, 80)}...`);
        }
        
        // For non-Claude providers, emit raw stdout
        // For Claude, we emit complete lines within the parsing loop above
        if (provider !== 'claude-code') {
          terminalEvents.emit(`terminal:${sessionId}`, {
            type: 'stdout',
            data,
            timestamp: Date.now(),
          });
        }
      },
      onStderr: (rawData: Uint8Array) => {
        const data = new TextDecoder().decode(rawData);
        stderr += data;
        lineCount++;
        
        // Extend sandbox timeout during active execution
        extendTimeoutIfNeeded();
        
        // Store for polling
        const current = partialOutputs.get(sessionId) || [];
        current.push(data);
        partialOutputs.set(sessionId, current);
        // Send via WebSocket immediately
        sendOutput(plainSessionId, data, 'stderr');
        // Add to debug log
        debugLog.push({
          type: 'error',
          content: data,
          timestamp: Date.now(),
        });
        // Log to console
        console.log(`[Sandbox:stderr:${lineCount}] ${data.replace(/\n$/, '').slice(0, 100)}`);
        terminalEvents.emit(`terminal:${sessionId}`, {
          type: 'stderr',
          data,
          timestamp: Date.now(),
        });
      },
    });

      // Wait for the command to finish and capture exit code
      const exitCode = await execSession.done;
      result = { exitCode, stdout, stderr };

    } catch (error: any) {
      console.error(`[Sandbox] Command execution failed for ${sessionId}:`, error?.message || error);
      
      // Check if this is a CommandExitError with valid output (non-zero exit code but work was done)
      // Claude Code can exit with code 1 for non-fatal reasons (tool errors, partial completion, etc.)
      // If we have stdout with actual content, treat it as a successful (partial) result.
      if (error?.result && error.result.stdout && error.result.exitCode !== undefined) {
        const resultStdout = error.result.stdout as string;
        // Check if stdout has meaningful content (not just the init JSON)
        if (resultStdout.length > 500 || resultStdout.includes('"type":"result"') || resultStdout.includes('"type":"assistant"')) {
          console.log(`[Sandbox] Command exited with code ${error.result.exitCode} but has valid output (${resultStdout.length} chars). Treating as success.`);
          result = {
            exitCode: error.result.exitCode,
            stdout: resultStdout,
            stderr: error.result.stderr || '',
          };
          // Process the stdout we already captured during streaming (it was captured in the onStdout callback before the error was thrown)
          // Fall through to normal result processing below
        } else {
          // Exit code non-zero with minimal/no output — likely a real error
          console.log(`[Sandbox] Command exited with code ${error.result.exitCode} with minimal output — treating as error`);
          throw error;
        }
      } else {
      // Check if this looks like a sandbox failure
      const errorMsg = error?.message || String(error);
      const isSandboxError = errorMsg.includes('sandbox') || 
                           errorMsg.includes('Sandbox') ||
                           errorMsg.includes('connection') || 
                           errorMsg.includes('timeout') ||
                           errorMsg.includes('not available') ||
                           error?.code === 'ECONNRESET' ||
                           error?.code === 'ENOTFOUND';
      
      if (isSandboxError) {
        console.log(`[Sandbox] Sandbox error detected, attempting restart and retry...`);
        
        try {
          // Remove the failed sandbox from cache
          this.sandboxes.delete(sessionId);
          
          // Create a new sandbox
          await this.createSandbox(sessionId, provider);
          sandbox = this.sandboxes.get(sessionId);
          
          if (!sandbox) {
            throw new Error('Failed to create sandbox on retry');
          }
          
          // Re-install tools
          const installResult = await this.installAgentTools(sessionId, provider);
          if (!installResult.success) {
            console.warn(`[Sandbox] Failed to reinstall tools after restart: ${installResult.error}`);
          }
          
          console.log(`[Sandbox] Sandbox restarted successfully, retrying command...`);
          
          // Reset output variables for retry
          stdout = '';
          stderr = '';
          textOutput = '';
          lineCount = 0;
          partialOutputs.set(sessionId, []);
          
          // Retry the command once
          const retrySession = await sandbox.exec.start(command, {
            timeout: 3600,
            onStdout: (rawData: Uint8Array) => {
              const data = new TextDecoder().decode(rawData);
              stdout += data;
              lineCount++;
              extendTimeoutIfNeeded();
              terminalEvents.emit(`terminal:${sessionId}`, {
                type: 'stdout',
                data,
                timestamp: Date.now(),
              });
              const partialLines = partialOutputs.get(sessionId) || [];
              partialLines.push(data);
              partialOutputs.set(sessionId, partialLines);
            },
            onStderr: (rawData: Uint8Array) => {
              const data = new TextDecoder().decode(rawData);
              stderr += data;
              extendTimeoutIfNeeded();
              terminalEvents.emit(`terminal:${sessionId}`, {
                type: 'stderr',
                data,
                timestamp: Date.now(),
              });
            },
          });

          const retryExitCode = await retrySession.done;
          result = { exitCode: retryExitCode, stdout, stderr };

          console.log(`[Sandbox] Retry successful, exit code: ${result.exitCode}`);
          
        } catch (retryError) {
          console.error(`[Sandbox] Retry failed for ${sessionId}:`, retryError);
          throw new Error(`Agent temporarily unavailable. Please try again in a moment.`);
        }
      } else {
        // Not a sandbox error, throw the original error
        throw error;
      }
      } // end of else block for non-CommandExitError errors
    }

    console.log(`[Sandbox] === END STREAMING OUTPUT ===`);
    
    // Process any remaining buffered content (final line without trailing newline)
    if (provider === 'claude-code' && lineBuffer.trim()) {
      try {
        const json = JSON.parse(lineBuffer);
        if (json.type === 'result' && json.result) {
          console.log(`[Sandbox] Final result from buffer, text length: ${json.result.length}`);
          textOutput = json.result;
        } else if (json.type === 'assistant' && json.message?.content) {
          for (const block of json.message.content) {
            if (block.type === 'text' && block.text && !textOutput) {
              console.log(`[Sandbox] Final assistant from buffer, text length: ${block.text.length}`);
              textOutput = block.text;
            }
          }
        }
      } catch {
        console.log(`[Sandbox] Final buffer not valid JSON (${lineBuffer.length} chars)`);
      }
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Sandbox] Agent result: exit=${result.exitCode}, took ${elapsed}s, lines=${lineCount}, stdout=${stdout.length} chars, stderr=${stderr.length} chars`);
    console.log(`[Sandbox] Extracted text output: ${textOutput.length} chars`);
    
    // For Claude Code, try to extract thinking from transcript files (thinking doesn't appear in stdout)
    if (provider === 'claude-code' && extendedThinking?.enabled && sandbox) {
      try {
        // Find Claude's project/session directories
        const findDirs = await sandbox.exec.run(
          `ls -la ~/.claude/ 2>/dev/null; echo "---"; find ~/.claude -name "*.jsonl" -type f -mmin -10 2>/dev/null | head -5`
        );
        console.log(`[Sandbox] Claude directories:\n${findDirs.stdout.slice(0, 500)}`);
        
        const transcriptPaths = findDirs.stdout.split('---')[1]?.trim().split('\n').filter(Boolean) || [];
        
        for (const transcriptPath of transcriptPaths.slice(0, 2)) {
          if (!transcriptPath) continue;
          console.log(`[Sandbox] Checking transcript: ${transcriptPath}`);
          
          // Read last 50 lines of transcript to find thinking blocks
          const readTranscript = await sandbox.exec.run(
            `tail -50 "${transcriptPath}" 2>/dev/null | grep -i "thinking" | head -3 || true`
          );
          
          if (readTranscript.stdout.trim()) {
            console.log(`[Sandbox] Found thinking references:\n${readTranscript.stdout.slice(0, 300)}`);
            
            // Try to parse JSONL lines for thinking content
            const lines = readTranscript.stdout.trim().split('\n');
            for (const line of lines) {
              try {
                const json = JSON.parse(line);
                // Look for thinking in various formats
                const thinkingContent = json.thinking || json.content?.thinking || 
                  (json.type === 'thinking' && json.text) ||
                  (json.message?.content?.find?.((b: any) => b.type === 'thinking')?.thinking);
                
                if (thinkingContent && thinkingContent.length > 20) {
                  console.log(`[Sandbox] Extracted thinking: ${thinkingContent.slice(0, 100)}...`);
                  
                  // Accumulate thinking for persistence
                  const truncated = thinkingContent.slice(0, 1000);
                  thinkingOutput += truncated + '\n\n';
                  
                  terminalEvents.emit(`terminal:${sessionId}`, {
                    type: 'thinking',
                    data: truncated,
                    timestamp: Date.now(),
                  });
                }
              } catch {
                // Not valid JSON, skip
              }
            }
          }
        }
      } catch (transcriptErr) {
        console.log(`[Sandbox] Could not read transcript for thinking: ${transcriptErr}`);
      }
    }
    
    // Log full output if short enough
    if (stdout.length < 2000) {
      console.log(`[Sandbox] Full stdout:\n${stdout}`);
    }
    if (stderr.length > 0 && stderr.length < 1000) {
      console.log(`[Sandbox] Full stderr:\n${stderr}`);
    }

    // Emit end event
    terminalEvents.emit(`terminal:${sessionId}`, {
      type: 'end',
      exitCode: result.exitCode,
      elapsed,
      timestamp: Date.now(),
    });

    // For Claude Code, use the parsed text output instead of raw JSON
    const finalOutput = provider === 'claude-code' && textOutput 
      ? textOutput 
      : (stdout || result.stdout || '');
    
    return {
      stdout: finalOutput,
      stderr: stderr || result.stderr || '',
      exitCode: result.exitCode,
      debugLog,
      thinking: thinkingOutput.trim() || undefined,
    };
  }

  /**
   * Extend sandbox lifetime by resetting the timeout.
   * Should be called on each activity to keep the sandbox alive.
   */
  async keepAlive(sessionId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sessionId);
    if (sandbox) {
      try {
        // Extend timeout to max (1 hour for Hobby, 24 hours for Pro)
        await sandbox.setTimeout(SANDBOX_TIMEOUT_S);
        console.log(`[Sandbox] Extended sandbox timeout for ${sessionId}`);
        
        // Update database
        const expiresAt = new Date(Date.now() + SANDBOX_TIMEOUT_S * 1000).toISOString();
        await execute(
          `UPDATE sandboxes SET last_used_at = NOW(), expires_at = $1 WHERE session_key = $2`,
          [expiresAt, sessionId]
        );
      } catch (error) {
        console.error(`[Sandbox] Failed to extend sandbox timeout:`, error);
        // If this fails, the sandbox might be dead
      }
    }
  }

  async getSandbox(sessionId: string): Promise<Sandbox | undefined> {
    // First check in-memory cache
    let sandbox = this.sandboxes.get(sessionId);
    if (sandbox) {
      // Update last_used_at in database
      try {
        await execute(
          `UPDATE sandboxes SET last_used_at = NOW() WHERE session_key = $1`,
          [sessionId]
        );
      } catch (e) {
        // Ignore update errors
      }
      return sandbox;
    }

    // Try to reconnect from database (only if not expired)
    try {
      const record = await queryOne<SandboxRecord>(
        `SELECT * FROM sandboxes WHERE session_key = $1 AND status = 'running'
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [sessionId]
      );

      if (record) {
        console.log(`[Sandbox] Attempting to reconnect to sandbox ${record.e2b_sandbox_id} for session ${sessionId}`);
        
        try {
          // Reconnect to the existing sandbox
          sandbox = await Sandbox.connect(record.e2b_sandbox_id, {
            apiKey: OC_API_KEY,
          });
          
          // Cache it in memory
          this.sandboxes.set(sessionId, sandbox);
          
          // Update last_used_at
          await execute(
            `UPDATE sandboxes SET last_used_at = NOW() WHERE session_key = $1`,
            [sessionId]
          );
          
          console.log(`[Sandbox] Successfully reconnected to sandbox ${record.e2b_sandbox_id}`);
          return sandbox;
        } catch (connectError) {
          // Sandbox no longer exists in E2B, clean up database
          console.log(`[Sandbox] Sandbox ${record.e2b_sandbox_id} no longer exists, cleaning up`);
          await execute(
            `UPDATE sandboxes SET status = 'terminated' WHERE session_key = $1`,
            [sessionId]
          );
          return undefined;
        }
      }
    } catch (error) {
      console.error(`[Sandbox] Error checking database for sandbox:`, error);
    }

    return undefined;
  }

  async cloneRepo(
    sessionId: string,
    repoUrl: string,
    branch: string,
    githubToken: string
  ): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    // Validate repoUrl is not null/undefined
    if (!repoUrl) {
      return { success: false, error: 'Repository URL is required' };
    }

    try {
      // Configure git with token for authentication
      let authUrl = repoUrl;
      if (repoUrl.startsWith('https://')) {
        authUrl = repoUrl.replace('https://', `https://${githubToken}@`);
      } else if (repoUrl.startsWith('git@')) {
        authUrl = repoUrl
          .replace('git@github.com:', `https://${githubToken}@github.com/`)
          .replace(/\.git$/, '') + '.git';
      }

      console.log(`[Sandbox] Cloning repo: ${repoUrl} (branch: ${branch})`);

      // Use home directory for workspace
      await sandbox.exec.run('rm -rf ~/workspace && mkdir -p ~/workspace');

      // Clone the repository
      const result = await sandbox.exec.run(
        `git clone --branch ${branch} ${authUrl} ~/workspace`,
        { timeout: 120 }
      );

      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || 'Clone failed' };
      }

      // Configure git user for commits
      await sandbox.exec.run('cd ~/workspace && git config user.email "agent@orchestrator.local"');
      await sandbox.exec.run('cd ~/workspace && git config user.name "Agent Orchestrator"');

      return { success: true };
    } catch (error) {
      console.error('[Sandbox] Clone error:', error);
      return { success: false, error: String(error) };
    }
  }

  async runCommand(
    sessionId: string,
    command: string,
    cwd: string = '~/workspace'
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      throw new Error('Sandbox not found');
    }

    // OpenComputer exec.run() — synchronous command execution
    const result = await sandbox.exec.run(`cd ${cwd} && ${command}`, {
      timeout: 600, // 10 minute timeout for commands
    });

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      exitCode: result.exitCode,
    };
  }

  async writeFile(sessionId: string, path: string, content: string | Buffer): Promise<void> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) throw new Error('Sandbox not found');
    
    if (Buffer.isBuffer(content)) {
      // For binary content, write as base64 and decode
      const base64 = content.toString('base64');
      await sandbox.exec.run(`echo "${base64}" | base64 -d > "${path}"`);
    } else {
    await sandbox.files.write(path, content);
    }
  }

  async readFile(sessionId: string, path: string): Promise<string> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) throw new Error('Sandbox not found');
    return await sandbox.files.read(path);
  }

  async listFiles(sessionId: string, path: string): Promise<string[]> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) throw new Error('Sandbox not found');
    const result = await sandbox.exec.run(`ls -la ${path}`);
    return result.stdout?.split('\n').filter(Boolean) || [];
  }

  async commitChanges(sessionId: string, message: string): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) return { success: false, error: 'Sandbox not found' };

    try {
      await sandbox.exec.run('cd ~/workspace && git add -A');
      const result = await sandbox.exec.run(
        `cd ~/workspace && git commit -m "${message.replace(/"/g, '\\"')}"`
      );

      if (result.exitCode !== 0) {
        if (result.stdout?.includes('nothing to commit')) {
          return { success: true, commitHash: undefined };
        }
        return { success: false, error: result.stderr || 'Commit failed' };
      }

      const hashResult = await sandbox.exec.run('cd ~/workspace && git rev-parse HEAD');
      return { success: true, commitHash: hashResult.stdout?.trim() };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async pushChanges(sessionId: string, branch: string): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) return { success: false, error: 'Sandbox not found' };

    try {
      const result = await sandbox.exec.run(
        `cd ~/workspace && git push origin ${branch}`,
        { timeout: 60 }
      );
      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || 'Push failed' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async createBranch(sessionId: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) return { success: false, error: 'Sandbox not found' };

    try {
      const result = await sandbox.exec.run(`cd ~/workspace && git checkout -b ${branchName}`);
      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || 'Branch creation failed' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Clear a sandbox from cache without trying to kill it (for already-dead sandboxes)
   */
  clearSandbox(sessionId: string): void {
    this.sandboxes.delete(sessionId);
    this.ptysessions.delete(sessionId);
    
    // Update database status asynchronously
    execute(
      `UPDATE sandboxes SET status = 'terminated' WHERE session_key = $1`,
      [sessionId]
    ).catch(err => console.error(`[Sandbox] Failed to update sandbox status:`, err));
    
    console.log(`[Sandbox] Cleared dead sandbox from cache: ${sessionId}`);
  }

  async closeSandbox(sessionId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sessionId);
    if (sandbox) {
      // Close PTY session if exists
      const pty = this.ptysessions.get(sessionId);
      if (pty) {
        try {
          await pty.close();
        } catch (error) {
          console.error(`[Sandbox] Error killing PTY for session ${sessionId}:`, error);
        }
        this.ptysessions.delete(sessionId);
      }

      await sandbox.kill();
      this.sandboxes.delete(sessionId);
      
      // Update database status
      try {
        await execute(
          `UPDATE sandboxes SET status = 'terminated' WHERE session_key = $1`,
          [sessionId]
        );
        console.log(`[Sandbox] Marked sandbox as terminated for session ${sessionId}`);
      } catch (error) {
        console.error(`[Sandbox] Failed to update sandbox status in database:`, error);
      }
    }
  }

  // PTY (Interactive Terminal) Management
  async createPTY(sessionId: string, onData: (data: string) => void): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    try {
      console.log(`[Sandbox] Creating PTY session for ${sessionId}`);

      // Create PTY with bash shell (OpenComputer uses onOutput instead of onData)
      const pty = await sandbox.pty.create({
        onOutput: (data: Uint8Array) => {
          onData(new TextDecoder().decode(data));
        },
        cols: 80,
        rows: 24,
      });

      this.ptysessions.set(sessionId, pty);

      // Start a bash shell
      await pty.send('bash\n');

      return { success: true };
    } catch (error) {
      console.error(`[Sandbox] Error creating PTY:`, error);
      return { success: false, error: String(error) };
    }
  }

  async sendPTYInput(sessionId: string, input: string): Promise<{ success: boolean; error?: string }> {
    const pty = this.ptysessions.get(sessionId);
    if (!pty) {
      return { success: false, error: 'PTY session not found' };
    }

    try {
      await pty.send(input);
      return { success: true };
    } catch (error) {
      console.error(`[Sandbox] Error sending PTY input:`, error);
      return { success: false, error: String(error) };
    }
  }

  async resizePTY(sessionId: string, cols: number, rows: number): Promise<{ success: boolean; error?: string }> {
    const pty = this.ptysessions.get(sessionId);
    if (!pty) {
      return { success: false, error: 'PTY session not found' };
    }

    try {
      // OpenComputer SDK doesn't support PTY resize yet — recreate if needed
      console.log(`[Sandbox] PTY resize requested (${cols}x${rows}) — not supported by SDK, ignoring`);
      return { success: true };
    } catch (error) {
      console.error(`[Sandbox] Error resizing PTY:`, error);
      return { success: false, error: String(error) };
    }
  }

  async closePTY(sessionId: string): Promise<void> {
    const pty = this.ptysessions.get(sessionId);
    if (pty) {
      try {
        await pty.close();
      } catch (error) {
        console.error(`[Sandbox] Error killing PTY:`, error);
      }
      this.ptysessions.delete(sessionId);
    }
  }

  /**
   * Run a command in sandbox, returning result without throwing on non-zero exit
   */
  private async runCommandSafe(sandbox: Sandbox, cmd: string, timeoutSec: number = 30): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const result = await sandbox.exec.run(cmd, { timeout: timeoutSec });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } catch (error: any) {
      // E2B throws on non-zero exit, extract the result
      if (error.result) {
        return {
          exitCode: error.result.exitCode || 1,
          stdout: error.result.stdout || '',
          stderr: error.result.stderr || '',
        };
      }
      return { exitCode: 1, stdout: '', stderr: String(error) };
    }
  }

  /**
   * Install rclone in the sandbox for syncing S3/R2 files
   */
  async installRclone(sessionId: string): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    console.log('[Sandbox] Starting rclone installation...');

    // Check if rclone is already installed
    const checkResult = await this.runCommandSafe(sandbox, 'which rclone', 5000);
    if (checkResult.exitCode === 0) {
      console.log('[Sandbox] rclone already installed');
      return { success: true };
    }

    console.log('[Sandbox] rclone not found, installing...');
    
    // Install rclone using the official install script (works on most Linux)
    const installCmd = 'curl -s https://rclone.org/install.sh | sudo bash 2>&1';
    console.log(`[Sandbox] Running: ${installCmd}`);
    
    const installResult = await this.runCommandSafe(sandbox, installCmd, 120000);
    console.log(`[Sandbox] rclone install: exit=${installResult.exitCode}`);
    console.log(`[Sandbox]   stdout: ${installResult.stdout.slice(0, 500)}`);
    if (installResult.stderr) console.log(`[Sandbox]   stderr: ${installResult.stderr.slice(0, 300)}`);
    
    // Verify installation
    const verifyResult = await this.runCommandSafe(sandbox, 'which rclone && rclone version | head -1', 5000);
    if (verifyResult.exitCode === 0) {
      console.log(`[Sandbox] rclone installed: ${verifyResult.stdout.trim()}`);
      return { success: true };
    }

    return { success: false, error: `rclone install failed: ${installResult.stderr || installResult.stdout}` };
  }

  /**
   * Sync files from S3/R2 to sandbox using rclone
   */
  async syncWithRclone(
    sessionId: string,
    config: {
      provider: 'r2' | 's3' | 's3-compatible';
      bucketName: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;
      region?: string;
      remotePath: string;  // Path within the bucket (e.g., userId/bucketId)
      localPath: string;   // Where to sync to in sandbox
    }
  ): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    const { provider, bucketName, accessKeyId, secretAccessKey, endpoint, region, remotePath, localPath } = config;

    console.log(`[Sandbox] Syncing ${bucketName}/${remotePath} to ${localPath} via rclone...`);

    // Create rclone config file
    let rcloneConfig = '[remote]\n';
    rcloneConfig += 'type = s3\n';
    rcloneConfig += `access_key_id = ${accessKeyId}\n`;
    rcloneConfig += `secret_access_key = ${secretAccessKey}\n`;
    
    if (provider === 'r2') {
      rcloneConfig += 'provider = Cloudflare\n';
      rcloneConfig += `endpoint = ${endpoint}\n`;
    } else if (provider === 's3') {
      rcloneConfig += 'provider = AWS\n';
      rcloneConfig += `region = ${region || 'us-east-1'}\n`;
    } else {
      rcloneConfig += 'provider = Other\n';
      rcloneConfig += `endpoint = ${endpoint}\n`;
      rcloneConfig += `region = ${region || 'auto'}\n`;
    }

    // Write config to sandbox
    const configPath = '/tmp/rclone.conf';
    const writeConfigCmd = `cat > ${configPath} << 'RCLONEEOF'
${rcloneConfig}
RCLONEEOF`;
    
    const writeResult = await this.runCommandSafe(sandbox, writeConfigCmd, 5000);
    if (writeResult.exitCode !== 0) {
      return { success: false, error: `Failed to write rclone config: ${writeResult.stderr}` };
    }

    // Create local directory
    await this.runCommandSafe(sandbox, `mkdir -p ${localPath}`, 5000);

    // Run rclone sync
    const syncCmd = `rclone copy --config ${configPath} "remote:${bucketName}/${remotePath}" "${localPath}" -v 2>&1`;
    console.log(`[Sandbox] Running: rclone copy remote:${bucketName}/${remotePath} ${localPath}`);
    
    const syncResult = await this.runCommandSafe(sandbox, syncCmd, 300000); // 5 min timeout for large syncs
    console.log(`[Sandbox] rclone sync: exit=${syncResult.exitCode}`);
    console.log(`[Sandbox]   output: ${syncResult.stdout.slice(0, 500)}`);
    
    if (syncResult.exitCode !== 0) {
      return { success: false, error: `rclone sync failed: ${syncResult.stdout}` };
    }

    // List what was synced
    const listResult = await this.runCommandSafe(sandbox, `ls -la ${localPath}`, 5000);
    console.log(`[Sandbox] Synced files:\n${listResult.stdout}`);

    // Clean up config (contains credentials)
    await this.runCommandSafe(sandbox, `rm -f ${configPath}`, 5000);

    console.log(`[Sandbox] Successfully synced ${bucketName}/${remotePath} to ${localPath}`);
    return { success: true };
  }

  /**
   * Sync files from sandbox back to S3/R2 using rclone (reverse sync)
   * Call this after task completion to persist files created by the agent
   */
  async syncBackWithRclone(
    sessionId: string,
    config: {
      provider: 'r2' | 's3' | 's3-compatible';
      bucketName: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;
      region?: string;
      remotePath: string;  // Path within the bucket (e.g., userId/bucketId)
      localPath: string;   // Where files are in sandbox
    }
  ): Promise<{ success: boolean; error?: string; filesUploaded?: number }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    try {
      const { provider, bucketName, accessKeyId, secretAccessKey, endpoint, region, remotePath, localPath } = config;

      // Check if localPath exists and has files
      const checkResult = await this.runCommandSafe(sandbox, `ls -la ${localPath} 2>/dev/null | wc -l`, 5000);
      const fileCount = parseInt(checkResult.stdout.trim()) || 0;
      if (fileCount <= 1) { // Only "total" line, no files
        console.log(`[Sandbox] No files to sync back from ${localPath}`);
        return { success: true, filesUploaded: 0 };
      }

      // Build rclone config
      let rcloneConfig = `[remote]\ntype = s3\nprovider = `;
      if (provider === 'r2') {
        rcloneConfig += 'Cloudflare';
        rcloneConfig += `\nendpoint = ${endpoint}`;
        rcloneConfig += '\nacl = private';
      } else if (provider === 's3-compatible') {
        rcloneConfig += 'Other';
        rcloneConfig += `\nendpoint = ${endpoint}`;
      } else {
        rcloneConfig += 'AWS';
        if (region) rcloneConfig += `\nregion = ${region}`;
      }
      rcloneConfig += `\naccess_key_id = ${accessKeyId}`;
      rcloneConfig += `\nsecret_access_key = ${secretAccessKey}`;

      // Write config to temp file
      const configPath = `/tmp/rclone-${Date.now()}.conf`;
      await this.runCommandSafe(sandbox, `cat > ${configPath} << 'RCLONE_EOF'\n${rcloneConfig}\nRCLONE_EOF`, 5000);

      // Run rclone copy (sandbox -> cloud) - REVERSE direction
      const syncCmd = `rclone copy --config ${configPath} "${localPath}" "remote:${bucketName}/${remotePath}" -v 2>&1`;
      console.log(`[Sandbox] Running sync-back: rclone copy ${localPath} -> remote:${bucketName}/${remotePath}`);
      
      const syncResult = await this.runCommandSafe(sandbox, syncCmd, 300000); // 5 min timeout
      console.log(`[Sandbox] rclone sync-back: exit=${syncResult.exitCode}`);
      console.log(`[Sandbox]   output: ${syncResult.stdout.slice(0, 500)}`);
      
      if (syncResult.exitCode !== 0) {
        return { success: false, error: `rclone sync-back failed: ${syncResult.stdout}` };
      }

      // Clean up config
      await this.runCommandSafe(sandbox, `rm -f ${configPath}`, 5000);

      console.log(`[Sandbox] Successfully synced back ${localPath} to ${bucketName}/${remotePath}`);
      return { success: true, filesUploaded: fileCount - 1 }; // Subtract 1 for "total" line
    } catch (error) {
      console.error('[Sandbox] Sync-back error:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Mount an S3/R2 bucket directly to the sandbox filesystem
   */
  async mountS3Bucket(
    sessionId: string,
    config: {
      provider: 'r2' | 's3' | 's3-compatible';
      bucketName: string;
      accessKeyId: string;
      secretAccessKey: string;
      endpoint?: string;  // Required for R2 and s3-compatible
      region?: string;
      mountPath: string;
      storagePath: string;  // Path within the bucket (e.g., userId/bucketId)
    }
  ): Promise<{ success: boolean; error?: string }> {
    const sandbox = this.sandboxes.get(sessionId);
    if (!sandbox) {
      return { success: false, error: 'Sandbox not found' };
    }

    try {
      const { provider, bucketName, accessKeyId, secretAccessKey, endpoint, region, mountPath, storagePath } = config;

      // Create credentials file
      const credsContent = `${accessKeyId}:${secretAccessKey}`;
      await sandbox.exec.run(`echo '${credsContent}' > /tmp/.s3fs-creds && chmod 600 /tmp/.s3fs-creds`);

      // Create mount point
      await sandbox.exec.run(`mkdir -p ${mountPath}`);

      // Build s3fs options based on provider
      let s3fsOpts = '-o passwd_file=/tmp/.s3fs-creds';
      s3fsOpts += ' -o use_path_request_style';  // Required for most S3-compatible services
      s3fsOpts += ' -o allow_other';  // Allow other users to access
      s3fsOpts += ' -o nonempty';  // Allow mounting on non-empty directory
      
      if (provider === 'r2') {
        // Cloudflare R2 specific options
        s3fsOpts += ` -o url=${endpoint}`;
        s3fsOpts += ' -o no_check_certificate';  // R2 sometimes needs this
      } else if (provider === 's3-compatible') {
        // Generic S3-compatible (MinIO, etc.)
        s3fsOpts += ` -o url=${endpoint}`;
      } else if (provider === 's3') {
        // AWS S3
        if (region) {
          s3fsOpts += ` -o endpoint=${region}`;
        }
      }

      // Mount with subpath - s3fs mounts the whole bucket, we'll use a symlink for the subpath
      // First, mount the bucket to a temp location
      const tempMount = `/tmp/s3mount-${Date.now()}`;
      await sandbox.exec.run(`mkdir -p ${tempMount}`);
      
      const mountCmd = `s3fs ${bucketName} ${tempMount} ${s3fsOpts}`;
      console.log(`[Sandbox] Mounting S3 bucket: ${mountCmd.replace(credsContent, '***:***')}`);
      
      const mountResult = await sandbox.exec.run(mountCmd, { timeout: 30 });

      if (mountResult.exitCode !== 0) {
        console.error(`[Sandbox] s3fs mount failed: ${mountResult.stderr}`);
        return { success: false, error: `Mount failed: ${mountResult.stderr?.slice(0, 500)}` };
      }

      // Create the storage path within the mounted bucket if it doesn't exist
      await sandbox.exec.run(`mkdir -p ${tempMount}/${storagePath}`);

      // Create a symlink from the mount path to the specific storage path
      await sandbox.exec.run(`rm -rf ${mountPath} && ln -s ${tempMount}/${storagePath} ${mountPath}`);

      console.log(`[Sandbox] Successfully mounted ${bucketName}/${storagePath} to ${mountPath}`);
      return { success: true };
    } catch (error) {
      console.error('[Sandbox] S3 mount error:', error);
      return { success: false, error: String(error) };
    }
  }

}

export const ocService = new OCService();
