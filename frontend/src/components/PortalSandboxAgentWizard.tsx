/**
 * Portal Agent Setup Wizard
 * 
 * Streamlined wizard that funnels the user through a strict sequence.
 * Steps: Basics -> System Prompt -> Skills (upload only) -> Reference Files -> Knowledge -> MCP Servers -> Portal Settings -> Review
 *
 * Design principles:
 *  - No skipping ahead, no clicking ahead in the step indicator
 *  - Builtin skills are always enabled (no toggles)
 *  - All tools are always enabled (no tools step)
 *  - Thinking budget + max output are hidden (defaults to ultrathink + max)
 *  - Files step = attach READ-ONLY reference buckets (output bucket is auto-created)
 */

import { useState, useEffect, useRef } from 'react';
import { agentConfig, files, skills as skillsApi, AgentConfigType, MCPServerConfig } from '@/lib/api';

interface PortalAgentWizardProps {
  sessionId: string;
  config: AgentConfigType | null;
  onComplete: () => void;
  onConfigUpdate: (config: AgentConfigType) => void;
}

type WizardStep = 'basics' | 'prompt' | 'skills' | 'files' | 'knowledge' | 'mcp' | 'portal' | 'review';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'prompt', label: 'System Prompt' },
  { id: 'skills', label: 'Skill Files' },
  { id: 'files', label: 'Reference Files' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'mcp', label: 'MCP Servers' },
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

