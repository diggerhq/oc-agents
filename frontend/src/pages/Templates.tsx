import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { agentTemplates, githubApp, type AgentTemplate, type WorkflowTemplate, type Repository } from '@/lib/api';

// Icons
const DataIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const CodeIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const ChatIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const ServerIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
  </svg>
);

const PenIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const WorkflowIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const LeadIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
  </svg>
);

const AlertIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

const agentTemplateIcons: Record<string, React.FC> = {
  'data-analyst': DataIcon,
  'code-reviewer': CodeIcon,
  'research-agent': SearchIcon,
  'ai-sdr': ChatIcon,
  'ai-sre': ServerIcon,
  'content-writer': PenIcon,
};

const agentTemplateColors: Record<string, string> = {
  'data-analyst': '#3b82f6',
  'code-reviewer': '#22c55e',
  'research-agent': '#8b5cf6',
  'ai-sdr': '#f59e0b',
  'ai-sre': '#ef4444',
  'content-writer': '#ec4899',
};

const workflowTemplateIcons: Record<string, React.FC> = {
  'content-pipeline': PenIcon,
  'lead-qualification': LeadIcon,
  'incident-response': AlertIcon,
};

const workflowTemplateColors: Record<string, string> = {
  'content-pipeline': '#ec4899',
  'lead-qualification': '#06b6d4',
  'incident-response': '#ef4444',
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-700">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white">{title}</h3>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-slate-900 dark:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Templates() {
  const navigate = useNavigate();
  const [agentTemplateList, setAgentTemplateList] = useState<AgentTemplate[]>([]);
  const [workflowTemplateList, setWorkflowTemplateList] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null);
  const [selectedWorkflowTemplate, setSelectedWorkflowTemplate] = useState<WorkflowTemplate | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await agentTemplates.list();
        setAgentTemplateList(res.agent_templates);
        setWorkflowTemplateList(res.workflow_templates);
      } catch (error) {
        console.error('Failed to load templates:', error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSelectTemplate = async (template: AgentTemplate) => {
    setSelectedTemplate(template);
    setAgentName(template.name);
    setShowCreateModal(true);
    
    // Load repos if code template (via GitHub App)
    if (template.agent_type === 'code') {
      setLoadingRepos(true);
      try {
        const { installations } = await githubApp.listInstallations();
        if (installations.length > 0) {
          // Load repos from all installations
          const allRepos: Repository[] = [];
          for (const inst of installations) {
            const { repos: instRepos } = await githubApp.listRepos(inst.installation_id);
            allRepos.push(...instRepos);
          }
          setRepos(allRepos);
        } else {
          setRepos([]);
        }
      } catch {
        setRepos([]);
      } finally {
        setLoadingRepos(false);
      }
    }
  };

  const handleSelectWorkflowTemplate = (template: WorkflowTemplate) => {
    setSelectedWorkflowTemplate(template);
    setWorkflowName(template.name);
    setShowWorkflowModal(true);
  };

  const handleCreate = async () => {
    if (!selectedTemplate) return;
    if (selectedTemplate.agent_type === 'code' && !selectedRepo) return;
    
    setCreating(true);
    try {
      const res = await agentTemplates.createFromTemplate(selectedTemplate.id, {
        name_override: agentName !== selectedTemplate.name ? agentName : undefined,
        repo_url: selectedRepo || undefined,
      });
      setShowCreateModal(false);
      navigate(`/agents/${res.agent.id}`);
    } catch (error) {
      console.error('Failed to create agent:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateWorkflow = async () => {
    if (!selectedWorkflowTemplate) return;
    
    setCreating(true);
    try {
      const res = await agentTemplates.createWorkflowFromTemplate(selectedWorkflowTemplate.id, {
        name_override: workflowName !== selectedWorkflowTemplate.name ? workflowName : undefined,
      });
      setShowWorkflowModal(false);
      navigate(`/workflows/${res.workflow.id}`);
    } catch (error) {
      console.error('Failed to create workflow:', error);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="text-gray-400">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Agent Templates Section */}
      <div className="mb-12">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Agent Templates</h1>
          <p className="text-gray-400">
            Pre-built agent configurations for common use cases. Click a template to create an agent.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agentTemplateList.map((template) => {
            const IconComponent = agentTemplateIcons[template.id] || DataIcon;
            const color = agentTemplateColors[template.id] || '#6b7280';
            
            return (
              <button
                key={template.id}
                onClick={() => handleSelectTemplate(template)}
                className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 hover:border-gray-600 transition-all text-left group"
              >
                <div 
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                  style={{ backgroundColor: `${color}20`, color }}
                >
                  <IconComponent />
                </div>
                
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{template.name}</h3>
                <p className="text-gray-400 text-sm mb-4 line-clamp-2">{template.description}</p>
                
                <div className="flex flex-wrap gap-2">
                  <span className={`text-xs px-2 py-1 rounded ${
                    template.agent_type === 'code' 
                      ? 'bg-green-900/50 text-green-400' 
                      : 'bg-blue-900/50 text-blue-400'
                  }`}>
                    {template.agent_type === 'code' ? 'Code Agent' : 'Task Agent'}
                  </span>
                </div>
                
                <div className="flex flex-wrap gap-1 mt-3">
                  {template.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-xs text-gray-500">
                      #{tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Workflow Templates Section */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Workflow Templates</h2>
          <p className="text-gray-400">
            Pre-built multi-agent workflows for complex automation. Click a template to create a workflow.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workflowTemplateList.map((template) => {
            const IconComponent = workflowTemplateIcons[template.id] || WorkflowIcon;
            const color = workflowTemplateColors[template.id] || '#06b6d4';
            
            return (
              <button
                key={template.id}
                onClick={() => handleSelectWorkflowTemplate(template)}
                className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 hover:border-cyan-600 transition-all text-left group"
              >
                <div 
                  className="w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                  style={{ backgroundColor: `${color}20`, color }}
                >
                  <IconComponent />
                </div>
                
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">{template.name}</h3>
                <p className="text-gray-400 text-sm mb-4 line-clamp-2">{template.description}</p>
                
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded bg-cyan-900/50 text-cyan-400">
                    Workflow
                  </span>
                </div>
                
                <div className="flex flex-wrap gap-1 mt-3">
                  {template.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-xs text-gray-500">
                      #{tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Create Agent Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={`Create ${selectedTemplate?.name || 'Agent'}`}
      >
        {selectedTemplate && (
          <div className="space-y-4">
            <div 
              className="p-4 rounded-lg"
              style={{ backgroundColor: `${agentTemplateColors[selectedTemplate.id] || '#6b7280'}15` }}
            >
              <p className="text-gray-300 text-sm">{selectedTemplate.description}</p>
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Agent Name</label>
              <input
                type="text"
                className="w-full bg-slate-100 dark:bg-slate-800 border border-gray-700 rounded px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
              />
            </div>
            
            {selectedTemplate.agent_type === 'code' && (
              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  GitHub Repository <span className="text-red-400">*</span>
                </label>
                {loadingRepos ? (
                  <div className="text-gray-500 text-sm">Loading repositories...</div>
                ) : repos.length === 0 ? (
                  <div className="text-gray-500 text-sm">
                    No repositories found. Install the GitHub App in Settings to access your repos.
                  </div>
                ) : (
                  <select
                    className="w-full bg-slate-100 dark:bg-slate-800 border border-gray-700 rounded px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                  >
                    <option value="">Select a repository...</option>
                    {repos.map((repo) => (
                      <option key={repo.id} value={repo.clone_url}>
                        {repo.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            
            {selectedTemplate.system_prompt && (
              <details className="text-sm">
                <summary className="text-gray-400 cursor-pointer hover:text-gray-300">
                  View System Prompt
                </summary>
                <pre className="mt-2 p-3 bg-slate-100 dark:bg-slate-800 rounded text-gray-300 text-xs whitespace-pre-wrap overflow-auto max-h-48">
                  {selectedTemplate.system_prompt}
                </pre>
              </details>
            )}
            
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-gray-400 hover:text-slate-900 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || (selectedTemplate.agent_type === 'code' && !selectedRepo)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-slate-900 dark:text-white rounded"
              >
                {creating ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Workflow Modal */}
      <Modal
        isOpen={showWorkflowModal}
        onClose={() => setShowWorkflowModal(false)}
        title={`Create ${selectedWorkflowTemplate?.name || 'Workflow'}`}
      >
        {selectedWorkflowTemplate && (
          <div className="space-y-4">
            <div 
              className="p-4 rounded-lg"
              style={{ backgroundColor: `${workflowTemplateColors[selectedWorkflowTemplate.id] || '#06b6d4'}15` }}
            >
              <p className="text-gray-300 text-sm">{selectedWorkflowTemplate.description}</p>
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Workflow Name</label>
              <input
                type="text"
                className="w-full bg-slate-100 dark:bg-slate-800 border border-gray-700 rounded px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
              />
            </div>
            
            <div className="p-3 bg-cyan-900/20 border border-cyan-800/50 rounded-lg">
              <p className="text-cyan-300 text-sm">
                This will create a workflow with pre-configured nodes and agents. You can customize it after creation.
              </p>
            </div>
            
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowWorkflowModal(false)}
                className="px-4 py-2 text-gray-400 hover:text-slate-900 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkflow}
                disabled={creating}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-700 disabled:text-gray-500 text-slate-900 dark:text-white rounded"
              >
                {creating ? 'Creating...' : 'Create Workflow'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
