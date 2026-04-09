import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db/index.js';
import { ocService } from './oc.js';
import type { WorkflowStep, Session, AgentConfig, QueuedTask, ModelProvider } from '../types/index.js';

interface WorkflowContext {
  input: Record<string, string>;
  results: Record<string, string>;
  currentStep: number;
}

interface ParsedWorkflowStep extends Omit<WorkflowStep, 'config'> {
  config: Record<string, unknown>;
}

// Interpolate variables in a string (e.g., "Hello {{name}}" with {name: "World"} -> "Hello World")
function interpolate(template: string, context: WorkflowContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    // Check input first, then results
    if (key in context.input) {
      return context.input[key];
    }
    // Check for step results (e.g., step_1_result)
    const stepMatch = key.match(/^step_(\d+)_result$/);
    if (stepMatch) {
      const stepNum = parseInt(stepMatch[1], 10);
      return context.results[`step_${stepNum}`] || match;
    }
    if (key === 'result') {
      // Get the most recent result
      const lastStep = context.currentStep - 1;
      return context.results[`step_${lastStep}`] || match;
    }
    return match;
  });
}

// Execute a single workflow step
async function executeStep(
  step: ParsedWorkflowStep,
  context: WorkflowContext,
  session: Session,
  config: AgentConfig | null
): Promise<string> {
  const stepConfig = step.config as Record<string, string>;
  
  switch (step.action_type) {
    case 'prompt': {
      const text = interpolate(stepConfig.text || '', context);
      
      // Get API key based on provider
      const apiKey = session.agent_provider === 'aider' 
        ? process.env.OPENAI_API_KEY! 
        : process.env.ANTHROPIC_API_KEY!;
      
      // Build extended thinking config from agent settings
      const extendedThinking = config?.enable_extended_thinking
        ? { enabled: true, budgetTokens: config.thinking_budget_tokens || 100000 }
        : undefined;
      
      // Run prompt through the agent
      const result = await ocService.runAgentCommand(
        session.id,
        session.agent_provider as ModelProvider,
        text,
        apiKey,
        session.agent_model,
        undefined, // allApiKeys
        undefined, // customSecrets
        undefined, // systemPrompt
        extendedThinking
      );
      
      return result.stdout || '';
    }
    
    case 'fetch': {
      const url = interpolate(stepConfig.url || '', context);
      
      try {
        const response = await fetch(url);
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          const json = await response.json();
          return JSON.stringify(json, null, 2);
        }
        
        return await response.text();
      } catch (error) {
        console.error(`[Workflow] Fetch error for ${url}:`, error);
        throw new Error(`Failed to fetch ${url}`);
      }
    }
    
    case 'write': {
      const path = interpolate(stepConfig.path || '', context);
      const content = interpolate(stepConfig.content || '', context);
      
      // Write file in sandbox
      const sandbox = await ocService.getSandbox(session.id);
      if (sandbox) {
        await sandbox.files.write(path, content);
        return `Wrote ${content.length} bytes to ${path}`;
      }
      throw new Error('Sandbox not available');
    }
    
    case 'webhook': {
      const url = interpolate(stepConfig.url || '', context);
      const body = stepConfig.body 
        ? JSON.parse(interpolate(JSON.stringify(stepConfig.body), context))
        : { ...context.input, ...context.results };
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        
        return `Webhook sent to ${url}, status: ${response.status}`;
      } catch (error) {
        console.error(`[Workflow] Webhook error for ${url}:`, error);
        throw new Error(`Failed to send webhook to ${url}`);
      }
    }
    
    case 'chain': {
      const targetAgentId = stepConfig.agent_id;
      const prompt = interpolate(stepConfig.prompt || '{{result}}', context);
      
      // Queue a task for the target agent
      const taskId = uuidv4();
      await execute(
        `INSERT INTO task_queue (id, agent_id, user_id, prompt, source, priority) 
         VALUES ($1, $2, $3, $4, 'workflow', $5)`,
        [taskId, targetAgentId, session.user_id, prompt, 1]
      );
      
      return `Chained to agent ${targetAgentId}, task: ${taskId}`;
    }
    
    default:
      throw new Error(`Unknown action type: ${step.action_type}`);
  }
}

// Execute a complete workflow
export async function executeWorkflow(
  agentId: string,
  input: Record<string, string>
): Promise<Record<string, string>> {
  console.log(`[Workflow] Executing workflow for agent ${agentId}`);
  
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1',
    [agentId]
  );
  
  if (!session) {
    throw new Error('Agent not found');
  }
  
  const config = await queryOne<AgentConfig>(
    'SELECT * FROM agent_configs WHERE session_id = $1',
    [agentId]
  );
  
  const steps = await query<WorkflowStep>(
    'SELECT * FROM workflow_steps WHERE agent_id = $1 ORDER BY step_order ASC',
    [agentId]
  );
  
  if (steps.length === 0) {
    throw new Error('No workflow steps defined');
  }
  
  // Configure Claude settings with file bucket instructions (if agent has buckets)
  try {
    const gatewayBaseUrl = process.env.GATEWAY_URL || process.env.PUBLIC_URL || 'http://localhost:3000';
    await ocService.configureClaudeSettings(session.id, {
      systemPrompt: config?.system_prompt,
      agentId,
      gatewayBaseUrl,
    });
    console.log(`[Workflow] Configured Claude settings with file bucket support`);
  } catch (err) {
    console.warn(`[Workflow] Failed to configure Claude settings:`, err);
    // Continue anyway - not critical
  }
  
  // Parse configs
  const parsedSteps: ParsedWorkflowStep[] = steps.map(step => ({
    ...step,
    config: JSON.parse(step.config),
  }));
  
  const context: WorkflowContext = {
    input,
    results: {},
    currentStep: 0,
  };
  
  // Execute each step
  for (const step of parsedSteps) {
    context.currentStep = step.step_order + 1;
    console.log(`[Workflow] Executing step ${context.currentStep}: ${step.action_type}`);
    
    try {
      const result = await executeStep(step, context, session, config || null);
      context.results[`step_${context.currentStep}`] = result;
      console.log(`[Workflow] Step ${context.currentStep} completed`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Workflow] Step ${context.currentStep} failed:`, errorMsg);
      context.results[`step_${context.currentStep}_error`] = errorMsg;
      throw error;
    }
  }
  
  // Sync files back after workflow completes
  try {
    const { syncAgentBucketsBackAndIndex } = await import('./attachedFilesSync.js');
    await syncAgentBucketsBackAndIndex({
      sandboxSessionId: session.id,
      agentId,
      ownerUserId: session.user_id,
    });
    console.log(`[Workflow] Synced files back to storage`);
  } catch (err) {
    console.warn(`[Workflow] Failed to sync files:`, err);
    // Don't fail the workflow if file sync fails
  }
  
  return context.results;
}

// Check if an agent has a workflow defined
export async function hasWorkflow(agentId: string): Promise<boolean> {
  const count = await queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM workflow_steps WHERE agent_id = $1',
    [agentId]
  );
  return (count?.count || 0) > 0;
}

// Get workflow for an agent
export async function getWorkflowSteps(agentId: string): Promise<ParsedWorkflowStep[]> {
  const steps = await query<WorkflowStep>(
    'SELECT * FROM workflow_steps WHERE agent_id = $1 ORDER BY step_order ASC',
    [agentId]
  );
  
  return steps.map(step => ({
    ...step,
    config: JSON.parse(step.config),
  }));
}
