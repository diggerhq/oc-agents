/**
 * Portal Agent Setup Wizard
 * 
 * Streamlined wizard that funnels the user through a strict sequence.
 * Steps: Basics -> System Prompt -> Skills (upload only) -> Reference Files -> Knowledge -> Portal Settings -> Review
 *
 * Design principles:
 *  - No skipping ahead, no clicking ahead in the step indicator
 *  - Builtin skills are always enabled (no toggles)
 *  - All tools are always enabled (no tools step)
 *  - Thinking budget + max output are hidden (defaults to ultrathink + max)
 *  - Files step = attach READ-ONLY reference buckets (output bucket is auto-created)
 */

import { useState, useEffect, useRef } from 'react';
import { agentConfig, files, skills as skillsApi, AgentConfigType } from '@/lib/api';

interface PortalAgentWizardProps {
  sessionId: string;
  config: AgentConfigType | null;
  onComplete: () => void;
  onConfigUpdate: (config: AgentConfigType) => void;
}

type WizardStep = 'basics' | 'prompt' | 'skills' | 'files' | 'knowledge' | 'portal' | 'review';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'prompt', label: 'System Prompt' },
  { id: 'skills', label: 'Skill Files' },
  { id: 'files', label: 'Reference Files' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'portal', label: 'Portal Settings' },
  { id: 'review', label: 'Review & Launch' },
];

// Only models that support extended thinking (Haiku does not support thinking)
const PORTAL_MODELS = [
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Best balance of speed and intelligence (recommended)' },
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most intelligent, best for complex reasoning' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Fast and capable, previous generation' },
];

// All tools are always enabled — these are the IDs we persist
const ALL_TOOL_IDS = ['search_knowledge_base', 'read_file', 'write_file', 'list_files', 'web_search', 'run_code'];

