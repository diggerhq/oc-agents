import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query, execute } from '../db/index.js';
import { attachDefaultBucketToSession } from '../utils/defaultBucket.js';

const router = Router();

// Initialize Anthropic client - log if API key is missing
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[Builder] WARNING: ANTHROPIC_API_KEY not set!');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface BuilderConversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface BuilderMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls: string | null;
  tool_results: string | null;
  created_at: string;
}

interface BuilderMemory {
  id: string;
  user_id: string;
  memory_type: 'preference' | 'fact' | 'context';
  content: string;
  importance: number;
  created_at: string;
  last_accessed: string;
}

// Agent template library
interface AgentTemplateDefinition {
  name: string;
  description: string;
  agent_type: 'code' | 'task';
  system_prompt: string;
  tags: string[];
  workflow_template?: {
    description: string;
    nodes: { type: string; name: string; config?: Record<string, unknown> }[];
  };
}

const AGENT_TEMPLATES: Record<string, AgentTemplateDefinition> = {
  'data-analyst': {
    name: 'Data Analyst',
    description: 'Query databases, generate reports, visualize insights automatically',
    agent_type: 'task',
    system_prompt: `You are a Data Analyst agent. Your role is to:
- Query databases and data sources to extract insights
- Generate comprehensive reports with key findings
- Create data visualizations and charts
- Identify trends, patterns, and anomalies
- Provide actionable recommendations based on data
Be thorough in your analysis and always explain your methodology.`,
    tags: ['analytics', 'reporting', 'sql', 'visualization'],
  },
  'code-reviewer': {
    name: 'Code Reviewer',
    description: 'Review PRs, suggest improvements, enforce coding standards',
    agent_type: 'code',
    system_prompt: `You are a Code Reviewer agent. Your role is to:
- Review code changes for bugs, security issues, and performance problems
- Suggest improvements and refactoring opportunities
- Enforce coding standards and best practices
- Check for proper error handling and edge cases
- Ensure code is well-documented and maintainable
Be constructive in your feedback and explain the reasoning behind suggestions.`,
    tags: ['code-review', 'quality', 'standards', 'security'],
  },
  'research-agent': {
    name: 'Research Agent',
    description: 'Deep research on candidates, companies, or any topic',
    agent_type: 'task',
    system_prompt: `You are a Research Agent. Your role is to:
- Conduct thorough research on any given topic
- Gather information from multiple sources
- Synthesize findings into clear, organized reports
- Identify key insights and patterns
- Provide well-cited and verifiable information
Be comprehensive and objective in your research.`,
    tags: ['research', 'analysis', 'reporting'],
  },
  'ai-sdr': {
    name: 'AI SDR',
    description: 'Qualify leads, personalize outreach, book meetings',
    agent_type: 'task',
    system_prompt: `You are an AI Sales Development Representative. Your role is to:
- Research and qualify potential leads
- Craft personalized outreach messages
- Respond to inbound inquiries professionally
- Schedule meetings and demos
- Track engagement and follow up appropriately
Be professional, personable, and focused on providing value.`,
    tags: ['sales', 'outreach', 'lead-gen', 'automation'],
  },
  'ai-sre': {
    name: 'AI SRE',
    description: 'Monitor systems, diagnose issues, automate incident response',
    agent_type: 'code',
    system_prompt: `You are an AI Site Reliability Engineer. Your role is to:
- Monitor system health and performance metrics
- Diagnose and troubleshoot issues quickly
- Automate incident response procedures
- Implement preventive measures
- Document incidents and create postmortems
Be thorough, systematic, and focused on reliability.`,
    tags: ['devops', 'monitoring', 'incident-response', 'automation'],
  },
  'content-writer': {
    name: 'Content Writer',
    description: 'Generate blog posts, marketing copy, and documentation',
    agent_type: 'task',
    system_prompt: `You are a Content Writer agent. Your role is to:
- Create engaging, well-structured written content
- Adapt tone and style to match brand guidelines
- Research topics thoroughly before writing
- Optimize content for SEO when appropriate
- Edit and refine drafts for clarity and impact
Be creative, clear, and always write with the target audience in mind.`,
    tags: ['content', 'writing', 'marketing', 'copywriting'],
  },
};

// Workflow Templates
const WORKFLOW_TEMPLATES: Record<string, {
  name: string;
  description: string;
  tags: string[];
  nodes: Array<{ type: string; name: string; config?: Record<string, any> }>;
  edges?: Array<{ from: string; to: string }>;
}> = {
  'content-pipeline': {
    name: 'Content Pipeline',
    description: 'Research → Draft → Review → Publish workflow for content creation',
    tags: ['content', 'marketing', 'publishing'],
    nodes: [
      { type: 'start', name: 'Start' },
      { type: 'agent', name: 'Research Agent', config: { prompt_template: 'Research the topic: {{topic}}' } },
      { type: 'agent', name: 'Content Writer', config: { prompt_template: 'Write content based on research: {{research_agent}}' } },
      { type: 'human_checkpoint', name: 'Editorial Review', config: { message: 'Review the draft before publishing' } },
      { type: 'agent', name: 'SEO Optimizer', config: { prompt_template: 'Optimize for SEO: {{content_writer}}' } },
      { type: 'end', name: 'Publish' },
    ],
  },
  'lead-qualification': {
    name: 'Lead Qualification Pipeline',
    description: 'Enrich → Score → Route leads automatically',
    tags: ['sales', 'leads', 'automation'],
    nodes: [
      { type: 'start', name: 'New Lead' },
      { type: 'agent', name: 'Lead Enrichment', config: { prompt_template: 'Enrich lead data for: {{lead_email}}' } },
      { type: 'agent', name: 'Lead Scorer', config: { prompt_template: 'Score this lead based on: {{lead_enrichment}}' } },
      { type: 'condition', name: 'Score Check', config: { expression: 'score >= 70' } },
      { type: 'agent', name: 'SDR Outreach', config: { prompt_template: 'Draft outreach for qualified lead: {{lead_enrichment}}' } },
      { type: 'human_checkpoint', name: 'Review Outreach', config: { message: 'Approve outreach message' } },
      { type: 'end', name: 'Complete' },
    ],
  },
  'incident-response': {
    name: 'Incident Response',
    description: 'Detect → Diagnose → Remediate → Report for system incidents',
    tags: ['devops', 'sre', 'incident', 'automation'],
    nodes: [
      { type: 'start', name: 'Alert Triggered' },
      { type: 'agent', name: 'Diagnostics Agent', config: { prompt_template: 'Diagnose incident: {{alert_details}}' } },
      { type: 'condition', name: 'Severity Check', config: { expression: 'severity === "critical"' } },
      { type: 'human_checkpoint', name: 'Escalation', config: { message: 'Critical incident - requires human approval for remediation' } },
      { type: 'agent', name: 'Remediation Agent', config: { prompt_template: 'Execute remediation for: {{diagnostics_agent}}' } },
      { type: 'agent', name: 'Report Generator', config: { prompt_template: 'Generate incident report: {{diagnostics_agent}} {{remediation_agent}}' } },
      { type: 'end', name: 'Resolved' },
    ],
  },
};