export function PortalSandboxAgentWizard({ sessionId, config, onComplete, onConfigUpdate }: Readonly<PortalAgentWizardProps>) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('basics');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Basics (only name + model visible; thinking/max are hidden defaults)
  const [agentName, setAgentName] = useState(config?.name || '');
  const [selectedModel, setSelectedModel] = useState(config?.portal_agent_model || 'claude-sonnet-4-5-20250929');

  // System Prompt
  const [systemPrompt, setSystemPrompt] = useState(config?.system_prompt || '');

  // Skill file uploads
  const [uploadedSkills, setUploadedSkills] = useState<Array<{id: string; name: string; friendlyName: string; isFolder?: boolean}>>([]);
  const skillInputRef = useRef<HTMLInputElement>(null);
  const skillFolderInputRef = useRef<HTMLInputElement>(null);

  // Reference file uploads (to input bucket)
  const [uploadedReferenceFiles, setUploadedReferenceFiles] = useState<Array<{id: string; name: string}>>([]);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  // Knowledge
  const [allKnowledgeBases, setAllKnowledgeBases] = useState<Array<{ id: string; name: string; status: string; indexed_files: number }>>([]);
  const [attachedKBs, setAttachedKBs] = useState<Array<{ id: string; name: string; status: string }>>([]);

  // MCP Servers
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'sse' | 'streamable-http'>('streamable-http');
  const [newMcpAuthType, setNewMcpAuthType] = useState<'none' | 'bearer' | 'custom'>('none');
  const [newMcpAuthValue, setNewMcpAuthValue] = useState('');
  const [newMcpCustomHeaderName, setNewMcpCustomHeaderName] = useState('');
  const [testingMcpServer, setTestingMcpServer] = useState<string | null>(null);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { success: boolean; tools?: { name: string; description: string }[]; error?: string }>>({});

  // Portal
  const [portalGreeting, setPortalGreeting] = useState(config?.portal_greeting || '');
  const [portalName, setPortalName] = useState(config?.portal_name || agentName);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>(config?.portal_suggested_questions || []);
  const [newQuestion, setNewQuestion] = useState('');

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

  // Load data on mount
  useEffect(() => {
    loadKnowledgeBases();
    enableAllBuiltinSkills();
    loadUploadedSkills();
    loadUploadedReferenceFiles();
    loadMcpServers();
  }, []);

  const loadUploadedSkills = async () => {
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const skillsBucket = agentBuckets.find((b: any) => b.bucket_name?.includes(' - Skills') || b.bucket_name?.includes('_skills'));
      if (!skillsBucket) return;

      // Fetch files from skills bucket root
      const res = await fetch(`/api/files/buckets/${skillsBucket.bucket_id}/files?path=/`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const items: Array<{id: string; name: string; friendlyName: string; isFolder?: boolean}> = [];

        for (const f of data.files) {
          if (f.is_folder) {
            // Show folders as skill folders
            items.push({
              id: f.id,
              name: `${f.name}/`,
              friendlyName: f.friendly_name || f.name.replace(/[-_]/g, ' '),
              isFolder: true,
            });
          } else if (f.name.endsWith('.md') || f.name.endsWith('.mdc') || f.name.endsWith('.skill') || f.name.endsWith('.txt') || f.name.endsWith('.json')) {
            items.push({
              id: f.id,
              name: f.name,
              friendlyName: f.friendly_name || f.name.replace(/\.(md|mdc|skill|txt|json)$/i, '').replace(/[-_]/g, ' '),
            });
          }
        }

        setUploadedSkills(items);
      }
    } catch (err) {
      console.error('Failed to load uploaded skills:', err);
    }
  };

  const loadUploadedReferenceFiles = async () => {
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const inputBucket = agentBuckets.find((b: any) => b.bucket_name?.includes(' - Input') || b.bucket_name?.includes('_input'));
      if (!inputBucket) return;

      const res = await fetch(`/api/files/buckets/${inputBucket.bucket_id}/files?path=/`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const refFiles = data.files
          .filter((f: any) => !f.is_folder)
          .map((f: any) => ({ id: f.id, name: f.name }));
        setUploadedReferenceFiles(refFiles);
      }
    } catch { /* ignore */ }
  };

  const handleReferenceFileUpload = async (fileList: FileList) => {
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const inputBucket = agentBuckets.find((b: any) => b.bucket_name?.includes(' - Input') || b.bucket_name?.includes('_input'));
      if (!inputBucket) {
        setError('Input bucket not found. Please try again.');
        return;
      }
      const bucketId = inputBucket.bucket_id;

      for (const file of Array.from(fileList)) {
        try {
          const formData = new FormData();
          formData.append('files', file);
          formData.append('parentPath', '/');
          formData.append('relativePaths', JSON.stringify([file.name]));

          const res = await fetch(`/api/files/buckets/${bucketId}/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
          });

          if (res.ok) {
            const result = await res.json();
            if (result.files && result.files.length > 0) {
              const uploadedFile = result.files[0];
              setUploadedReferenceFiles(prev => [...prev, {
                id: uploadedFile.id,
                name: uploadedFile.name,
              }]);
            }
          }
        } catch (err) {
          console.error('Failed to upload reference file:', err);
        }
      }
    } catch (err) {
      setError('Failed to upload reference files');
    }
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

  const loadMcpServers = async () => {
    try {
      const data = await skillsApi.getAgentSkills(sessionId);
      setMcpServers(data.customServers || []);
    } catch { /* ignore */ }
  };

  const handleAddMcpServer = async () => {
    if (!newMcpName.trim() || !newMcpUrl.trim()) return;
    setError('');
    try {
      const headers: Record<string, string> = {};
      if (newMcpAuthType === 'bearer' && newMcpAuthValue.trim()) {
        headers['Authorization'] = `Bearer ${newMcpAuthValue.trim()}`;
      } else if (newMcpAuthType === 'custom' && newMcpCustomHeaderName.trim() && newMcpAuthValue.trim()) {
        headers[newMcpCustomHeaderName.trim()] = newMcpAuthValue.trim();
      }

      const { server } = await skillsApi.addMcpServer(sessionId, {
        name: newMcpName.trim(),
        transport: newMcpTransport,
        url: newMcpUrl.trim(),
        ...(Object.keys(headers).length > 0 && { headers }),
      });
      setMcpServers(prev => [...prev, server]);
      setNewMcpName('');
      setNewMcpUrl('');
      setNewMcpTransport('streamable-http');
      setNewMcpAuthType('none');
      setNewMcpAuthValue('');
      setNewMcpCustomHeaderName('');
    } catch (err: any) {
      setError(err.message || 'Failed to add MCP server');
    }
  };

  const handleRemoveMcpServer = async (serverId: string) => {
    try {
      await skillsApi.removeMcpServer(sessionId, serverId);
      setMcpServers(prev => prev.filter(s => s.id !== serverId));
      setMcpTestResults(prev => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
    } catch (err: any) {
      setError(err.message || 'Failed to remove MCP server');
    }
  };

  const handleTestMcpServer = async (serverId: string) => {
    setTestingMcpServer(serverId);
    try {
      const result = await skillsApi.testMcpServer(sessionId, serverId);
      setMcpTestResults(prev => ({ ...prev, [serverId]: result }));
    } catch (err: any) {
      setMcpTestResults(prev => ({ ...prev, [serverId]: { success: false, error: err.message } }));
    } finally {
      setTestingMcpServer(null);
    }
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
        // Reference file uploads happen inline — nothing to persist here
        break;
      case 'knowledge':
        // KB attachments happen inline — nothing to persist here
        break;
      case 'mcp':
        // MCP server additions happen inline — nothing to persist here
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
        // Save skills list to config before completing
        const saved = await saveConfig({ 
          setup_wizard_completed: true,
          portal_active_skills: uploadedSkills
        } as any);
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
    // Upload to the agent's skills bucket
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const skillsBucket = agentBuckets.find((b: any) => b.bucket_name?.includes(' - Skills') || b.bucket_name?.includes('_skills'));
      if (!skillsBucket) {
        setError('Skills bucket not found. Please try again.');
        return;
      }
      const bucketId = skillsBucket.bucket_id;

      for (const file of Array.from(fileList)) {
        try {
          const formData = new FormData();
          formData.append('files', file);
          formData.append('parentPath', '/');
          formData.append('relativePaths', JSON.stringify([file.name]));

          const res = await fetch(`/api/files/buckets/${bucketId}/upload`, {
            method: 'POST',
            credentials: 'include',
            body: formData,
          });

          if (res.ok) {
            const result = await res.json();
            // API returns uploaded files with id, name, and friendly_name
            if (result.files && result.files.length > 0) {
              const uploadedFile = result.files[0];
              setUploadedSkills(prev => [...prev, {
                id: uploadedFile.id,
                name: uploadedFile.name,
                friendlyName: uploadedFile.friendly_name || uploadedFile.name.replace(/\.(md|mdc|skill|txt|json)$/i, '').replace(/[-_]/g, ' ')
              }]);
            }
            // Show warning if friendly name generation failed
            if (result.friendlyNameErrors && result.friendlyNameErrors.length > 0) {
              const errorMessages = result.friendlyNameErrors.map((e: any) => `${e.filename}: ${e.error}`).join(', ');
              setError(`Warning: Failed to generate friendly names for some files: ${errorMessages}`);
            }
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

  const handleSkillFolderUpload = async (fileList: FileList) => {
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const skillsBucket = agentBuckets.find((b: any) => b.bucket_name?.includes(' - Skills') || b.bucket_name?.includes('_skills'));
      if (!skillsBucket) {
        setError('Skills bucket not found. Please try again.');
        return;
      }
      const bucketId = skillsBucket.bucket_id;

      // Group files by their top-level folder name
      const fileArray = Array.from(fileList);
      const folderName = fileArray[0]?.webkitRelativePath?.split('/')[0] || 'skill-folder';

      // Upload all files in one batch, preserving relative paths
      const formData = new FormData();
      const relativePaths: string[] = [];

      for (const file of fileArray) {
        formData.append('files', file);
        const relativePath = (file as any).webkitRelativePath || file.name;
        relativePaths.push(relativePath);
      }
      formData.append('parentPath', '/');
      formData.append('relativePaths', JSON.stringify(relativePaths));

      const res = await fetch(`/api/files/buckets/${bucketId}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        // Find the SKILL.md or instruction.md for the friendly name
        const skillMd = result.files?.find((f: any) =>
          /skill\.md$/i.test(f.name) || /instruction\.md$/i.test(f.name)
        );
        const friendlyName = skillMd?.friendly_name || folderName.replace(/[-_]/g, ' ');
        setUploadedSkills(prev => [...prev, {
          id: skillMd?.id || result.files?.[0]?.id || folderName,
          name: `${folderName}/`,
          friendlyName,
          isFolder: true,
        }]);
        // Show warning if friendly name generation failed
        if (result.friendlyNameErrors && result.friendlyNameErrors.length > 0) {
          const errorMessages = result.friendlyNameErrors.map((e: any) => `${e.filename}: ${e.error}`).join(', ');
          setError(`Warning: Failed to generate friendly names for some files in this folder: ${errorMessages}`);
        }
      }
    } catch (err) {
      console.error('Failed to upload skill folder:', err);
      setError('Failed to upload skill folder');
    }
  };

  const handleAttachKB = async (kbId: string) => {
    try {
      await fetch(`/api/knowledge/agents/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ knowledgeBaseId: kbId }),
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
      {/* Step indicator - Clean numbered circles */}
      <div className="mb-16">
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              {/* Step circle */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
                    currentStep === step.id
                      ? 'bg-blue-600 text-white ring-4 ring-blue-600/30 scale-110'
                      : index < currentStepIndex
                      ? 'bg-green-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                  }`}
                >
                  {index < currentStepIndex ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                {/* Step label - only show for current step */}
                {currentStep === step.id && (
                  <span className="text-sm font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap absolute mt-14">
                    {step.label}
                  </span>
                )}
              </div>
              {/* Connector line */}
              {index < STEPS.length - 1 && (
                <div className={`w-8 h-0.5 mx-1 transition-colors ${
                  index < currentStepIndex ? 'bg-green-600' : 'bg-slate-200 dark:bg-slate-700'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-6 max-h-[calc(100vh-24rem)] overflow-y-auto">

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
                Upload skill files or skill folders to give your agent specialized knowledge and behavior instructions.
                Supports individual files (.md, .skill) and Claude/Cursor/Codex skill folders containing SKILL.md.
              </p>
            </div>

            {/* Upload area - two options side by side */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => skillInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-blue-500 transition-colors"
              >
                <svg className="w-7 h-7 text-slate-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-slate-600 dark:text-slate-400">Upload Files</p>
                <p className="text-xs text-slate-400 mt-1">.md, .mdc, .skill, .txt, .json</p>
                <input
                  ref={skillInputRef}
                  type="file"
                  accept=".md,.mdc,.skill,.txt,.json"
                  multiple
                  onChange={(e) => e.target.files && handleSkillUpload(e.target.files)}
                  className="hidden"
                />
              </button>

              <button
                type="button"
                onClick={() => skillFolderInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-purple-500 transition-colors"
              >
                <svg className="w-7 h-7 text-slate-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-sm text-slate-600 dark:text-slate-400">Upload Folder</p>
                <p className="text-xs text-slate-400 mt-1">Skill folder with SKILL.md</p>
                <input
                  ref={skillFolderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory is a non-standard attribute
                  webkitdirectory=""
                  onChange={(e) => e.target.files && handleSkillFolderUpload(e.target.files)}
                  className="hidden"
                />
              </button>
            </div>

            {/* Uploaded */}
            {uploadedSkills.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Uploaded Skills</h4>
                <div className="space-y-2">
                  {uploadedSkills.map((skill) => (
                    <div key={skill.id} className="flex items-center gap-2 p-3 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                      <svg className="w-5 h-5 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {skill.isFolder ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        )}
                      </svg>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-900 dark:text-white">{skill.friendlyName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{skill.name}</div>
                      </div>
                      {skill.isFolder && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded">folder</span>
                      )}
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

        {/* ============ REFERENCE FILES (upload to input bucket) ============ */}
        {currentStep === 'files' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">Reference Files</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Upload files the agent can <span className="font-medium">read</span> as reference material (data, docs, spreadsheets, etc.).
                These are read-only — the agent has its own output bucket for writing.
              </p>
            </div>

            {/* Upload area */}
            <div
              onClick={() => referenceInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all"
            >
              <svg className="w-10 h-10 text-slate-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Click to upload reference files</p>
              <p className="text-xs text-slate-400 mt-1">CSV, Excel, PDF, Word, text files, etc.</p>
              <input
                ref={referenceInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleReferenceFileUpload(e.target.files)}
              />
            </div>

            {/* Uploaded files list */}
            {uploadedReferenceFiles.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Uploaded Reference Files</h4>
                <div className="space-y-2">
                  {uploadedReferenceFiles.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                      <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{file.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 rounded ml-auto flex-shrink-0">read-only</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400 dark:text-slate-500">
              You can skip this and upload reference files later. The agent will have read access to these files during conversations.
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

        {/* ============ MCP SERVERS ============ */}
        {currentStep === 'mcp' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">MCP Servers</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Connect external MCP (Model Context Protocol) servers to give your agent additional tools and capabilities.
              </p>
            </div>

            {/* Added servers list */}
            {mcpServers.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Connected Servers</h4>
                <div className="space-y-2">
                  {mcpServers.map((server) => (
                    <div key={server.id} className="p-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                          </svg>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{server.name}</div>
                            <div className="text-xs text-slate-400 font-mono truncate">{server.url}</div>
                          </div>
                          <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded flex-shrink-0">
                            {server.transport || 'streamable-http'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <button
                            onClick={() => handleTestMcpServer(server.id)}
                            disabled={testingMcpServer === server.id}
                            className="text-xs px-2.5 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50"
                          >
                            {testingMcpServer === server.id ? 'Testing...' : 'Test'}
                          </button>
                          <button
                            onClick={() => handleRemoveMcpServer(server.id)}
                            className="text-xs px-2.5 py-1 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      {/* Test results */}
                      {mcpTestResults[server.id] && (
                        <div className={`mt-2 text-xs p-2 rounded ${
                          mcpTestResults[server.id].success
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                        }`}>
                          {mcpTestResults[server.id].success
                            ? `Connected — ${mcpTestResults[server.id].tools?.length || 0} tools available`
                            : `Error: ${mcpTestResults[server.id].error || 'Connection failed'}`
                          }
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add server form */}
            <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-medium text-slate-900 dark:text-white">Add MCP Server</h4>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Server Name</label>
                <input
                  type="text"
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="My Custom Server"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Transport</label>
                <select
                  value={newMcpTransport}
                  onChange={(e) => setNewMcpTransport(e.target.value as 'sse' | 'streamable-http')}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                >
                  <option value="streamable-http">Streamable HTTP (recommended)</option>
                  <option value="sse">SSE (legacy)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Server URL</label>
                <input
                  type="text"
                  value={newMcpUrl}
                  onChange={(e) => setNewMcpUrl(e.target.value)}
                  placeholder="https://server.smithery.ai/@org/server"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">MCP server endpoint URL from Smithery, mcp.run, or your own server</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">Authentication</label>
                <div className="flex gap-3 mb-2">
                  {(['none', 'bearer', 'custom'] as const).map((type) => (
                    <label key={type} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                      <input
                        type="radio"
                        name="mcpAuth"
                        checked={newMcpAuthType === type}
                        onChange={() => { setNewMcpAuthType(type); setNewMcpAuthValue(''); setNewMcpCustomHeaderName(''); }}
                        className="text-blue-500"
                      />
                      {type === 'none' ? 'None' : type === 'bearer' ? 'Bearer Token' : 'Custom Header'}
                    </label>
                  ))}
                </div>
                {newMcpAuthType === 'bearer' && (
                  <input
                    type="password"
                    value={newMcpAuthValue}
                    onChange={(e) => setNewMcpAuthValue(e.target.value)}
                    placeholder="Bearer token"
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                  />
                )}
                {newMcpAuthType === 'custom' && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMcpCustomHeaderName}
                      onChange={(e) => setNewMcpCustomHeaderName(e.target.value)}
                      placeholder="Header name"
                      className="w-1/3 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                    />
                    <input
                      type="password"
                      value={newMcpAuthValue}
                      onChange={(e) => setNewMcpAuthValue(e.target.value)}
                      placeholder="Header value"
                      className="flex-1 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white text-sm"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleAddMcpServer}
                disabled={!newMcpName.trim() || !newMcpUrl.trim()}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:bg-slate-300 disabled:text-slate-500"
              >
                Add Server
              </button>
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500">
              You can skip this step and add MCP servers later from the Configure tab.
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
              <ReviewItem label="Reference Files" value={uploadedReferenceFiles.length > 0 ? `${uploadedReferenceFiles.length} uploaded` : 'None'} />
              <ReviewItem label="Knowledge Bases" value={attachedKBs.length > 0 ? `${attachedKBs.length} attached` : 'None'} />
              <ReviewItem label="MCP Servers" value={mcpServers.length > 0 ? `${mcpServers.length} connected` : 'None'} />
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
          {/* Skip only on optional steps: skills, files, knowledge, mcp */}
          {(currentStep === 'skills' || currentStep === 'files' || currentStep === 'knowledge' || currentStep === 'mcp') && (
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
