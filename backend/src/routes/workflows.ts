import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.js';
import { queryOne, query, execute } from '../db/index.js';
import type { Session, PromptTemplate, WorkflowStep } from '../types/index.js';

const router = Router();

// ===============================
// Prompt Templates
// ===============================

// List templates for an agent
router.get('/:agentId/templates', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const templates = await query<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE agent_id = $1 ORDER BY created_at DESC',
    [session.id]
  );
  
  res.json({ templates });
});

// Create a template
router.post('/:agentId/templates', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const { name, template, variables } = req.body;
  
  if (!name || !template) {
    return res.status(400).json({ error: 'Name and template are required' });
  }
  
  const id = uuidv4();
  const variablesJson = variables ? JSON.stringify(variables) : null;
  
  await execute(
    'INSERT INTO prompt_templates (id, agent_id, name, template, variables) VALUES ($1, $2, $3, $4, $5)',
    [id, session.id, name, template, variablesJson]
  );
  
  const created = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [id]
  );
  
  res.json({ template: created });
});

// Update a template
router.patch('/:agentId/templates/:templateId', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const existing = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1 AND agent_id = $2',
    [req.params.templateId, session.id]
  );
  
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }
  
  const { name, template, variables } = req.body;
  
  const updates: string[] = [];
  const values: (string | null)[] = [];
  const setValue = (column: string, value: string | null) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };
  
  if (name !== undefined) {
    setValue('name', name);
  }
  if (template !== undefined) {
    setValue('template', template);
  }
  if (variables !== undefined) {
    setValue('variables', variables ? JSON.stringify(variables) : null);
  }
  
  if (updates.length > 0) {
    values.push(req.params.templateId);
    await execute(
      `UPDATE prompt_templates SET ${updates.join(', ')} WHERE id = $${values.length}`,
      values
    );
  }
  
  const updated = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1',
    [req.params.templateId]
  );
  
  res.json({ template: updated });
});

// Delete a template
router.delete('/:agentId/templates/:templateId', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const existing = await queryOne<PromptTemplate>(
    'SELECT * FROM prompt_templates WHERE id = $1 AND agent_id = $2',
    [req.params.templateId, session.id]
  );
  
  if (!existing) {
    return res.status(404).json({ error: 'Template not found' });
  }
  
  await execute('DELETE FROM prompt_templates WHERE id = $1', [req.params.templateId]);
  
  res.json({ success: true });
});

// ===============================
// Workflow Steps
// ===============================

// Get workflow for an agent
router.get('/:agentId/workflow', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const steps = await query<WorkflowStep>(
    'SELECT * FROM workflow_steps WHERE agent_id = $1 ORDER BY step_order ASC',
    [session.id]
  );
  
  // Parse config JSON for each step
  const parsedSteps = steps.map(step => ({
    ...step,
    config: JSON.parse(step.config),
  }));
  
  res.json({ steps: parsedSteps });
});

// Save workflow (replace all steps)
router.put('/:agentId/workflow', requireAuth, async (req, res) => {
  const session = await queryOne<Session>(
    'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
    [req.params.agentId, req.session.userId]
  );
  
  if (!session) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const { steps } = req.body;
  
  if (!Array.isArray(steps)) {
    return res.status(400).json({ error: 'Steps must be an array' });
  }
  
  // Delete existing steps
  await execute('DELETE FROM workflow_steps WHERE agent_id = $1', [session.id]);
  
  // Insert new steps
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index] as { action_type: string; config: Record<string, unknown> };
    const id = uuidv4();
    await execute(
      'INSERT INTO workflow_steps (id, agent_id, step_order, action_type, config) VALUES ($1, $2, $3, $4, $5)',
      [id, session.id, index, step.action_type, JSON.stringify(step.config)]
    );
  }
  
  // Return the saved workflow
  const savedSteps = await query<WorkflowStep>(
    'SELECT * FROM workflow_steps WHERE agent_id = $1 ORDER BY step_order ASC',
    [session.id]
  );
  
  const parsedSteps = savedSteps.map(step => ({
    ...step,
    config: JSON.parse(step.config),
  }));
  
  res.json({ steps: parsedSteps });
});

export default router;
