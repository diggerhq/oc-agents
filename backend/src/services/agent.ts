import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { ocService } from './oc.js';
import { v4 as uuidv4 } from 'uuid';
import { execute } from '../db/index.js';
import type { Message } from '../types/index.js';

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model provider types
export type ModelProvider = 'anthropic' | 'openai';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
}

// Available models
export const AVAILABLE_MODELS: Record<ModelProvider, string[]> = {
  anthropic: ['claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101', 'claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini'],
};

export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o',
};

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.Messages.ContentBlock[];
}

const SYSTEM_PROMPT = `You are an AI coding assistant running in a sandbox environment.
You have access to a cloned git repository at ~/workspace.

You can use the following tools to help complete tasks:
- run_command: Execute shell commands in the sandbox
- read_file: Read the contents of a file
- write_file: Write content to a file
- list_files: List files in a directory

When making changes:
1. First understand the codebase structure
2. Make targeted, minimal changes
3. Test your changes if possible
4. Commit your changes with a descriptive message

Always explain what you're doing and why.`;

// Anthropic tool definitions
const anthropicTools: Anthropic.Messages.Tool[] = [
  {
    name: 'run_command',
    description: 'Execute a shell command in the sandbox. Use this for running tests, installing dependencies, git operations, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (default: ~/workspace)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path to the file',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file (creates or overwrites)',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path to the file',
        },
        content: {
          type: 'string',
          description: 'The content to write',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories at a path',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'commit_changes',
    description: 'Stage and commit all changes in the repository',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: {
          type: 'string',
          description: 'The commit message',
        },
      },
      required: ['message'],
    },
  },
];

// OpenAI tool definitions (same tools, different format)
const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a shell command in the sandbox. Use this for running tests, installing dependencies, git operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory (default: ~/workspace)',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The absolute path to the file',
          },
          content: {
            type: 'string',
            description: 'The content to write',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories at a path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'commit_changes',
      description: 'Stage and commit all changes in the repository',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The commit message',
          },
        },
        required: ['message'],
      },
    },
  },
];