export function PortalAgentWizard({ sessionId, config, onComplete, onConfigUpdate }: Readonly<PortalAgentWizardProps>) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('basics');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Basics (only name + model visible; thinking/max are hidden defaults)
  const [agentName, setAgentName] = useState(config?.name || '');
  const [selectedModel, setSelectedModel] = useState(config?.portal_agent_model || 'claude-sonnet-4-5-20250929');

  // System Prompt
  const [systemPrompt, setSystemPrompt] = useState(config?.system_prompt || '');

  // Skill file uploads
  const [uploadedSkills, setUploadedSkills] = useState<string[]>([]);
  const skillInputRef = useRef<HTMLInputElement>(null);

  // Reference files (read-only buckets)
  const [attachedBuckets, setAttachedBuckets] = useState<Array<{ id: string; bucket_id: string; bucket_name: string }>>([]);
  const [allBuckets, setAllBuckets] = useState<Array<{ id: string; name: string }>>([]);

  // Knowledge
  const [allKnowledgeBases, setAllKnowledgeBases] = useState<Array<{ id: string; name: string; status: string; indexed_files: number }>>([]);
  const [attachedKBs, setAttachedKBs] = useState<Array<{ id: string; name: string; status: string }>>([]);

  // Portal
  const [portalGreeting, setPortalGreeting] = useState(config?.portal_greeting || '');
  const [portalName, setPortalName] = useState(config?.portal_name || agentName);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(config?.portal_suggested_questions || []);
  const [newQuestion, setNewQuestion] = useState('');

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

  // Load data on mount
  useEffect(() => {
    loadBuckets();
    loadKnowledgeBases();
    enableAllBuiltinSkills();
  }, []);

  const loadBuckets = async () => {
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      // Filter out the auto-created output bucket (named like "Portal Agent Output - <name>")
      setAttachedBuckets(agentBuckets.filter((b: any) => !b.bucket_name?.startsWith('Portal Output')));
      const { buckets: allB } = await files.listBuckets();
      // Hide the auto-created output bucket from the available list too
      setAllBuckets(allB.filter((b: any) => !b.name?.startsWith('Portal Output')));
    } catch { /* ignore */ }
  };

  const loadKnowledgeBases = async () => {
    try {
      const allRes = await fetch('/api/knowledge', { credentials: 'include' });
      if (allRes.ok) {
        const data = await allRes.json();
        setAllKnowledgeBases(data.knowledgeBases || []);
      }
      const attachedRes = await fetch(`/api/knowledge/agents/${sessionId}`, { credentials: 'include' });
      if (attachedRes.ok) {
        const data = await attachedRes.json();
        setAttachedKBs(data.knowledgeBases || []);
      }
    } catch { /* ignore */ }
  };

  const enableAllBuiltinSkills = async () => {
    // Always enable ALL builtin skills — no user choice
    try {
      const res = await fetch(`/api/skills/agents/${sessionId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const allIds = (data.builtinSkills || []).map((s: any) => s.id);
        if (allIds.length > 0) {
          await skillsApi.updateSkills(sessionId, allIds);
        }
      }
    } catch { /* ignore */ }
  };

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].id);
    }
  };

  const goPrev = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex].id);
    }
  };

  const saveConfig = async (updates: Partial<AgentConfigType>) => {
    setSaving(true);
    setError('');
    try {
      const { config: updated } = await agentConfig.update(sessionId, updates);
      onConfigUpdate(updated);
      return true;
    } catch (err: any) {
      setError(err.message || 'Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndNext = async () => {
    let updates: Partial<AgentConfigType> = {};

    switch (currentStep) {
      case 'basics':
        // Model selection only - max_tokens and thinking_budget are auto-derived from model
        updates = {
          name: agentName,
          portal_agent_model: selectedModel,
        };
        break;
      case 'prompt':
        updates = { system_prompt: systemPrompt };
        break;
      case 'skills':
        // Skill file uploads happen inline — nothing to persist here
        break;
      case 'files':
        // Bucket attachments happen inline — nothing to persist here
        break;
      case 'knowledge':
        // KB attachments happen inline — nothing to persist here
        break;
      case 'portal':
        // Also persist all tools enabled + sandbox enabled
        updates = {
          portal_name: portalName || agentName,
          portal_greeting: portalGreeting,
          portal_suggested_questions: suggestedQuestions,
          portal_agent_tools: JSON.stringify(ALL_TOOL_IDS),
          portal_agent_sandbox_enabled: true,
        } as any;
        break;
      case 'review': {
        const saved = await saveConfig({ setup_wizard_completed: true } as any);
        if (saved) onComplete();
        return;
      }
      default:
        break;
    }

    if (Object.keys(updates).length > 0) {
      const saved = await saveConfig(updates);
      if (!saved) return;
    }
    goNext();
  };

  const handleSkillUpload = async (fileList: FileList) => {
    // Upload to the agent's auto-created output bucket under /skills
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const outputBucket = agentBuckets.find((b: any) => b.bucket_name?.startsWith('Portal Output'));
      if (!outputBucket) {
        setError('Output bucket not found. Please try again.');
        return;
      }
      const bucketId = outputBucket.bucket_id;

      for (const file of Array.from(fileList)) {
        try {
          // Ensure skills folder exists
          try {
            await fetch(`/api/files/buckets/${bucketId}/folders`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ name: 'skills', parentPath: '/' }),
            });
          } catch { /* folder may already exist */ }

          const formData = new FormData();
          formData.append('files', file);
          formData.append('parentPath', '/skills');
          formData.append('relativePaths', JSON.stringify([file.name]));

          const res = await fetch(`/api/files/buckets/${bucketId}/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
          });

          if (res.ok) {
            setUploadedSkills(prev => [...prev, file.name]);
          }
        } catch (err) {
          console.error('Failed to upload skill file:', err);
        }
      }
    } catch (err) {
      console.error('Failed to upload skill files:', err);
      setError('Failed to upload skill files');
    }
  };

  const handleAttachBucket = async (bucketId: string) => {
    try {
      await files.addAgentBucket(sessionId, bucketId);
      await loadBuckets();
    } catch { /* ignore */ }
  };

  const handleDetachBucket = async (bucketId: string) => {
    try {
      await files.removeAgentBucket(sessionId, bucketId);
      await loadBuckets();
    } catch { /* ignore */ }
  };

  const handleAttachKB = async (kbId: string) => {
    try {
      await fetch(`/api/knowledge/agents/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ knowledge_base_id: kbId }),
      });
      await loadKnowledgeBases();
    } catch { /* ignore */ }
  };

  const handleDetachKB = async (kbId: string) => {
    try {
      await fetch(`/api/knowledge/agents/${sessionId}/${kbId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await loadKnowledgeBases();
    } catch { /* ignore */ }
  };

  const addSuggestedQuestion = () => {
    if (newQuestion.trim() && suggestedQuestions.length < 4) {
      setSuggestedQuestions(prev => [...prev, newQuestion.trim()]);
      setNewQuestion('');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Step indicator — no clicking ahead */}
      <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-2">
        {STEPS.map((step, index) => (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap ${
                currentStep === step.id
                  ? 'bg-blue-500 text-white'
                  : index < currentStepIndex
                  ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500'
              }`}
            >
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium border border-current">
                {index < currentStepIndex ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </div>
            {index < STEPS.length - 1 && (
              <div className="w-4 h-px bg-slate-300 dark:bg-slate-600 mx-1" />
            )}
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full mb-6">
        <div
          className="h-1 bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-6">

        {/* ============ BASICS ============ */}
        {currentStep === 'basics' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Basics</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Give your agent a name and choose a model.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g., Customer Support Agent"
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-3">Model</label>
              <div className="space-y-2">
                {PORTAL_MODELS.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className={`w-full p-3 rounded-lg border text-left transition-colors ${
                      selectedModel === model.id
                        ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500'
                        : 'border-slate-200 dark:border-slate-600 hover:border-blue-500/50 bg-white dark:bg-slate-700'
                    }`}
                  >
                    <div className={`font-medium text-sm ${selectedModel === model.id ? 'text-blue-500' : 'text-slate-900 dark:text-white'}`}>{model.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{model.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ============ SYSTEM PROMPT ============ */}
        {currentStep === 'prompt' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">System Prompt</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Define how your agent should behave. This is the most important part of configuration.</p>
            </div>

            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful customer support agent for Acme Corp..."
              rows={12}
              className="w-full px-4 py-3 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSystemPrompt('You are a helpful customer support agent. Be friendly, concise, and accurate. If you don\'t know something, say so honestly. Use the knowledge base to find relevant information before answering.')}
                className="text-xs px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Support Agent
              </button>
              <button
                type="button"
                onClick={() => setSystemPrompt('You are a knowledgeable research assistant. Help users find information, analyze documents, and synthesize insights from multiple sources. Always cite your sources when possible.')}
                className="text-xs px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Research Assistant
              </button>
              <button
                type="button"
                onClick={() => setSystemPrompt('You are a data analyst assistant. Help users understand their data, generate reports, and extract insights. When analyzing data, be thorough and present findings clearly with relevant metrics.')}
                className="text-xs px-3 py-1.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Data Analyst
              </button>
            </div>
          </div>
        )}

        {/* ============ SKILL FILES ============ */}
        {currentStep === 'skills' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Skill Files</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Upload skill files (.md) to give your agent specialized knowledge and behavior instructions.
                These are like instruction manuals the agent can reference.
              </p>
            </div>

            {/* Upload area */}
            <button
              type="button"
              onClick={() => skillInputRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
            >
              <svg className="w-8 h-8 text-slate-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-slate-600 dark:text-slate-400">Click to upload skill files</p>
              <p className="text-xs text-slate-400 mt-1">Supports .md, .txt, .json files</p>
              <input
                ref={skillInputRef}
                type="file"
                accept=".md,.txt,.json"
                multiple
                onChange={(e) => e.target.files && handleSkillUpload(e.target.files)}
                className="hidden"
              />
            </button>

            {/* Uploaded */}
            {uploadedSkills.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Uploaded</h4>
                <div className="space-y-2">
                  {uploadedSkills.map((name, i) => (
                    <div key={`skill-${name}-${i}`} className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-slate-700 dark:text-slate-300">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400 dark:text-slate-500">
              You can skip this step and add skill files later from the Configure tab.
            </p>
          </div>
        )}

        {/* ============ REFERENCE FILES (read-only buckets) ============ */}
        {currentStep === 'files' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Reference Files</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Attach file buckets the agent can <span className="font-medium">read from</span> for reference material.
                These are read-only — the agent has its own private output bucket for writing.
              </p>
            </div>

            {/* Attached read-only buckets */}
            {attachedBuckets.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Attached (Read-Only)</h4>
                <div className="space-y-2">
                  {attachedBuckets.map((ab) => (
                    <div key={ab.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="text-sm text-slate-700 dark:text-slate-300">{ab.bucket_name}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 rounded">read-only</span>
                      </div>
                      <button
                        onClick={() => handleDetachBucket(ab.bucket_id)}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Available */}
            {allBuckets.filter(b => !attachedBuckets.some(ab => ab.bucket_id === b.id)).length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Available Buckets</h4>
                <div className="space-y-2">
                  {allBuckets
                    .filter(b => !attachedBuckets.some(ab => ab.bucket_id === b.id))
                    .map((bucket) => (
                      <div key={bucket.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                        <span className="text-sm text-slate-700 dark:text-slate-300">{bucket.name}</span>
                        <button
                          onClick={() => handleAttachBucket(bucket.id)}
                          className="text-xs px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                        >
                          Attach
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allBuckets.length === 0 && attachedBuckets.length === 0 && (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                <p className="text-sm">No file buckets found. You can create buckets in the Files section and attach them later.</p>
              </div>
            )}

            <p className="text-xs text-slate-400 dark:text-slate-500">
              You can skip this step and attach reference buckets later from the Configure tab.
            </p>
          </div>
        )}

        {/* ============ KNOWLEDGE ============ */}
        {currentStep === 'knowledge' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Knowledge Bases</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Attach knowledge bases so the agent can search indexed documents during conversations.</p>
            </div>

            {/* Attached KBs */}
            {attachedKBs.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Attached</h4>
                <div className="space-y-2">
                  {attachedKBs.map((kb) => (
                    <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <div>
                          <span className="text-sm text-slate-700 dark:text-slate-300">{kb.name}</span>
                          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${kb.status === 'ready' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'}`}>
                            {kb.status}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDetachKB(kb.id)}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Available KBs */}
            {allKnowledgeBases.filter(kb => !attachedKBs.some(a => a.id === kb.id)).length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Available</h4>
                <div className="space-y-2">
                  {allKnowledgeBases
                    .filter(kb => !attachedKBs.some(a => a.id === kb.id))
                    .map((kb) => (
                      <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                        <div>
                          <span className="text-sm text-slate-700 dark:text-slate-300">{kb.name}</span>
                          <span className="text-xs text-slate-400 ml-2">{kb.indexed_files} files indexed</span>
                        </div>
                        <button
                          onClick={() => handleAttachKB(kb.id)}
                          className="text-xs px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors"
                        >
                          Attach
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {allKnowledgeBases.length === 0 && (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">
                <p className="text-sm">No knowledge bases found. You can create them in the Knowledge section and attach later.</p>
              </div>
            )}

            <p className="text-xs text-slate-400 dark:text-slate-500">
              You can skip this step and attach knowledge bases later from the Configure tab.
            </p>
          </div>
        )}

        {/* ============ PORTAL SETTINGS ============ */}
        {currentStep === 'portal' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Portal Settings</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Configure how the portal appears to your users.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Portal Name</label>
              <input
                type="text"
                value={portalName}
                onChange={(e) => setPortalName(e.target.value)}
                placeholder="e.g., Acme Support"
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">Greeting Message</label>
              <input
                type="text"
                value={portalGreeting}
                onChange={(e) => setPortalGreeting(e.target.value)}
                placeholder="e.g., Hi! I'm your Acme support assistant. How can I help?"
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
                Suggested Questions ({suggestedQuestions.length}/4)
              </label>
              <div className="space-y-2 mb-2">
                {suggestedQuestions.map((q, i) => (
                  <div key={`q-${i}`} className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-700/50 px-3 py-2 rounded-lg">{q}</span>
                    <button
                      onClick={() => setSuggestedQuestions(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-red-500 hover:text-red-600 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              {suggestedQuestions.length < 4 && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addSuggestedQuestion()}
                    placeholder="Type a suggested question..."
                    className="flex-1 px-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                  />
                  <button
                    onClick={addSuggestedQuestion}
                    className="px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ REVIEW ============ */}
        {currentStep === 'review' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Review & Launch</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Everything looks good? Hit Launch to activate your portal agent.</p>
            </div>

            <div className="space-y-4">
              <ReviewItem label="Name" value={agentName || 'Not set'} />
              <ReviewItem label="Model" value={PORTAL_MODELS.find(m => m.id === selectedModel)?.name || selectedModel} />
              <ReviewItem label="System Prompt" value={systemPrompt ? `${systemPrompt.slice(0, 100)}...` : 'Not set'} />
              <ReviewItem label="Skill Files" value={uploadedSkills.length > 0 ? `${uploadedSkills.length} uploaded` : 'None'} />
              <ReviewItem label="Reference Buckets" value={attachedBuckets.length > 0 ? `${attachedBuckets.length} attached` : 'None'} />
              <ReviewItem label="Knowledge Bases" value={attachedKBs.length > 0 ? `${attachedKBs.length} attached` : 'None'} />
              <ReviewItem label="Portal Name" value={portalName || agentName || 'Not set'} />
              <ReviewItem label="Greeting" value={portalGreeting || 'Default'} />
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between">
        <button
          onClick={goPrev}
          disabled={currentStepIndex === 0}
          className="px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>

        <div className="flex gap-3">
          {/* Skip only on optional steps: skills, files, knowledge */}
          {(currentStep === 'skills' || currentStep === 'files' || currentStep === 'knowledge') && (
            <button
              onClick={goNext}
              className="px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={handleSaveAndNext}
            disabled={saving || (currentStep === 'basics' && !agentName.trim())}
            className="px-5 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:text-slate-500"
          >
            {saving ? 'Saving...' : currentStep === 'review' ? 'Launch Agent' : 'Save & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewItem({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}