// Tool definitions for the Builder AI
const builderTools: Anthropic.Tool[] = [
  {
    name: 'create_agent',
    description: 'Create a new AI agent. Use this when the user wants to create an agent for coding tasks or workflows.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_type: {
          type: 'string',
          enum: ['code', 'task'],
          description: 'Type of agent: "code" for repository-based coding agents, "task" for standalone task/workflow agents',
        },
        name: {
          type: 'string',
          description: 'A descriptive name for the agent',
        },
        repo_url: {
          type: 'string',
          description: 'GitHub repository URL (required for code agents)',
        },
        branch: {
          type: 'string',
          description: 'Branch to work on (default: main)',
        },
        agent_provider: {
          type: 'string',
          enum: ['claude-code', 'aider', 'opencode'],
          description: 'Which AI provider to use: claude-code (Anthropic), aider (OpenAI), or opencode (multiple providers)',
        },
        system_prompt: {
          type: 'string',
          description: 'Custom instructions for the agent personality and focus',
        },
      },
      required: ['agent_type', 'name'],
    },
  },
  {
    name: 'create_agent_from_template',
    description: 'Create an agent from a pre-built template. Templates include: data-analyst, code-reviewer, research-agent, ai-sdr, ai-sre, content-writer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        template_id: {
          type: 'string',
          enum: ['data-analyst', 'code-reviewer', 'research-agent', 'ai-sdr', 'ai-sre', 'content-writer'],
          description: 'The template to use',
        },
        name_override: {
          type: 'string',
          description: 'Optional custom name (defaults to template name)',
        },
        repo_url: {
          type: 'string',
          description: 'GitHub repository URL (required for code agent templates like code-reviewer and ai-sre)',
        },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'create_workflow_from_template',
    description: 'Create a workflow from a pre-built template. Templates include: content-pipeline, lead-qualification, incident-response.',
    input_schema: {
      type: 'object' as const,
      properties: {
        template_id: {
          type: 'string',
          enum: ['content-pipeline', 'lead-qualification', 'incident-response'],
          description: 'The workflow template to use',
        },
        name_override: {
          type: 'string',
          description: 'Optional custom name (defaults to template name)',
        },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'list_templates',
    description: 'List available agent and workflow templates. Use this when the user wants to see pre-built configurations.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_workflow',
    description: 'Create a new multi-agent workflow for orchestrating multiple agents together. Can optionally include nodes and edges to create a complete workflow in one call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Name for the workflow',
        },
        description: {
          type: 'string',
          description: 'Description of what the workflow does',
        },
        nodes: {
          type: 'array',
          description: 'Array of nodes to create. Each node has: temp_id (string for referencing in edges), node_type, name, config, position_x, position_y',
          items: {
            type: 'object',
            properties: {
              temp_id: { type: 'string', description: 'Temporary ID for referencing this node in edges' },
              node_type: { type: 'string', enum: ['start', 'end', 'agent', 'condition', 'human_checkpoint', 'parallel_split', 'parallel_merge', 'transform', 'delay'] },
              name: { type: 'string' },
              config: { type: 'object' },
              position_x: { type: 'number' },
              position_y: { type: 'number' },
            },
          },
        },
        edges: {
          type: 'array',
          description: 'Array of edges connecting nodes. Each edge has: source (temp_id), target (temp_id), condition_label (optional: "true", "false", "default", "error")',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'temp_id of source node' },
              target: { type: 'string', description: 'temp_id of target node' },
              condition_label: { type: 'string', description: 'Label for conditional edges' },
            },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_workflow_node',
    description: 'Add a node to an existing workflow. Node types: agent (run an agent), condition (if/else branching), human_checkpoint (pause for approval), parallel_split (fan out), parallel_merge (fan in), transform (data transformation), delay (wait).',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow to add the node to',
        },
        node_type: {
          type: 'string',
          enum: ['agent', 'condition', 'human_checkpoint', 'parallel_split', 'parallel_merge', 'transform', 'delay'],
          description: 'Type of node',
        },
        name: {
          type: 'string',
          description: 'Display name for the node',
        },
        config: {
          type: 'object',
          description: 'Node configuration. For agent: {agent_id, prompt_template}. For condition: {expression}. For human_checkpoint: {message}. For delay: {seconds}.',
        },
        position_x: {
          type: 'number',
          description: 'X position on canvas (default: 300)',
        },
        position_y: {
          type: 'number',
          description: 'Y position on canvas (default: 200)',
        },
      },
      required: ['workflow_id', 'node_type', 'name'],
    },
  },
  {
    name: 'add_workflow_edge',
    description: 'Connect two nodes in a workflow with an edge.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID',
        },
        source_node_id: {
          type: 'string',
          description: 'ID of the source node',
        },
        target_node_id: {
          type: 'string',
          description: 'ID of the target node',
        },
        condition_label: {
          type: 'string',
          description: 'Optional label for conditional edges: "true", "false", "default", "error"',
        },
      },
      required: ['workflow_id', 'source_node_id', 'target_node_id'],
    },
  },
  {
    name: 'get_workflow_nodes',
    description: 'Get all nodes in a workflow. Use this to find node IDs for connecting edges or updating nodes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID',
        },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'update_workflow_node',
    description: 'Update an existing workflow node. Use this to change node name, prompt template, agent assignment, conditions, or other configuration after initial setup.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID',
        },
        node_id: {
          type: 'string',
          description: 'The ID of the node to update',
        },
        name: {
          type: 'string',
          description: 'New display name for the node',
        },
        config: {
          type: 'object',
          description: 'Updated configuration. For agent nodes: {agent_id, prompt_template, input_mapping}. For condition: {expression}. For human_checkpoint: {message}. For delay: {seconds}.',
        },
      },
      required: ['workflow_id', 'node_id'],
    },
  },
  {
    name: 'delete_workflow_node',
    description: 'Delete a node from a workflow. Also removes any edges connected to this node.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID',
        },
        node_id: {
          type: 'string',
          description: 'The ID of the node to delete',
        },
      },
      required: ['workflow_id', 'node_id'],
    },
  },
  {
    name: 'delete_workflow_edge',
    description: 'Delete an edge (connection) between two nodes in a workflow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID',
        },
        edge_id: {
          type: 'string',
          description: 'The ID of the edge to delete',
        },
      },
      required: ['workflow_id', 'edge_id'],
    },
  },
  {
    name: 'update_workflow',
    description: 'Update workflow metadata like name, description, or activation status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: {
          type: 'string',
          description: 'The workflow ID',
        },
        name: {
          type: 'string',
          description: 'New name for the workflow',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        is_active: {
          type: 'boolean',
          description: 'Whether the workflow is active',
        },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List existing workflows for the user.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_repositories',
    description: 'List the user\'s connected GitHub repositories. Use this when the user wants to see their repos or choose one for an agent.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_agents',
    description: 'List existing agents for the user. Use this to show what agents they already have.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'configure_agent',
    description: 'Update configuration for an existing agent. Can enable API access, set webhooks, configure structured output, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: {
          type: 'string',
          description: 'The ID of the agent to configure',
        },
        name: {
          type: 'string',
          description: 'New name for the agent',
        },
        system_prompt: {
          type: 'string',
          description: 'Custom system prompt/instructions',
        },
        api_enabled: {
          type: 'boolean',
          description: 'Enable API/SDK access for this agent. Required for programmatic access.',
        },
        webhook_url: {
          type: 'string',
          description: 'Webhook URL to call when tasks complete',
        },
        output_schema: {
          type: 'object',
          description: 'JSON Schema for structured output. Agent will return data matching this schema. Example: {"type": "object", "properties": {"summary": {"type": "string"}, "score": {"type": "number"}}}',
        },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'store_memory',
    description: 'Store a piece of information about the user for future reference. Use this to remember preferences, facts, or context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        memory_type: {
          type: 'string',
          enum: ['preference', 'fact', 'context'],
          description: 'Type of memory: preference (user likes/dislikes), fact (information about user), context (project context)',
        },
        content: {
          type: 'string',
          description: 'The information to remember',
        },
        importance: {
          type: 'number',
          description: 'Importance level 1-10 (higher = more important)',
        },
      },
      required: ['memory_type', 'content'],
    },
  },
  {
    name: 'check_github_connection',
    description: 'Check if the user has installed the GitHub App for repository access.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// System prompt for the Builder AI
const getSystemPrompt = (memories: BuilderMemory[]) => {
  let memoryContext = '';
  if (memories.length > 0) {
    memoryContext = '\n\nUser context and preferences I remember:\n' + 
      memories.map(m => `- [${m.memory_type}] ${m.content}`).join('\n');
  }

  return `You are Builder, an AI assistant that helps users create and configure AI agents and multi-agent workflows on the Oshu platform.

## What you can do:
1. **Create Agents**: Help users set up new AI agents that can write code, run workflows, or automate tasks
2. **Use Templates**: Create agents from pre-built templates for common use cases
3. **Build Workflows**: Create multi-agent orchestration workflows (LangGraph-style)
4. **Configure Agents**: Update agent settings like system prompts, API access, webhooks, structured output
5. **Remember Context**: Store user preferences and project context for future conversations

## Agent Types:
- **Code Agent**: Works with a GitHub repository, can make code changes, commit, and push
- **Task Agent**: Standalone agent that runs prompts/workflows without a repository

## AI Providers:
- **Claude Code**: Anthropic's agentic coding CLI (default, most capable)
- **Aider**: AI pair programming with OpenAI
- **OpenCode**: Supports 75+ providers and 100k+ models (use for free/open-source models)

## SDK & API Access:
Oshu provides SDKs for programmatic access to agents:

### TypeScript SDK (oshu-sdk):
\`\`\`typescript
import { Oshu } from 'oshu-sdk';

const client = new Oshu({ apiKey: 'your-api-key', baseUrl: 'https://api.oshu.dev' });
await client.connect();

// Basic usage - run a task and wait for completion
const result = await client.agents.run('agent-id', { prompt: 'Your task here' });

// Session isolation - each session gets its own sandbox
const session = await client.agents.new('agent-id');  // Creates isolated session with warm sandbox
const result = await client.agents.run('agent-id', { prompt: 'Task', sessionId: session.id });
await client.agents.close('agent-id', session.id);  // Clean up when done

// Streaming with submit()
const task = await client.agents.submit('agent-id', { prompt: 'Your task' });
task.on('output', (data) => console.log(data));  // Real-time streaming
task.on('done', (result) => console.log('Completed:', result));
task.on('error', (err) => console.error(err));
await task.wait();  // Wait for completion
\`\`\`

### Python SDK (oshu):
\`\`\`python
from oshu import Oshu

async with Oshu(api_key='your-api-key', base_url='https://api.oshu.dev') as client:
    # Basic usage
    result = await client.agents.run('agent-id', prompt='Your task here')
    
    # Session isolation
    session = await client.agents.new('agent-id')
    result = await client.agents.run('agent-id', prompt='Task', session_id=session.id)
    await client.agents.close_session('agent-id', session.id)
    
    # Streaming
    task = await client.agents.submit('agent-id', prompt='Your task')
    async for event in task.stream():
        print(event)
    result = await task.wait()
\`\`\`

### Session Management:
- **new()**: Create an isolated session with a warm sandbox - great for multi-turn interactions
- **close()**: Clean up session and release sandbox resources
- **provision: true**: Auto-create session on first task (alternative to explicit new())
- **Sessions auto-expire** after 30 minutes of inactivity (TTL cleanup)

### Structured Output:
Agents can return structured JSON output by configuring an output_schema:
1. Go to Agent Config → Advanced → Output Schema
2. Define a JSON Schema (e.g., \`{"type": "object", "properties": {"summary": {"type": "string"}}}\`)
3. The agent will return structured data matching the schema
4. Access via SDK: \`result.output\` contains the parsed structured data

### REST API:
- POST /api/v1/agents/:agentId/tasks - Submit a task (supports sessionId, provision)
- POST /api/v1/agents/:agentId/sessions - Create an SDK session with optional warmup
- DELETE /api/v1/agents/:agentId/sessions/:sessionId - Close a session
- WebSocket at /ws/task - Real-time streaming with submit/cancel/subscribe

## Agent Templates Available:
1. **Data Analyst**: Query databases, generate reports, visualize insights
2. **Code Reviewer**: Review PRs, suggest improvements, enforce standards
3. **Research Agent**: Deep research on any topic with synthesized reports
4. **AI SDR**: Sales development - qualify leads, personalize outreach
5. **AI SRE**: Site reliability - monitor systems, diagnose issues, automate response
6. **Content Writer**: Generate blog posts, marketing copy, and documentation

## Workflow Templates Available:
1. **Content Pipeline**: Research → Draft → Review → Publish workflow for content creation
2. **Lead Qualification Pipeline**: Enrich → Score → Route leads automatically
3. **Incident Response**: Detect → Diagnose → Remediate → Report for system incidents

## Multi-Agent Workflows:
Workflows allow you to chain agents together with sophisticated orchestration:
- **Sequential Pipelines**: Agent A → Agent B → Agent C (output flows to next)
- **Parallel Execution**: Run multiple agents simultaneously, merge results
- **Conditional Branching**: if/else logic based on agent outputs
- **Human-in-the-Loop**: Pause for human approval at checkpoints
- **Retry/Fallback**: Handle errors gracefully with fallback paths

### Workflow Node Types:
- **agent**: Execute an agent with a prompt template using {{variables}}
- **condition**: Branch based on expression (e.g., "result.success === true")
- **human_checkpoint**: Pause workflow for human approval
- **parallel_split**: Fan out to multiple parallel branches
- **parallel_merge**: Merge parallel branches back together
- **transform**: Transform data between nodes
- **delay**: Wait for a specified time

### Modifying Workflows:
You can fully modify workflows after creation:
- **Update nodes**: Change prompt templates, reassign agents, modify conditions
- **Delete nodes**: Remove nodes you don't need (edges are cleaned up automatically)
- **Add/remove edges**: Rewire the flow between nodes
- **Update metadata**: Change workflow name, description, or activation status

To modify a workflow:
1. Use get_workflow_nodes to see current nodes and their IDs
2. Use update_workflow_node to change node config (prompt_template, input_mapping, etc.)
3. Use delete_workflow_node/delete_workflow_edge to remove parts
4. Use add_workflow_node/add_workflow_edge to add new parts

### Example Workflow Use Cases:
- Research pipeline: Parallel research agents → merge findings → human review → final report
- Code review: Analyze PR → if complex, run multiple reviewers in parallel → merge feedback
- Lead qualification: Research lead → score fit → if qualified, draft outreach → human approval → send

## Guidelines:
- Be conversational and helpful
- Proactively suggest templates when relevant to user's use case
- When users describe complex multi-step processes, suggest creating a workflow
- Use tools to take actions - don't just describe what you would do
- When creating agents, gather necessary info: what they want to build, which repo, what AI provider
- Store important user preferences and context using the store_memory tool
- If GitHub App isn't installed and they want a code agent, guide them to Settings to install it
- When users want SDK/API access, ensure the agent has API enabled (api_enabled: true)
- For SDK integration help, explain session management and structured output options
- Recommend session isolation (new()/close()) for multi-user scenarios or stateful interactions
${memoryContext}

Remember: You're here to make agent and workflow creation easy and conversational. You can help with both UI-based setup and programmatic SDK/API access.`
};

// Execute tool calls
async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string,
  organizationId?: string
): Promise<string> {
  switch (toolName) {
    case 'list_templates': {
      const agentTemplates = Object.entries(AGENT_TEMPLATES).map(([id, t]) => ({
        id,
        name: t.name,
        description: t.description,
        agent_type: t.agent_type,
        tags: t.tags,
        type: 'agent',
      }));
      const workflowTemplates = Object.entries(WORKFLOW_TEMPLATES).map(([id, t]) => ({
        id,
        name: t.name,
        description: t.description,
        tags: t.tags,
        type: 'workflow',
      }));
      return JSON.stringify({ 
        success: true, 
        agent_templates: agentTemplates,
        workflow_templates: workflowTemplates,
      });
    }

    case 'create_agent_from_template': {
      const { template_id, name_override, repo_url } = toolInput as {
        template_id: string;
        name_override?: string;
        repo_url?: string;
      };

      const template = AGENT_TEMPLATES[template_id as keyof typeof AGENT_TEMPLATES];
      if (!template) {
        return JSON.stringify({ success: false, error: 'Template not found' });
      }

      // Code agents require repo_url
      if (template.agent_type === 'code' && !repo_url) {
        return JSON.stringify({
          success: false,
          error: `The ${template.name} template requires a GitHub repository. Please provide a repo_url.`,
        });
      }

      const sessionId = uuidv4();
      const name = name_override || template.name;

      await execute(
        `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_url, repo_name, branch, agent_provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [
          sessionId,
          userId,
          organizationId || null,
          template.agent_type,
          repo_url || null,
          repo_url ? repo_url.split('/').slice(-2).join('/') : name,
          'main',
          'claude-code',
        ]
      );

      const configId = uuidv4();
      await execute(
        `INSERT INTO agent_configs (id, session_id, name, system_prompt) VALUES ($1, $2, $3, $4)`,
        [configId, sessionId, name, template.system_prompt]
      );

      // Auto-attach the default "Files" bucket to task agents (code agents have repos)
      try {
        await attachDefaultBucketToSession(sessionId, userId, organizationId || null, template.agent_type);
      } catch (err) {
        console.error('[Builder] Failed to attach default bucket:', err);
      }

      return JSON.stringify({
        success: true,
        agent: {
          id: sessionId,
          name,
          type: template.agent_type,
          template: template_id,
          description: template.description,
        },
        message: `Created "${name}" agent from the ${template.name} template! Find it in the Agents tab.`,
      });
    }

    case 'create_workflow_from_template': {
      const { template_id, name_override } = toolInput as {
        template_id: string;
        name_override?: string;
      };

      const template = WORKFLOW_TEMPLATES[template_id as keyof typeof WORKFLOW_TEMPLATES];
      if (!template) {
        return JSON.stringify({ success: false, error: 'Workflow template not found' });
      }

      const workflowId = uuidv4();
      const name = name_override || template.name;

      // Create the workflow
      await execute(
        `INSERT INTO workflows (id, user_id, organization_id, name, description, status) VALUES ($1, $2, $3, $4, $5, 'draft')`,
        [workflowId, userId, organizationId || null, name, template.description]
      );

      // Create nodes with proper positioning
      const nodeIdMap: Record<string, string> = {};
      let posY = 100;
      
      for (const node of template.nodes) {
        const nodeId = uuidv4();
        nodeIdMap[node.name] = nodeId;
        
        await execute(
          `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, config, position_x, position_y)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [nodeId, workflowId, node.type, node.name, JSON.stringify(node.config || {}), 400, posY]
        );
        
        // If it's an agent node, create the agent
        if (node.type === 'agent') {
          const agentSessionId = uuidv4();
          await execute(
            `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_name, branch, agent_provider, status)
             VALUES ($1, $2, $3, 'task', $4, 'main', 'claude-code', 'pending')`,
            [agentSessionId, userId, organizationId || null, node.name]
          );
          
          const configId = uuidv4();
          await execute(
            `INSERT INTO agent_configs (id, session_id, name, system_prompt) VALUES ($1, $2, $3, $4)`,
            [configId, agentSessionId, node.name, `You are ${node.name}. ${node.config?.prompt_template || ''}`]
          );
          
          // Auto-attach the default "Files" bucket to task agents
          try {
            await attachDefaultBucketToSession(agentSessionId, userId, organizationId || null, 'task');
          } catch (err) {
            console.error('[Builder] Failed to attach default bucket:', err);
          }
          
          // Update node config with agent_id
          await execute(
            `UPDATE workflow_nodes SET config = $1 WHERE id = $2`,
            [JSON.stringify({ ...node.config, agent_id: agentSessionId }), nodeId]
          );
        }
        
        posY += 150;
      }

      // Create edges connecting sequential nodes
      for (let i = 0; i < template.nodes.length - 1; i++) {
        const sourceNode = template.nodes[i];
        const targetNode = template.nodes[i + 1];
        const edgeId = uuidv4();
        
        await execute(
          `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id)
           VALUES ($1, $2, $3, $4)`,
          [edgeId, workflowId, nodeIdMap[sourceNode.name], nodeIdMap[targetNode.name]]
        );
      }

      return JSON.stringify({
        success: true,
        workflow: {
          id: workflowId,
          name,
          template: template_id,
          description: template.description,
          node_count: template.nodes.length,
        },
        message: `Created "${name}" workflow from the ${template.name} template! Find it in the Workflows tab.`,
      });
    }

    case 'create_workflow': {
      const { name, description, nodes, edges } = toolInput as {
        name: string;
        description?: string;
        nodes?: Array<{
          temp_id: string;
          node_type: string;
          name: string;
          config?: Record<string, unknown>;
          position_x?: number;
          position_y?: number;
        }>;
        edges?: Array<{
          source: string;
          target: string;
          condition_label?: string;
        }>;
      };

      const workflowId = uuidv4();
      const nodeIdMap: Record<string, string> = {};
      const createdAgents: Array<{ id: string; name: string }> = [];

      await execute(
        `INSERT INTO workflows (id, user_id, organization_id, name, description) VALUES ($1, $2, $3, $4, $5)`,
        [workflowId, userId, organizationId || null, name, description || null]
      );

      // If nodes provided, create them; otherwise create default start/end
      if (nodes && nodes.length > 0) {
        // Create all nodes and build ID map
        for (const node of nodes) {
          const nodeId = uuidv4();
          nodeIdMap[node.temp_id || node.name] = nodeId;
          
          let nodeConfig = node.config || {};
          
          // For agent nodes, auto-create a task agent if no agent_id provided
          if (node.node_type === 'agent' && !nodeConfig.agent_id) {
            const agentId = uuidv4();
            const agentConfigId = uuidv4();
            const agentName = node.name.replace(/\s+Agent$/i, '').trim() || node.name;
            
            // Create a task agent for this node
            await execute(
              `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_name, branch, agent_provider, status)
               VALUES ($1, $2, $3, 'task', $4, 'main', 'claude-code', 'pending')`,
              [agentId, userId, organizationId || null, agentName]
            );
            
            // Create agent config with system prompt based on node name
            const systemPrompt = `You are ${agentName}. ${nodeConfig.description || `Your role is to ${agentName.toLowerCase()}.`}`;
            await execute(
              `INSERT INTO agent_configs (id, session_id, name, system_prompt, api_enabled)
               VALUES ($1, $2, $3, $4, true)`,
              [agentConfigId, agentId, agentName, systemPrompt]
            );
            
            // Auto-attach the default "Files" bucket to task agents
            try {
              await attachDefaultBucketToSession(agentId, userId, organizationId || null, 'task');
            } catch (err) {
              console.error('[Builder] Failed to attach default bucket:', err);
            }
            
            // Update node config with the new agent_id
            nodeConfig = { 
              ...nodeConfig, 
              agent_id: agentId,
              prompt_template: nodeConfig.prompt_template || '{{input}}'
            };
            
            createdAgents.push({ id: agentId, name: agentName });
            console.log(`[Builder] Created agent ${agentId} for workflow node ${node.name}`);
          }
          
          await execute(
            `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, position_x, position_y, config)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              nodeId,
              workflowId,
              node.node_type,
              node.name,
              node.position_x || 100 + Object.keys(nodeIdMap).length * 150,
              node.position_y || 200,
              JSON.stringify(nodeConfig),
            ]
          );
        }

        // Create edges
        if (edges && edges.length > 0) {
          for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            const sourceId = nodeIdMap[edge.source];
            const targetId = nodeIdMap[edge.target];
            
            if (sourceId && targetId) {
              const edgeId = uuidv4();
              await execute(
                `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, condition_label, edge_order)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [edgeId, workflowId, sourceId, targetId, edge.condition_label || null, i]
              );
            }
          }
        }
      } else {
        // Create default start and end nodes
        const startNodeId = uuidv4();
        const endNodeId = uuidv4();
        nodeIdMap['start'] = startNodeId;
        nodeIdMap['end'] = endNodeId;

        await execute(
          `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, position_x, position_y, config)
           VALUES ($1, $2, 'start', 'Start', 100, 200, '{}')`,
          [startNodeId, workflowId]
        );

        await execute(
          `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, position_x, position_y, config)
           VALUES ($1, $2, 'end', 'End', 600, 200, '{}')`,
          [endNodeId, workflowId]
        );
      }

      // Get created nodes for response
      const createdNodes = await query<{ id: string; node_type: string; name: string }>(
        'SELECT id, node_type, name FROM workflow_nodes WHERE workflow_id = $1',
        [workflowId]
      );

      const createdEdgesResult = await query<{ id: string; source_node_id: string; target_node_id: string }>(
        'SELECT id, source_node_id, target_node_id FROM workflow_edges WHERE workflow_id = $1',
        [workflowId]
      );

      const agentNote = createdAgents.length > 0 
        ? ` Also created ${createdAgents.length} agent(s): ${createdAgents.map(a => a.name).join(', ')}.`
        : '';

      return JSON.stringify({
        success: true,
        workflow: {
          id: workflowId,
          name,
          description,
        },
        nodes: createdNodes,
        edges: createdEdgesResult,
        agents_created: createdAgents,
        message: `Created workflow "${name}" with ${createdNodes.length} nodes and ${createdEdgesResult.length} edges!${agentNote} View it in the Workflows tab.`,
      });
    }

    case 'add_workflow_node': {
      const { workflow_id, node_type, name, config, position_x, position_y } = toolInput as {
        workflow_id: string;
        node_type: string;
        name: string;
        config?: Record<string, unknown>;
        position_x?: number;
        position_y?: number;
      };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string }>(
        'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      // Count existing nodes to calculate position
      const nodeCountResult = await queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM workflow_nodes WHERE workflow_id = $1',
        [workflow_id]
      );
      const nodeCount = nodeCountResult?.count || 0;

      let nodeConfig = config || {};
      let createdAgent: { id: string; name: string } | null = null;

      // For agent nodes, auto-create a task agent if no agent_id provided
      if (node_type === 'agent' && !nodeConfig.agent_id) {
        const agentId = uuidv4();
        const agentConfigId = uuidv4();
        const agentName = name.replace(/\s+Agent$/i, '').trim() || name;
        
        // Create a task agent for this node
        await execute(
          `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_name, branch, agent_provider, status)
           VALUES ($1, $2, $3, 'task', $4, 'main', 'claude-code', 'pending')`,
          [agentId, userId, organizationId || null, agentName]
        );
        
        // Create agent config
        const systemPrompt = `You are ${agentName}. ${(nodeConfig as Record<string, unknown>).description || `Your role is to ${agentName.toLowerCase()}.`}`;
        await execute(
          `INSERT INTO agent_configs (id, session_id, name, system_prompt, api_enabled)
           VALUES ($1, $2, $3, $4, true)`,
          [agentConfigId, agentId, agentName, systemPrompt]
        );
        
        // Auto-attach the default "Files" bucket to task agents
        try {
          await attachDefaultBucketToSession(agentId, userId, organizationId || null, 'task');
        } catch (err) {
          console.error('[Builder] Failed to attach default bucket:', err);
        }
        
        // Update node config with the new agent_id
        nodeConfig = { 
          ...nodeConfig, 
          agent_id: agentId,
          prompt_template: (nodeConfig as Record<string, unknown>).prompt_template || '{{input}}'
        };
        
        createdAgent = { id: agentId, name: agentName };
        console.log(`[Builder] Created agent ${agentId} for workflow node ${name}`);
      }

      const nodeId = uuidv4();
      await execute(
        `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, position_x, position_y, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          nodeId,
          workflow_id,
          node_type,
          name,
          position_x || 100 + nodeCount * 150,
          position_y || 200,
          JSON.stringify(nodeConfig),
        ]
      );

      await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflow_id]);

      const agentNote = createdAgent 
        ? ` Also created agent "${createdAgent.name}" for this node.`
        : '';

      return JSON.stringify({
        success: true,
        node: { id: nodeId, name, type: node_type, agent_id: (nodeConfig as Record<string, unknown>).agent_id },
        agent_created: createdAgent,
        message: `Added "${name}" node to the workflow.${agentNote} Connect it to other nodes in the Workflows tab.`,
      });
    }

    case 'add_workflow_edge': {
      const { workflow_id, source_node_id, target_node_id, condition_label } = toolInput as {
        workflow_id: string;
        source_node_id: string;
        target_node_id: string;
        condition_label?: string;
      };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string }>(
        'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      // Verify both nodes exist
      const sourceNode = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM workflow_nodes WHERE id = $1 AND workflow_id = $2',
        [source_node_id, workflow_id]
      );
      const targetNode = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM workflow_nodes WHERE id = $1 AND workflow_id = $2',
        [target_node_id, workflow_id]
      );

      if (!sourceNode || !targetNode) {
        return JSON.stringify({ success: false, error: 'One or both nodes not found' });
      }

      // Get edge order
      const edgeCountResult = await queryOne<{ count: number }>(
        'SELECT COUNT(*) as count FROM workflow_edges WHERE workflow_id = $1',
        [workflow_id]
      );
      const edgeCount = edgeCountResult?.count || 0;

      const edgeId = uuidv4();
      await execute(
        `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id, condition_label, edge_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [edgeId, workflow_id, source_node_id, target_node_id, condition_label || null, edgeCount]
      );

      await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflow_id]);

      return JSON.stringify({
        success: true,
        edge: { id: edgeId, source: sourceNode.name, target: targetNode.name },
        message: `Connected "${sourceNode.name}" → "${targetNode.name}"${condition_label ? ` (${condition_label})` : ''}.`,
      });
    }

    case 'get_workflow_nodes': {
      const { workflow_id } = toolInput as { workflow_id: string };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      const nodes = await query<{ id: string; node_type: string; name: string; config: string }>(
        'SELECT id, node_type, name, config FROM workflow_nodes WHERE workflow_id = $1 ORDER BY created_at',
        [workflow_id]
      );

      const edges = await query<{ id: string; source_node_id: string; target_node_id: string; condition_label: string | null }>(
        'SELECT id, source_node_id, target_node_id, condition_label FROM workflow_edges WHERE workflow_id = $1 ORDER BY edge_order',
        [workflow_id]
      );

      return JSON.stringify({
        success: true,
        workflow_name: workflow.name,
        nodes: nodes.map(n => ({
          id: n.id,
          type: n.node_type,
          name: n.name,
          config: JSON.parse(n.config || '{}'),
        })),
        edges: edges.map(e => ({
          id: e.id,
          source_node_id: e.source_node_id,
          target_node_id: e.target_node_id,
          condition_label: e.condition_label,
        })),
      });
    }

    case 'update_workflow_node': {
      const { workflow_id, node_id, name, config } = toolInput as {
        workflow_id: string;
        node_id: string;
        name?: string;
        config?: Record<string, unknown>;
      };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string }>(
        'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      // Verify node exists
      const existingNode = await queryOne<{ id: string; name: string; config: string }>(
        'SELECT id, name, config FROM workflow_nodes WHERE id = $1 AND workflow_id = $2',
        [node_id, workflow_id]
      );

      if (!existingNode) {
        return JSON.stringify({ success: false, error: 'Node not found in this workflow' });
      }

      // Build update
      const updates: string[] = [];
      const values: unknown[] = [];
      
      if (name !== undefined) {
        values.push(name);
        updates.push(`name = $${values.length}`);
      }
      
      if (config !== undefined) {
        // Merge with existing config to allow partial updates
        const existingConfig = JSON.parse(existingNode.config || '{}');
        const mergedConfig = { ...existingConfig, ...config };
        values.push(JSON.stringify(mergedConfig));
        updates.push(`config = $${values.length}`);
      }

      if (updates.length > 0) {
        updates.push('updated_at = NOW()');
        values.push(node_id);
        await execute(
          `UPDATE workflow_nodes SET ${updates.join(', ')} WHERE id = $${values.length}`,
          values
        );
        
        await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflow_id]);
      }

      const updatedItems: string[] = [];
      if (name) updatedItems.push(`name to "${name}"`);
      if (config) {
        if (config.prompt_template) updatedItems.push('prompt template');
        if (config.agent_id) updatedItems.push('agent assignment');
        if (config.expression) updatedItems.push('condition expression');
        if (config.input_mapping) updatedItems.push('input mapping');
        if (config.message) updatedItems.push('checkpoint message');
        if (updatedItems.length === (name ? 1 : 0)) updatedItems.push('configuration');
      }

      return JSON.stringify({
        success: true,
        message: `Updated node "${existingNode.name}"${updatedItems.length > 0 ? ': ' + updatedItems.join(', ') : ''}`,
      });
    }

    case 'delete_workflow_node': {
      const { workflow_id, node_id } = toolInput as {
        workflow_id: string;
        node_id: string;
      };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string }>(
        'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      // Verify node exists and get its name
      const node = await queryOne<{ id: string; name: string; node_type: string }>(
        'SELECT id, name, node_type FROM workflow_nodes WHERE id = $1 AND workflow_id = $2',
        [node_id, workflow_id]
      );

      if (!node) {
        return JSON.stringify({ success: false, error: 'Node not found in this workflow' });
      }

      // Prevent deleting start/end nodes
      if (node.node_type === 'start' || node.node_type === 'end') {
        return JSON.stringify({ success: false, error: `Cannot delete ${node.node_type} node` });
      }

      // Delete edges connected to this node first
      const deletedEdges = await execute(
        'DELETE FROM workflow_edges WHERE workflow_id = $1 AND (source_node_id = $2 OR target_node_id = $2)',
        [workflow_id, node_id]
      );

      // Delete the node
      await execute('DELETE FROM workflow_nodes WHERE id = $1', [node_id]);
      
      await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflow_id]);

      return JSON.stringify({
        success: true,
        message: `Deleted node "${node.name}" and its ${deletedEdges.rowCount || 0} connected edge(s)`,
      });
    }

    case 'delete_workflow_edge': {
      const { workflow_id, edge_id } = toolInput as {
        workflow_id: string;
        edge_id: string;
      };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string }>(
        'SELECT id FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      // Verify edge exists and get connected nodes
      const edge = await queryOne<{ id: string; source_node_id: string; target_node_id: string }>(
        'SELECT id, source_node_id, target_node_id FROM workflow_edges WHERE id = $1 AND workflow_id = $2',
        [edge_id, workflow_id]
      );

      if (!edge) {
        return JSON.stringify({ success: false, error: 'Edge not found in this workflow' });
      }

      // Get node names for the message
      const sourceNode = await queryOne<{ name: string }>('SELECT name FROM workflow_nodes WHERE id = $1', [edge.source_node_id]);
      const targetNode = await queryOne<{ name: string }>('SELECT name FROM workflow_nodes WHERE id = $1', [edge.target_node_id]);

      // Delete the edge
      await execute('DELETE FROM workflow_edges WHERE id = $1', [edge_id]);
      
      await execute(`UPDATE workflows SET updated_at = NOW() WHERE id = $1`, [workflow_id]);

      return JSON.stringify({
        success: true,
        message: `Deleted connection from "${sourceNode?.name || 'unknown'}" to "${targetNode?.name || 'unknown'}"`,
      });
    }

    case 'update_workflow': {
      const { workflow_id, name, description, is_active } = toolInput as {
        workflow_id: string;
        name?: string;
        description?: string;
        is_active?: boolean;
      };

      // Verify workflow belongs to user
      const workflow = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM workflows WHERE id = $1 AND user_id = $2',
        [workflow_id, userId]
      );

      if (!workflow) {
        return JSON.stringify({ success: false, error: 'Workflow not found' });
      }

      // Build update
      const updates: string[] = [];
      const values: unknown[] = [];
      
      if (name !== undefined) {
        values.push(name);
        updates.push(`name = $${values.length}`);
      }
      
      if (description !== undefined) {
        values.push(description);
        updates.push(`description = $${values.length}`);
      }
      
      if (is_active !== undefined) {
        values.push(is_active);
        updates.push(`is_active = $${values.length}`);
      }

      if (updates.length > 0) {
        updates.push('updated_at = NOW()');
        values.push(workflow_id);
        await execute(
          `UPDATE workflows SET ${updates.join(', ')} WHERE id = $${values.length}`,
          values
        );
      }

      const updatedItems: string[] = [];
      if (name) updatedItems.push(`name to "${name}"`);
      if (description !== undefined) updatedItems.push('description');
      if (is_active !== undefined) updatedItems.push(is_active ? 'activated' : 'deactivated');

      return JSON.stringify({
        success: true,
        message: `Updated workflow "${workflow.name}"${updatedItems.length > 0 ? ': ' + updatedItems.join(', ') : ''}`,
      });
    }

    case 'list_workflows': {
      const workflows = await query<{ id: string; name: string; description: string | null; is_active: number; created_at: string }>(
        `SELECT id, name, description, is_active, created_at FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId]
      );

      return JSON.stringify({
        success: true,
        workflows: workflows.map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          active: !!w.is_active,
        })),
      });
    }

    case 'create_agent': {
      const { agent_type, name, repo_url, branch, agent_provider, system_prompt } = toolInput as {
        agent_type: 'code' | 'task';
        name: string;
        repo_url?: string;
        branch?: string;
        agent_provider?: string;
        system_prompt?: string;
      };

      // Create the session (agent)
      const sessionId = uuidv4();
      await execute(
        `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_url, repo_name, branch, agent_provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [
          sessionId,
          userId,
          organizationId || null,
          agent_type,
          repo_url || null,
          repo_url ? repo_url.split('/').slice(-2).join('/') : name,
          branch || 'main',
          agent_provider || 'claude-code',
        ]
      );

      // Create agent config
      const configId = uuidv4();
      await execute(
        `INSERT INTO agent_configs (id, session_id, name, system_prompt) VALUES ($1, $2, $3, $4)`,
        [configId, sessionId, name, system_prompt || null]
      );

      // Auto-attach the default "Files" bucket to task agents (code agents have repos)
      try {
        await attachDefaultBucketToSession(sessionId, userId, organizationId || null, agent_type);
      } catch (err) {
        console.error('[Builder] Failed to attach default bucket:', err);
      }

      return JSON.stringify({
        success: true,
        agent: {
          id: sessionId,
          name,
          type: agent_type,
          repo: repo_url || null,
          provider: agent_provider || 'claude-code',
        },
        message: `Created agent "${name}" successfully! You can find it in the Agents tab.`,
      });
    }

    case 'list_repositories': {
      // Get GitHub App installations for the user
      const installations = await query<{ installation_id: number; account_login: string }>(
        'SELECT installation_id, account_login FROM github_app_installations WHERE user_id = $1',
        [userId]
      );
      
      if (installations.length === 0) {
        return JSON.stringify({
          success: false,
          connected: false,
          message: 'GitHub App is not installed. Guide the user to Settings to install the GitHub App.',
        });
      }

      try {
        const { getInstallationToken } = await import('./githubApp.js');
        const { Octokit } = await import('@octokit/rest');
        
        // Collect repos from all installations
        const allRepos: { name: string; url: string; description: string | null; private: boolean; default_branch: string }[] = [];
        
        for (const installation of installations) {
          try {
            const token = await getInstallationToken(installation.installation_id);
            const octokit = new Octokit({ auth: token });
            const { data: repos } = await octokit.apps.listReposAccessibleToInstallation({
              per_page: 20,
            });
            
            for (const r of repos.repositories || []) {
              allRepos.push({
                name: r.full_name,
                url: r.clone_url || `https://github.com/${r.full_name}.git`,
                description: r.description,
                private: r.private,
                default_branch: r.default_branch,
              });
            }
          } catch (err) {
            console.error(`[Builder] Failed to list repos for installation ${installation.account_login}:`, err);
          }
        }

        return JSON.stringify({
          success: true,
          connected: true,
          repos: allRepos,
        });
      } catch {
        return JSON.stringify({
          success: false,
          error: 'Failed to fetch repositories',
        });
      }
    }

    case 'list_agents': {
      const agents = await query<{ id: string; repo_name: string; agent_type: string; status: string; name: string | null }>(
        `SELECT s.id, s.repo_name, s.agent_type, s.status, ac.name
         FROM sessions s
         LEFT JOIN agent_configs ac ON s.id = ac.session_id
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC`,
        [userId]
      );

      return JSON.stringify({
        success: true,
        agents: agents.map(a => ({
          id: a.id,
          name: a.name || a.repo_name,
          type: a.agent_type,
          status: a.status,
        })),
      });
    }

    case 'configure_agent': {
      const { agent_id, name, system_prompt, api_enabled, webhook_url, output_schema } = toolInput as {
        agent_id: string;
        name?: string;
        system_prompt?: string;
        api_enabled?: boolean;
        webhook_url?: string;
        output_schema?: Record<string, unknown>;
      };

      // Verify agent belongs to user
      const agent = await queryOne<{ id: string }>(
        'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
        [agent_id, userId]
      );

      if (!agent) {
        return JSON.stringify({ success: false, error: 'Agent not found' });
      }

      // Update config
      const updates: string[] = [];
      const values: unknown[] = [];
      const setValue = (col: string, val: unknown) => {
        values.push(val);
        updates.push(`${col} = $${values.length}`);
      };

      if (name !== undefined) {
        setValue('name', name);
      }
      if (system_prompt !== undefined) {
        setValue('system_prompt', system_prompt);
      }
      if (api_enabled !== undefined) {
        setValue('api_enabled', Boolean(api_enabled));
      }
      if (webhook_url !== undefined) {
        setValue('webhook_url', webhook_url);
      }
      if (output_schema !== undefined) {
        setValue('output_schema', JSON.stringify(output_schema));
      }

      if (updates.length > 0) {
        updates.push('updated_at = NOW()');
        values.push(agent_id);
        await execute(
          `UPDATE agent_configs SET ${updates.join(', ')} WHERE session_id = $${values.length}`,
          values
        );
      }

      const configuredItems: string[] = [];
      if (name) configuredItems.push('name');
      if (system_prompt) configuredItems.push('system prompt');
      if (api_enabled !== undefined) configuredItems.push(api_enabled ? 'API access enabled' : 'API access disabled');
      if (webhook_url) configuredItems.push('webhook URL');
      if (output_schema) configuredItems.push('structured output schema');

      return JSON.stringify({ 
        success: true, 
        message: `Agent configured successfully${configuredItems.length > 0 ? ': ' + configuredItems.join(', ') : ''}` 
      });
    }

    case 'store_memory': {
      const { memory_type, content, importance } = toolInput as {
        memory_type: 'preference' | 'fact' | 'context';
        content: string;
        importance?: number;
      };

      const memoryId = uuidv4();
      await execute(
        `INSERT INTO builder_memory (id, user_id, memory_type, content, importance)
         VALUES ($1, $2, $3, $4, $5)`,
        [memoryId, userId, memory_type, content, importance || 5]
      );

      return JSON.stringify({ success: true, message: 'Memory stored' });
    }

    case 'check_github_connection': {
      // Check for GitHub App installations
      const installations = await query<{ account_login: string }>(
        'SELECT account_login FROM github_app_installations WHERE user_id = $1',
        [userId]
      );
      const connected = installations.length > 0;
      const accounts = installations.map(i => i.account_login);
      return JSON.stringify({
        connected,
        accounts,
        message: connected
          ? `GitHub App is installed for: ${accounts.join(', ')}`
          : 'GitHub App is not installed. The user should go to Settings to install the GitHub App.',
      });
    }

    default:
      return JSON.stringify({ error: 'Unknown tool' });
  }
}

