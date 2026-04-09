/**
 * Portal Agent Service
 * 
 * Core streaming engine that calls the Anthropic Messages API directly
 * with extended thinking, tool use, and streaming SSE responses.
 * 
 * This replaces the E2B sandbox + Claude Code CLI approach used by
 * task/code agents. Tools execute server-side in the Node.js process.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { executeTool, getPortalAgentTools, buildToolContext, type ToolContext } from './portalAgentTools.js';
import { loadAgentSkillFiles, generateSkillPromptAddition } from './skillDetection.js';
import { queryOne, query, execute } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import type { AgentConfig } from '../types/index.js';

// ==========================================
// Model Configuration
// ==========================================

/**
 * Get the maximum output tokens allowed for each model
 * These are the actual API limits from Anthropic
 */
function getMaxTokensForModel(model: string): number {
  // Map model IDs to their max output token limits
  const modelLimits: Record<string, number> = {
    'claude-sonnet-4-5-20250929': 64000,
    'claude-opus-4-5-20251101': 64000,
    'claude-sonnet-4-20250514': 64000,
    // Future models can be added here
  };
  
  return modelLimits[model] || 16000; // Fallback to conservative default
}

/**
 * Get the thinking budget for extended thinking
 * Use a reasonable default that works for all models
 */
function getThinkingBudgetForModel(model: string): number {
  // All models that support extended thinking can handle up to 128k thinking tokens
  // But we use 64k as a reasonable default to balance capability and cost
  return 64000;
}

// ==========================================
// Types
// ==========================================

export interface PortalAgentConfig {
  model: string;
  systemPrompt: string;
  sandboxEnabled: boolean;
  enabledTools?: string[];
}

export interface StreamContext {
  agentId: string;
  sessionId: string;   // portal session ID
  threadId: string;
  userId: string;       // agent owner user ID
  portalUserId?: string | null;  // visitor/portal user ID for user-scoped file storage
  organizationId?: string | null;
  content: string;      // user message
  previousMessages: Array<{ role: string; content: string; thinking_content?: string }>;
  config: PortalAgentConfig;
  portalSession?: { user_context?: string };
}

interface SSEWriter {
  write: (event: SSEEvent) => void;
  end: () => void;
}

type SSEEvent =
  | { type: 'status'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown>; toolUseId: string }
  | { type: 'tool_result'; tool: string; result: string; toolUseId: string; duration: number }
  | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; content: string };

// ==========================================
// SSE Helpers
// ==========================================

function createSSEWriter(res: Response): SSEWriter {
  return {
    write(event: SSEEvent) {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Connection may be closed
      }
    },
    end() {
      try {
        res.end();
      } catch {
        // Already closed
      }
    },
  };
}

// ==========================================
// Conversation History Builder
// ==========================================

/**
 * Build Anthropic messages array from stored portal messages.
 * Preserves thinking blocks from previous assistant turns to maintain
 * reasoning continuity across the tool loop.
 */