async function executeTool(
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case 'run_command': {
        const result = await ocService.runCommand(
          sessionId,
          input.command as string,
          (input.cwd as string) || '~/workspace'
        );
        return `Exit code: ${result.exitCode}\n\nStdout:\n${result.stdout}\n\nStderr:\n${result.stderr}`;
      }
      case 'read_file': {
        const content = await ocService.readFile(sessionId, input.path as string);
        return content;
      }
      case 'write_file': {
        await ocService.writeFile(sessionId, input.path as string, input.content as string);
        return `File written successfully: ${input.path}`;
      }
      case 'list_files': {
        const files = await ocService.listFiles(sessionId, input.path as string);
        return files.join('\n');
      }
      case 'commit_changes': {
        const result = await ocService.commitChanges(sessionId, input.message as string);
        if (result.success) {
          return result.commitHash
            ? `Committed successfully: ${result.commitHash}`
            : 'No changes to commit';
        }
        return `Commit failed: ${result.error}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    return `Error executing ${toolName}: ${error}`;
  }
}

export interface AgentRunResult {
  success: boolean;
  response: string;
  error?: string;
  model?: string;
  provider?: ModelProvider;
}

// Run agent with Anthropic Claude
async function runAnthropicAgent(
  sessionId: string,
  taskId: string,
  prompt: string,
  model: string,
  onMessage?: (content: string) => void
): Promise<AgentRunResult> {
  const messages: AgentMessage[] = [
    { role: 'user', content: prompt },
  ];

  try {
    let continueLoop = true;
    let finalResponse = '';

    while (continueLoop) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 8096,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        messages: messages as Anthropic.Messages.MessageParam[],
      });

      // Process response
      const toolUseBlocks: Anthropic.Messages.ToolUseBlock[] = [];
      let textContent = '';

      for (const block of response.content) {
        if (block.type === 'text') {
          textContent += block.text;
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }

      // Save assistant message
      if (textContent) {
        const msgId = uuidv4();
        await execute(
          "INSERT INTO messages (id, task_id, role, content) VALUES ($1, $2, 'assistant', $3)",
          [msgId, taskId, textContent]
        );
        onMessage?.(textContent);
        finalResponse = textContent;
      }

      // If no tool use, we're done
      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        continueLoop = false;
        break;
      }

      // Add assistant message with tool use to history
      messages.push({ role: 'assistant', content: response.content });

      // Execute tools and collect results
      const toolResults: ToolResult[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(
          sessionId,
          toolUse.name,
          toolUse.input as Record<string, unknown>
        );

        // Save tool execution as a system message
        const toolMsgId = uuidv4();
        await execute(
          "INSERT INTO messages (id, task_id, role, content) VALUES ($1, $2, 'system', $3)",
          [toolMsgId, taskId, `Tool: ${toolUse.name}\nInput: ${JSON.stringify(toolUse.input)}\nResult: ${result}`]
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Add tool results to messages
      messages.push({
        role: 'user',
        content: toolResults as unknown as Anthropic.Messages.ContentBlock[],
      });
    }

    return { success: true, response: finalResponse, model, provider: 'anthropic' };
  } catch (error) {
    throw error;
  }
}

// Run agent with OpenAI
async function runOpenAIAgent(
  sessionId: string,
  taskId: string,
  prompt: string,
  model: string,
  onMessage?: (content: string) => void
): Promise<AgentRunResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  try {
    let continueLoop = true;
    let finalResponse = '';

    while (continueLoop) {
      const response = await openai.chat.completions.create({
        model,
        max_tokens: 8096,
        tools: openaiTools,
        messages,
      });

      const choice = response.choices[0];
      const message = choice.message;

      // Add assistant message to history
      messages.push(message);

      // Extract text content
      if (message.content) {
        const msgId = uuidv4();
        await execute(
          "INSERT INTO messages (id, task_id, role, content) VALUES ($1, $2, 'assistant', $3)",
          [msgId, taskId, message.content]
        );
        onMessage?.(message.content);
        finalResponse = message.content;
      }

      // Check for tool calls
      if (!message.tool_calls || message.tool_calls.length === 0 || choice.finish_reason === 'stop') {
        continueLoop = false;
        break;
      }

      // Execute tool calls
      for (const toolCall of message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolInput = JSON.parse(toolCall.function.arguments);

        const result = await executeTool(sessionId, toolName, toolInput);

        // Save tool execution as a system message
        const toolMsgId = uuidv4();
        await execute(
          "INSERT INTO messages (id, task_id, role, content) VALUES ($1, $2, 'system', $3)",
          [toolMsgId, taskId, `Tool: ${toolName}\nInput: ${JSON.stringify(toolInput)}\nResult: ${result}`]
        );

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    return { success: true, response: finalResponse, model, provider: 'openai' };
  } catch (error) {
    throw error;
  }
}

export async function runAgent(
  sessionId: string,
  taskId: string,
  prompt: string,
  modelConfig?: ModelConfig,
  onMessage?: (content: string) => void
): Promise<AgentRunResult> {
  // Default to Anthropic Claude if not specified
  const provider = modelConfig?.provider || 'anthropic';
  const model = modelConfig?.model || DEFAULT_MODELS[provider];

  // Update task status to running
  await execute(
    "UPDATE tasks SET status = 'running', updated_at = NOW() WHERE id = $1",
    [taskId]
  );

  try {
    let result: AgentRunResult;

    if (provider === 'openai') {
      result = await runOpenAIAgent(sessionId, taskId, prompt, model, onMessage);
    } else {
      result = await runAnthropicAgent(sessionId, taskId, prompt, model, onMessage);
    }

    // Update task status to completed
    await execute(
      "UPDATE tasks SET status = 'completed', result = $1, updated_at = NOW() WHERE id = $2",
      [result.response, taskId]
    );

    return result;
  } catch (error) {
    const errorMsg = String(error);
    await execute(
      "UPDATE tasks SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2",
      [errorMsg, taskId]
    );
    return { success: false, response: '', error: errorMsg, model, provider };
  }
}

// Export available models for API
export function getAvailableModels() {
  return {
    providers: Object.keys(AVAILABLE_MODELS),
    models: AVAILABLE_MODELS,
    defaults: DEFAULT_MODELS,
  };
}