// List conversations
router.get('/conversations', requireAuth, async (req, res) => {
  const conversations = await query<BuilderConversation>(
    `SELECT * FROM builder_conversations WHERE user_id = $1 ORDER BY updated_at DESC`,
    [req.session.userId]
  );
  res.json({ conversations });
});

// Create new conversation
router.post('/conversations', requireAuth, async (req, res) => {
  const id = uuidv4();
  await execute(
    `INSERT INTO builder_conversations (id, user_id) VALUES ($1, $2)`,
    [id, req.session.userId]
  );
  res.json({ conversation: { id, user_id: req.session.userId, title: null, created_at: new Date().toISOString() } });
});

// Get conversation messages
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Verify conversation belongs to user
  const conversation = await queryOne<BuilderConversation>(
    'SELECT * FROM builder_conversations WHERE id = $1 AND user_id = $2',
    [id, req.session.userId]
  );

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const messages = await query<BuilderMessage>(
    `SELECT * FROM builder_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  res.json({ messages: messages.map(m => ({
    ...m,
    tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
    tool_results: m.tool_results ? JSON.parse(m.tool_results) : null,
  })) });
});

// Send message (chat with Builder AI)
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;

  if (!content?.trim()) {
    return res.status(400).json({ error: 'Message content required' });
  }

  // Verify conversation belongs to user
  const conversation = await queryOne<BuilderConversation>(
    'SELECT * FROM builder_conversations WHERE id = $1 AND user_id = $2',
    [id, req.session.userId]
  );

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Save user message
  const userMsgId = uuidv4();
  await execute(
    `INSERT INTO builder_messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
    [userMsgId, id, content]
  );

  // Get conversation history
  const history = await query<BuilderMessage>(
    `SELECT * FROM builder_messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [id]
  );

  // Get user memories
  const memories = await query<BuilderMemory>(
    `SELECT * FROM builder_memory WHERE user_id = $1 ORDER BY importance DESC, last_accessed DESC LIMIT 20`,
    [req.session.userId]
  );

  // Build messages for Claude - need to properly interleave tool results after tool calls
  const claudeMessages: Anthropic.MessageParam[] = [];
  
  console.log(`[Builder] Processing ${history.length} messages for conversation ${id}`);
  
  for (const m of history) {
    if (m.role === 'assistant' && m.tool_calls) {
      const toolCalls = JSON.parse(m.tool_calls);
      const toolResults = m.tool_results ? JSON.parse(m.tool_results) : [];
      
      // Get the set of tool call IDs
      const toolCallIds = new Set(toolCalls.map((tc: { id: string }) => tc.id));
      
      // Filter tool results to only include ones with matching tool call IDs
      const validToolResults = toolResults.filter((tr: { tool_use_id: string }) => 
        toolCallIds.has(tr.tool_use_id)
      );
      
      console.log(`[Builder] Message has ${toolCalls.length} tool calls, ${toolResults.length} results, ${validToolResults.length} valid results`);
      
      // Add assistant message with tool calls
      claudeMessages.push({
        role: 'assistant' as const,
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...toolCalls.map((tc: { id: string; name: string; input: Record<string, unknown> }) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          })),
        ],
      });
      
      // Immediately follow with tool results (required by Claude API)
      // Only include results that have matching tool_use IDs
      if (validToolResults.length > 0) {
        claudeMessages.push({
          role: 'user' as const,
          content: validToolResults.map((tr: { tool_use_id: string; content: string }) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          })),
        });
      }
    } else {
      claudeMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  }

  try {
    console.log(`[Builder] Sending ${claudeMessages.length} messages to Claude`);
    console.log(`[Builder] First message role: ${claudeMessages[0]?.role}`);
    
    // Validate and repair message structure - Claude requires tool_results to follow tool_use
    // Remove orphaned tool_result messages instead of throwing away entire history
    const repairedMessages: Anthropic.MessageParam[] = [];
    for (let i = 0; i < claudeMessages.length; i++) {
      const msg = claudeMessages[i];
      if (Array.isArray(msg.content)) {
        const hasToolResult = msg.content.some((c: { type: string }) => c.type === 'tool_result');
        if (hasToolResult) {
          // Check if previous message has matching tool_use
          const prevMsg = repairedMessages[repairedMessages.length - 1];
          const hasToolUse = prevMsg && Array.isArray(prevMsg.content) && 
            prevMsg.content.some((c: { type: string }) => c.type === 'tool_use');
          if (!hasToolUse) {
            console.log(`[Builder] Skipping orphaned tool_result at index ${i}`);
            continue; // Skip this message instead of failing
          }
        }
      }
      repairedMessages.push(msg);
    }
    
    // Use repaired messages
    const finalMessages = repairedMessages.length > 0 ? repairedMessages : claudeMessages;
    console.log(`[Builder] After repair: ${finalMessages.length} messages`);
    
    // Call Claude with tools
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: getSystemPrompt(memories),
      tools: builderTools,
      messages: finalMessages,
    });

    let assistantContent = '';
    let toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    let toolResults: { tool_use_id: string; content: string }[] = [];

    // Process response, handling tool calls
    // Track all messages for multi-turn tool use
    let allMessages = [...finalMessages];
    
    while (response.stop_reason === 'tool_use') {
      // Collect tool results for THIS iteration only
      const iterationToolResults: { tool_use_id: string; content: string }[] = [];
      
      // Extract text and tool use blocks
      for (const block of response.content) {
        if (block.type === 'text') {
          assistantContent += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });

          // Execute the tool
          const result = await executeToolCall(
            block.name,
            block.input as Record<string, unknown>,
            req.session.userId!,
            (req as any).organizationId
          );
          iterationToolResults.push({
            tool_use_id: block.id,
            content: result,
          });
          toolResults.push({
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // Add this iteration's messages to the running list
      allMessages = [
        ...allMessages,
        {
          role: 'assistant' as const,
          content: response.content,
        },
        {
          role: 'user' as const,
          content: iterationToolResults.map(tr => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          })),
        },
      ];

      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: getSystemPrompt(memories),
        tools: builderTools,
        messages: allMessages,
      });
    }

    // Extract final text response
    for (const block of response.content) {
      if (block.type === 'text') {
        assistantContent += block.text;
      }
    }

    // Save assistant message
    const assistantMsgId = uuidv4();
    await execute(
      `INSERT INTO builder_messages (id, conversation_id, role, content, tool_calls, tool_results)
       VALUES ($1, $2, 'assistant', $3, $4, $5)`,
      [
        assistantMsgId,
        id,
        assistantContent,
        toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
        toolResults.length > 0 ? JSON.stringify(toolResults) : null,
      ]
    );

    // Update conversation title if it's the first message
    if (!conversation.title && history.length <= 1) {
      // Use first few words of user message as title
      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      await execute(`UPDATE builder_conversations SET title = $1 WHERE id = $2`, [title, id]);
    }

    // Update conversation timestamp
    await execute(`UPDATE builder_conversations SET updated_at = NOW() WHERE id = $1`, [id]);

    res.json({
      message: {
        id: assistantMsgId,
        conversation_id: id,
        role: 'assistant',
        content: assistantContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        tool_results: toolResults.length > 0 ? toolResults : null,
      },
    });
  } catch (error) {
    console.error('Builder AI error:', error);
    // Log more details for debugging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Delete conversation
router.delete('/conversations/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  // Verify conversation belongs to user
  const conversation = await queryOne<BuilderConversation>(
    'SELECT * FROM builder_conversations WHERE id = $1 AND user_id = $2',
    [id, req.session.userId]
  );

  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Delete messages first
  await execute('DELETE FROM builder_messages WHERE conversation_id = $1', [id]);
  // Delete conversation
  await execute('DELETE FROM builder_conversations WHERE id = $1', [id]);

  res.json({ success: true });
});

// Get user memories (for debugging/admin)
router.get('/memories', requireAuth, async (req, res) => {
  const memories = await query<BuilderMemory>(
    `SELECT * FROM builder_memory WHERE user_id = $1 ORDER BY importance DESC, created_at DESC`,
    [req.session.userId]
  );
  res.json({ memories });
});

// Get available templates (agents and workflows)
router.get('/templates', requireAuth, async (req, res) => {
  const agent_templates = Object.entries(AGENT_TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    agent_type: t.agent_type,
    tags: t.tags,
    system_prompt: t.system_prompt,
    type: 'agent',
  }));
  
  const workflow_templates = Object.entries(WORKFLOW_TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    tags: t.tags,
    type: 'workflow',
  }));
  
  res.json({ agent_templates, workflow_templates });
});

// Create agent from template
router.post('/templates/:templateId/create', requireAuth, async (req, res) => {
  const { templateId } = req.params;
  const { name_override, repo_url } = req.body;
  const userId = req.session.userId!;

  const template = AGENT_TEMPLATES[templateId as keyof typeof AGENT_TEMPLATES];
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  // Code agents require repo_url
  if (template.agent_type === 'code' && !repo_url) {
    return res.status(400).json({ error: 'repo_url is required for code agent templates' });
  }

  const sessionId = uuidv4();
  const name = name_override || template.name;
  const organizationId = (req as any).organizationId;

  await execute(
    `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_url, repo_name, branch, agent_provider, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
    [
      sessionId,
      userId,
      organizationId || null,
      template.agent_type,
      repo_url || null,
      repo_url ? repo_url.split('/').slice(-2).join('/') : name,
      'main',
      'claude-code',
    ]
  );

  const configId = uuidv4();
  await execute(
    `INSERT INTO agent_configs (id, session_id, name, system_prompt) VALUES ($1, $2, $3, $4)`,
    [configId, sessionId, name, template.system_prompt]
  );

  // Auto-attach the default "Files" bucket to task agents (code agents have repos)
  try {
    await attachDefaultBucketToSession(sessionId, userId, organizationId || null, template.agent_type);
  } catch (err) {
    console.error('[Builder] Failed to attach default bucket:', err);
  }

  res.json({
    agent: {
      id: sessionId,
      name,
      type: template.agent_type,
      template: templateId,
      description: template.description,
    },
  });
});