function buildConversationMessages(
  previousMessages: Array<{ role: string; content: string; thinking_content?: string }>,
  currentUserMessage: string,
  userContextStr: string
): Anthropic.Messages.MessageParam[] {
  const messages: Anthropic.Messages.MessageParam[] = [];

  for (const msg of previousMessages) {
    if (msg.role === 'user') {
      // Skip empty user messages
      if (msg.content && msg.content.trim()) {
        messages.push({ role: 'user', content: msg.content });
      }
    } else if (msg.role === 'assistant') {
      // For conversation history, use plain text content only.
      // We do NOT reconstruct thinking/tool blocks because:
      // 1. Thinking blocks require the exact cryptographic signature from the original API response
      // 2. We don't persist signatures (they're only valid within a single turn/tool loop)
      // 3. The thinking_content field is for frontend UI display, not for API replay
      // The model gets full context from the text content alone.
      if (msg.content && msg.content.trim()) {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  // Add current user message with optional context
  const userContent = userContextStr
    ? `${userContextStr}\n\n${currentUserMessage}`
    : currentUserMessage;
  
  // Ensure user message is non-empty
  if (!userContent || !userContent.trim()) {
    throw new Error('User message content cannot be empty');
  }
  
  messages.push({ role: 'user', content: userContent });

  return messages;
}

// ==========================================
// Core Streaming Engine
// ==========================================

/**
 * Handle a portal agent stream request.
 * 
 * This is the main entry point called from the portal route.
 * It:
 * 1. Sets up SSE connection
 * 2. Builds system prompt (with skills, context)
 * 3. Calls Anthropic API with streaming
 * 4. Handles the tool loop (tool_use -> execute -> continue)
 * 5. Persists messages to the database
 */
export async function handlePortalAgentStream(
  res: Response,
  context: StreamContext
): Promise<void> {
  const sse = createSSEWriter(res);
  const startTime = Date.now();

  try {
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    if (!process.env.ANTHROPIC_API_KEY) {
      sse.write({ type: 'error', content: 'ANTHROPIC_API_KEY is not configured' });
      sse.end();
      return;
    }

    sse.write({ type: 'status', content: 'Initializing...' });

    // Build tool context (resolves buckets, KBs, etc.)
    const toolContext = await buildToolContext(
      context.agentId,
      context.userId,
      context.organizationId,
      {
        portalUserId: context.portalUserId,
        sseEmit: (event) => sse.write(event as SSEEvent),
      }
    );

    // Get available tools
    const tools = getPortalAgentTools({
      sandboxEnabled: context.config.sandboxEnabled,
      enabledTools: context.config.enabledTools,
    });

    // Build system prompt with skills
    let systemPrompt = context.config.systemPrompt || 'You are a helpful AI assistant.';

    // Append skill files if available
    try {
      const { skillFiles } = await loadAgentSkillFiles(context.agentId, context.userId);
      if (skillFiles && skillFiles.length > 0) {
        const skillAddition = generateSkillPromptAddition(skillFiles);
        if (skillAddition) {
          systemPrompt += skillAddition;
        }
        console.log(`[PortalAgent] Loaded ${skillFiles.length} skill files into system prompt`);
      }
    } catch (err) {
      console.error('[PortalAgent] Error loading skill files:', err);
    }

    // Add tool context info to system prompt
    if (toolContext.buckets.length > 0) {
      systemPrompt += `\n\nYou have access to the following file buckets: ${toolContext.buckets.map(b => b.name).join(', ')}`;
    }
    if (toolContext.knowledgeBases.length > 0) {
      systemPrompt += `\nYou have access to the following knowledge bases: ${toolContext.knowledgeBases.map(kb => kb.name).join(', ')}. Use search_knowledge_base to find relevant information.`;
    }

    // Add file formatting instructions
    systemPrompt += `

## Important: File Reference Formatting

When you create files using write_file and mention them in your response, ALWAYS format the filename as inline code using backticks. This makes them clickable for the user.

Examples:
✓ CORRECT: "I've created a summary in \`report.md\`"
✓ CORRECT: "Check out \`analysis.txt\` for details"
✗ INCORRECT: "I've created a summary in **report.md**"
✗ INCORRECT: "Check out 'analysis.txt' for details"

The user interface automatically detects filenames in backticks and makes them clickable links to preview the file.

## Important: File Storage

When writing files, you should save them to the OUTPUT bucket (writable bucket). When you use list_files, you'll see which buckets are writable and which are read-only:
- **Writable (output) buckets**: Use these for saving generated files, results, analyses, etc.
- **Read-only (input) buckets**: These contain reference files you can read but not modify.

Always write new files to a writable bucket. If no bucket name is specified in write_file, the system will automatically use the first writable bucket.`;


    // Build user context string
    let userContextStr = '';
    if (context.portalSession?.user_context) {
      try {
        const ctx = JSON.parse(context.portalSession.user_context);
        userContextStr = `User context: ${JSON.stringify(ctx)}`;
      } catch { /* ignore */ }
    }

    // Build conversation messages
    const messages = buildConversationMessages(
      context.previousMessages,
      context.content,
      userContextStr
    );

    // Save user message to database
    const userMsgId = uuidv4();
    await execute(
      `INSERT INTO portal_messages (id, thread_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [userMsgId, context.threadId, context.content]
    );

    // Run the streaming tool loop with model-appropriate limits
    const maxTokens = getMaxTokensForModel(context.config.model);
    const thinkingBudget = getThinkingBudgetForModel(context.config.model);
    
    const result = await streamWithToolLoop(
      anthropic,
      {
        model: context.config.model,
        maxTokens,
        thinkingBudget,
        systemPrompt,
        tools,
        messages,
      },
      toolContext,
      sse
    );

    // Save assistant message to database
    // Ensure content is not empty - use fallback if needed
    const assistantContent = result.text || (result.thinkingContent ? '[Response with thinking/tools]' : 'Processing complete.');
    const assistantMsgId = uuidv4();
    
    console.log('[PortalAgent] Saving assistant message with thinking_content:', {
      messageId: assistantMsgId,
      threadId: context.threadId,
      contentLength: assistantContent.length,
      hasThinkingContent: !!result.thinkingContent,
      thinkingBlocksCount: result.thinkingContent ? result.thinkingContent.length : 0,
    });
    
    await execute(
      `INSERT INTO portal_messages (id, thread_id, role, content, thinking_content) VALUES ($1, $2, 'assistant', $3, $4)`,
      [assistantMsgId, context.threadId, assistantContent, result.thinkingContent ? JSON.stringify(result.thinkingContent) : null]
    );

    // Update thread title if it's the first exchange
    const messageCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM portal_messages WHERE thread_id = $1',
      [context.threadId]
    );
    if (messageCount && parseInt(messageCount.count) <= 2) {
      // Auto-generate title from first user message
      const title = context.content.slice(0, 80) + (context.content.length > 80 ? '...' : '');
      await execute(
        'UPDATE portal_threads SET title = $1 WHERE id = $2',
        [title, context.threadId]
      );
    }

    const duration = Date.now() - startTime;
    sse.write({
      type: 'done',
      usage: result.usage
        ? { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens }
        : undefined,
    });

    console.log(`[PortalAgent] Stream completed in ${duration}ms for thread ${context.threadId}`);
  } catch (err: any) {
    console.error('[PortalAgent] Stream error:', err);
    sse.write({ type: 'error', content: err.message || 'An error occurred' });
  } finally {
    sse.end();
  }
}

// ==========================================
// Streaming Tool Loop
// ==========================================

interface ToolLoopConfig {
  model: string;
  maxTokens: number;
  thinkingBudget: number;
  systemPrompt: string;
  tools: Anthropic.Messages.Tool[];
  messages: Anthropic.Messages.MessageParam[];
}

interface ToolLoopResult {
  text: string;
  thinkingContent: any[] | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

/**
 * Run the streaming tool loop.
 * 
 * This streams the response, and when Claude requests tool use,
 * executes tools server-side and continues the conversation.
 * Thinking blocks are preserved across tool loop iterations.
 */
async function streamWithToolLoop(
  anthropic: Anthropic,
  config: ToolLoopConfig,
  toolContext: ToolContext,
  sse: SSEWriter,
  maxIterations: number = 20
): Promise<ToolLoopResult> {
  let messages = [...config.messages];
  let totalText = '';
  // Chronological content blocks for interleaved persistence (matches frontend ContentBlock format)
  let chronologicalBlocks: Array<{
    type: 'thinking' | 'text' | 'tool_use';
    id: string;
    content?: string;
    thinking?: string;  // For thinking blocks (matches Anthropic API structure)
    signature?: string | null;  // For thinking blocks signature field
    toolName?: string;
    input?: unknown;
    result?: unknown;
    status?: 'running' | 'completed' | 'error';
    duration?: number;
    isError?: boolean;
  }> = [];
  let blockCounter = 0;
  let totalUsage = { input_tokens: 0, output_tokens: 0 };
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Build request params
    const requestParams: Anthropic.Messages.MessageCreateParams = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages,
      tools: config.tools.length > 0 ? config.tools : undefined,
      tool_choice: config.tools.length > 0 ? { type: 'auto' as const } : undefined,
      stream: true,
    };


    // Add thinking config (budget must be >= 1024 and < max_tokens)
    if (config.thinkingBudget >= 1024) {
      (requestParams as any).thinking = {
        type: 'enabled',
        budget_tokens: Math.min(config.thinkingBudget, config.maxTokens - 1),
      };
    }

    // Stream the response
    const streamResult = await streamAnthropicResponse(
      anthropic,
      requestParams,
      sse
    );

    // Accumulate usage
    if (streamResult.usage) {
      totalUsage.input_tokens += streamResult.usage.input_tokens;
      totalUsage.output_tokens += streamResult.usage.output_tokens;
    }

    // Accumulate text
    totalText += streamResult.text;

    // Build chronological blocks from this iteration's content
    console.log(`[PortalAgent] Iteration ${iteration} allContentBlocks:`,
      streamResult.allContentBlocks.map((b: any) => ({
        type: b.type,
        thinkingLen: b.thinking?.length,
        textLen: b.text?.length,
        preview: (b.thinking || b.text || '')?.slice(0, 80),
      }))
    );
    for (const block of streamResult.allContentBlocks) {
      if ((block as any).type === 'thinking') {
        const thinkingContent = (block as any).thinking || '';
        // Only add non-empty thinking blocks
        if (thinkingContent.trim().length > 0) {
          // Extended thinking blocks always need signature field (can be empty string)
          chronologicalBlocks.push({
            type: 'thinking',
            id: `thinking-${blockCounter++}`,
            content: thinkingContent,  // Frontend expects 'content' field for display
            thinking: thinkingContent,  // Keep 'thinking' for API compatibility
            signature: ((block as any).signature && typeof (block as any).signature === 'string') ? (block as any).signature : '',
          });
        }
      } else if ((block as any).type === 'text') {
        const textContent = (block as any).text || '';
        // Only add non-empty text blocks
        if (textContent.trim().length > 0) {
          chronologicalBlocks.push({
            type: 'text',
            id: `text-${blockCounter++}`,
            content: textContent,
          });
        }
      }
      // tool_use blocks from the stream are handled below after execution
    }

    // If no tool use, we're done
    if (streamResult.stopReason !== 'tool_use' || streamResult.toolUseBlocks.length === 0) {
      break;
    }

    // Execute tools and build next message turn
    const assistantContentBlocks = streamResult.allContentBlocks;
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

    for (const toolUse of streamResult.toolUseBlocks) {
      const startTime = Date.now();
      sse.write({
        type: 'tool_start',
        tool: toolUse.name,
        input: toolUse.input as Record<string, unknown>,
        toolUseId: toolUse.id,
      });

      const result = await executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        toolContext
      );

      const duration = Date.now() - startTime;
      sse.write({
        type: 'tool_result',
        tool: toolUse.name,
        result: result.slice(0, 500) + (result.length > 500 ? '...' : ''),
        toolUseId: toolUse.id,
        duration,
      });

      // Save tool activity in chronological order
      chronologicalBlocks.push({
        type: 'tool_use',
        id: toolUse.id || `tool-${blockCounter++}`,
        toolName: toolUse.name,
        input: toolUse.input,
        result: result.slice(0, 2000) + (result.length > 2000 ? '...' : ''),
        status: 'completed',
        duration,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Validate and clean content blocks before sending to API.
    // CRITICAL: thinking blocks MUST include the original signature from the stream.
    // We use assistantContentBlocks directly (which come from allContentBlocks in the 
    // stream parser and include the real cryptographic signature).
    const cleanedContentBlocks = assistantContentBlocks
      .filter((block: any) => {
        // Filter out empty text and thinking blocks
        if (block.type === 'text') return block.text && block.text.trim().length > 0;
        if (block.type === 'thinking') return block.thinking && block.thinking.trim().length > 0;
        return true;
      });

    // Continue conversation with assistant turn + tool results
    // CRITICAL: preserve thinking blocks in the assistant turn
    messages = [
      ...messages,
      { role: 'assistant', content: cleanedContentBlocks },
      { role: 'user', content: toolResults },
    ];
  }

  if (iteration >= maxIterations) {
    console.warn(`[PortalAgent] Hit max iterations (${maxIterations}) in tool loop`);
  }

  return {
    text: totalText,
    thinkingContent: chronologicalBlocks.length > 0 ? chronologicalBlocks : null,
    usage: totalUsage.input_tokens > 0 ? totalUsage : null,
  };
}

// ==========================================
// Anthropic Stream Parser
// ==========================================

interface StreamResult {
  text: string;
  stopReason: string | null;
  toolUseBlocks: Array<{ id: string; name: string; input: unknown }>;
  thinkingBlocks: Array<{ type: string; thinking: string }>;
  allContentBlocks: Anthropic.Messages.ContentBlock[];
  usage: { input_tokens: number; output_tokens: number } | null;
}

/**
 * Stream an Anthropic Messages API response and emit SSE events.
 * 
 * Parses the stream events and sends:
 * - thinking deltas -> SSE 'thinking' events
 * - text deltas -> SSE 'text' events
 * - tool_use blocks -> collected for execution
 * 
 * Returns the complete result for tool loop processing.
 */
async function streamAnthropicResponse(
  anthropic: Anthropic,
  params: Anthropic.Messages.MessageCreateParams,
  sse: SSEWriter
): Promise<StreamResult> {
  const allText: string[] = []; // All text for the final result
  const toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];
  const thinkingBlocks: Array<{ type: string; thinking: string }> = [];
  const allContentBlocks: any[] = [];
  let stopReason: string | null = null;
  let usage: { input_tokens: number; output_tokens: number } | null = null;

  // Track current block being built
  let currentBlockIndex = -1;
  let currentBlockType = '';
  let currentThinkingText = '';
  let currentThinkingSignature: string | null = null;
  let currentTextChunks: string[] = []; // Text for the current text block only
  let currentToolId = '';
  let currentToolName = '';
  let currentToolInputJson = '';

  try {
    const stream = anthropic.messages.stream(params);

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          currentBlockIndex = event.index;
          const block = event.content_block as any;
          currentBlockType = block.type;

          if (block.type === 'thinking') {
            currentThinkingText = '';
            currentThinkingSignature = block.signature || null;  // Capture signature from block start
          } else if (block.type === 'text') {
            currentTextChunks = []; // Reset for this text block
          } else if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            currentToolInputJson = '';
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta as any;

          if (delta.type === 'thinking_delta') {
            currentThinkingText += delta.thinking;
            if (currentThinkingText.length < 200) {
              console.log(`[PortalAgent] thinking delta: "${delta.thinking.slice(0, 60)}" (accumulated: ${currentThinkingText.length} chars)`);
            }
            sse.write({ type: 'thinking', content: delta.thinking });
          } else if (delta.type === 'signature_delta') {
            // Capture the cryptographic signature for thinking blocks
            // This is REQUIRED when passing thinking blocks back in tool loops
            currentThinkingSignature = delta.signature || currentThinkingSignature;
          } else if (delta.type === 'text_delta') {
            const textContent = delta.text;
            if (typeof textContent !== 'string') {
              console.error('[PortalAgent] WARNING: Non-string text delta:', textContent);
            }
            currentTextChunks.push(textContent);
            allText.push(textContent);
            sse.write({ type: 'text', content: textContent });
          } else if (delta.type === 'input_json_delta') {
            currentToolInputJson += delta.partial_json;
          }
          break;
        }

        case 'content_block_stop': {
          if (currentBlockType === 'thinking') {
            // Only push non-empty thinking blocks
            if (currentThinkingText.trim().length > 0) {
              if (!currentThinkingSignature) {
                console.warn('[PortalAgent] WARNING: Thinking block has no signature - this will cause issues in tool loops');
              }
              const thinkingBlock: any = {
                type: 'thinking',
                thinking: currentThinkingText,
              };
              // Only include signature if we actually have one from the stream
              if (currentThinkingSignature && typeof currentThinkingSignature === 'string') {
                thinkingBlock.signature = currentThinkingSignature;
              }
              thinkingBlocks.push(thinkingBlock);
              allContentBlocks.push(thinkingBlock);
            }
          } else if (currentBlockType === 'text') {
            const textContent = currentTextChunks.join('');
            if (typeof textContent !== 'string') {
              console.error('[PortalAgent] ERROR: Non-string text content:', textContent);
            }
            // Only push non-empty text blocks
            if (textContent.trim().length > 0) {
              allContentBlocks.push({
                type: 'text',
                text: textContent,
              });
            }
          } else if (currentBlockType === 'tool_use') {
            let parsedInput: unknown = {};
            try {
              parsedInput = currentToolInputJson ? JSON.parse(currentToolInputJson) : {};
            } catch {
              parsedInput = { raw: currentToolInputJson };
            }
            const toolBlock = {
              id: currentToolId,
              name: currentToolName,
              input: parsedInput,
            };
            toolUseBlocks.push(toolBlock);
            allContentBlocks.push({
              type: 'tool_use',
              ...toolBlock,
            });
          }
          currentBlockType = '';
          break;
        }

        case 'message_delta': {
          const msgDelta = event as any;
          if (msgDelta.delta?.stop_reason) {
            stopReason = msgDelta.delta.stop_reason;
          }
          if (msgDelta.usage) {
            usage = {
              input_tokens: msgDelta.usage.input_tokens || 0,
              output_tokens: msgDelta.usage.output_tokens || 0,
            };
          }
          break;
        }

        case 'message_start': {
          const msg = (event as any).message;
          if (msg?.usage) {
            usage = {
              input_tokens: msg.usage.input_tokens || 0,
              output_tokens: msg.usage.output_tokens || 0,
            };
          }
          break;
        }
      }
    }

    // Get final message for accurate usage
    const finalMessage = await stream.finalMessage();
    if (finalMessage) {
      stopReason = finalMessage.stop_reason;
      usage = {
        input_tokens: finalMessage.usage.input_tokens,
        output_tokens: finalMessage.usage.output_tokens,
      };
    }
  } catch (err: any) {
    console.error('[PortalAgent] Stream error:', err);
    sse.write({ type: 'error', content: `API error: ${err.message}` });
  }

  return {
    text: allText.join(''),
    stopReason,
    toolUseBlocks,
    thinkingBlocks,
    allContentBlocks,
    usage,
  };
}

// ==========================================
// Config Builder
// ==========================================

/**
 * Build portal agent config from database agent_configs record
 * Note: maxTokens and thinkingBudget are now derived from the model automatically
 */
export function buildPortalAgentConfig(config: AgentConfig): PortalAgentConfig {
  return {
    model: config.portal_agent_model || 'claude-sonnet-4-5-20250929',
    systemPrompt: config.system_prompt || 'You are a helpful AI assistant.',
    sandboxEnabled: config.portal_agent_sandbox_enabled !== false, // default to true
    enabledTools: config.portal_agent_tools ? JSON.parse(config.portal_agent_tools) : undefined,
  };
}
