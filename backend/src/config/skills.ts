/**
 * Builtin Skills Configuration
 * 
 * Skills are pre-configured MCP servers that users can enable with one click.
 * Each skill wraps an MCP server with metadata for the UI.
 */

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'productivity' | 'development' | 'data' | 'communication' | 'ai';
  mcp: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  requiredSecrets: string[];  // Secrets that must be configured for this skill
  optionalSecrets?: string[]; // Optional secrets for additional features
  docsUrl?: string;
}

export const BUILTIN_SKILLS: Record<string, BuiltinSkill> = {
  filesystem: {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files in the agent workspace',
    icon: 'folder',
    category: 'development',
    mcp: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/agent-workspace'],
    },
    requiredSecrets: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },

  memory: {
    id: 'memory',
    name: 'Memory',
    description: 'Remember information across conversations',
    icon: 'brain',
    category: 'ai',
    mcp: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    requiredSecrets: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },

  'sequential-thinking': {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Break down complex problems step by step',
    icon: 'list-ordered',
    category: 'ai',
    mcp: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
    requiredSecrets: [],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
};

// Get all skills as an array
export function getBuiltinSkills(): BuiltinSkill[] {
  return Object.values(BUILTIN_SKILLS);
}

// Get skills by category
export function getSkillsByCategory(category: BuiltinSkill['category']): BuiltinSkill[] {
  return Object.values(BUILTIN_SKILLS).filter(skill => skill.category === category);
}

// Check if a skill's required secrets are configured
export function checkSkillSecrets(
  skillId: string,
  agentSecrets: Record<string, string>
): { configured: boolean; missing: string[] } {
  const skill = BUILTIN_SKILLS[skillId];
  if (!skill) {
    return { configured: false, missing: [] };
  }

  const missing = skill.requiredSecrets.filter(secret => !agentSecrets[secret]);
  return {
    configured: missing.length === 0,
    missing,
  };
}

// Resolve secret placeholders in MCP config
export function resolveSkillSecrets(
  skillId: string,
  agentSecrets: Record<string, string>
): BuiltinSkill['mcp'] | null {
  const skill = BUILTIN_SKILLS[skillId];
  if (!skill) return null;

  const resolvedEnv: Record<string, string> = {};
  
  if (skill.mcp.env) {
    for (const [key, value] of Object.entries(skill.mcp.env)) {
      // Replace {{secrets.KEY}} with actual secret value
      resolvedEnv[key] = value.replace(
        /\{\{secrets\.(\w+)\}\}/g,
        (_, secretKey) => agentSecrets[secretKey] || ''
      );
    }
  }

  return {
    ...skill.mcp,
    env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
  };
}