// Create workflow from template
router.post('/workflow-templates/:templateId/create', requireAuth, async (req, res) => {
  const { templateId } = req.params;
  const { name_override } = req.body;
  const userId = req.session.userId!;
  const organizationId = (req as any).organizationId;

  const template = WORKFLOW_TEMPLATES[templateId as keyof typeof WORKFLOW_TEMPLATES];
  if (!template) {
    return res.status(404).json({ error: 'Workflow template not found' });
  }

  const workflowId = uuidv4();
  const name = name_override || template.name;

  // Create the workflow
  await execute(
    `INSERT INTO workflows (id, user_id, organization_id, name, description, status) VALUES ($1, $2, $3, $4, $5, 'draft')`,
    [workflowId, userId, organizationId || null, name, template.description]
  );

  // Create nodes with proper positioning
  const nodeIdMap: Record<string, string> = {};
  let posY = 100;
  
  for (const node of template.nodes) {
    const nodeId = uuidv4();
    nodeIdMap[node.name] = nodeId;
    
    await execute(
      `INSERT INTO workflow_nodes (id, workflow_id, node_type, name, config, position_x, position_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nodeId, workflowId, node.type, node.name, JSON.stringify(node.config || {}), 400, posY]
    );
    
    // If it's an agent node, create the agent
    if (node.type === 'agent') {
      const agentSessionId = uuidv4();
      await execute(
        `INSERT INTO sessions (id, user_id, organization_id, agent_type, repo_name, branch, agent_provider, status)
         VALUES ($1, $2, $3, 'task', $4, 'main', 'claude-code', 'pending')`,
        [agentSessionId, userId, organizationId || null, node.name]
      );
      
      const configId = uuidv4();
      await execute(
        `INSERT INTO agent_configs (id, session_id, name, system_prompt) VALUES ($1, $2, $3, $4)`,
        [configId, agentSessionId, node.name, `You are ${node.name}. ${node.config?.prompt_template || ''}`]
      );
      
      // Auto-attach the default "Files" bucket to task agents
      try {
        await attachDefaultBucketToSession(agentSessionId, userId, organizationId || null, 'task');
      } catch (err) {
        console.error('[Builder] Failed to attach default bucket:', err);
      }
      
      // Update node config with agent_id
      await execute(
        `UPDATE workflow_nodes SET config = $1 WHERE id = $2`,
        [JSON.stringify({ ...node.config, agent_id: agentSessionId }), nodeId]
      );
    }
    
    posY += 150;
  }

  // Create edges connecting sequential nodes
  for (let i = 0; i < template.nodes.length - 1; i++) {
    const sourceNode = template.nodes[i];
    const targetNode = template.nodes[i + 1];
    const edgeId = uuidv4();
    
    await execute(
      `INSERT INTO workflow_edges (id, workflow_id, source_node_id, target_node_id)
       VALUES ($1, $2, $3, $4)`,
      [edgeId, workflowId, nodeIdMap[sourceNode.name], nodeIdMap[targetNode.name]]
    );
  }

  res.json({
    workflow: {
      id: workflowId,
      name,
      template: templateId,
      description: template.description,
      node_count: template.nodes.length,
    },
  });
});

export default router;
