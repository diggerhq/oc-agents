import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
  NodeTypes,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
  workflowOrchestration,
  agentConfig,
  sessions,
  files,
  type Workflow,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowRun,
  type WorkflowNodeRun,
  type WorkflowNodeType,
  type WorkflowBucket,
  type AgentListItem,
  type Session,
  type AgentConfigType,
  type Bucket,
} from '@/lib/api';
import { Modal as ConfirmModal } from '@/components/Modal';
import { ShareResourceModal } from '@/components/ShareResourceModal';

// ============================================
// SVG ICONS
// ============================================

const PlayIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path d="M6.3 2.841A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
  </svg>
);

const StopIcon = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <rect x="4" y="4" width="12" height="12" rx="1" />
  </svg>
);

const BotIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <circle cx="9" cy="14" r="1.5" fill="currentColor" />
    <circle cx="15" cy="14" r="1.5" fill="currentColor" />
    <path d="M12 2v4M8 6h8" />
  </svg>
);

const BranchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9" />
  </svg>
);

const UserIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
  </svg>
);

const SplitIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M12 5v6M5 17l7-6 7 6" />
  </svg>
);

const MergeIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M12 19v-6M5 7l7 6 7-6" />
  </svg>
);

const GearIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
  </svg>
);

const nodeColors: Record<WorkflowNodeType, string> = {
  start: '#22c55e',
  end: '#ef4444',
  agent: '#3b82f6',
  condition: '#f59e0b',
  human_checkpoint: '#8b5cf6',
  parallel_split: '#06b6d4',
  parallel_merge: '#06b6d4',
  transform: '#ec4899',
  delay: '#6b7280',
};

const nodeIconComponents: Record<WorkflowNodeType, React.FC> = {
  start: PlayIcon,
  end: StopIcon,
  agent: BotIcon,
  condition: BranchIcon,
  human_checkpoint: UserIcon,
  parallel_split: SplitIcon,
  parallel_merge: MergeIcon,
  transform: GearIcon,
  delay: ClockIcon,
};

interface CustomNodeData extends Record<string, unknown> {
  label: string;
  nodeType: WorkflowNodeType;
  description?: string;
  config?: Record<string, unknown>;
  status?: string;
}

function CustomNode({ data, selected }: { data: CustomNodeData; selected: boolean }) {
  const color = nodeColors[data.nodeType] || '#6b7280';
  const IconComponent = nodeIconComponents[data.nodeType] || GearIcon;
  
  const showInputHandle = data.nodeType !== 'start';
  const showOutputHandle = data.nodeType !== 'end';
  
  return (
    <div
      className={`relative px-4 py-3 rounded-lg border-2 min-w-[140px] transition-all ${
        selected ? 'shadow-lg scale-105' : 'shadow-md'
      }`}
      style={{
        backgroundColor: `${color}15`,
        borderColor: selected ? color : `${color}50`,
      }}
    >
      {showInputHandle && (
        <Handle
          type="target"
          position={Position.Top}
          className="!w-3 !h-3 !border-2"
          style={{ backgroundColor: color, borderColor: '#1f2937' }}
        />
      )}
      
      <div className="flex items-center gap-2">
        <div style={{ color }} className="flex-shrink-0">
          <IconComponent />
        </div>
        <div>
          <div className="font-medium text-slate-900 dark:text-white text-sm">{data.label}</div>
          {data.description && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{data.description}</div>
          )}
        </div>
      </div>
      
      {data.status && (
        <div
          className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
            data.status === 'completed' ? 'bg-green-500' :
            data.status === 'running' ? 'bg-yellow-500 animate-pulse' :
            data.status === 'failed' ? 'bg-red-500' :
            data.status === 'waiting_human' ? 'bg-purple-500 animate-pulse' :
            'bg-gray-500'
          }`}
        />
      )}
      
      {showOutputHandle && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !border-2"
          style={{ backgroundColor: color, borderColor: '#1f2937' }}
        />
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

// ============================================
// MODAL COMPONENT
// ============================================

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null;
  
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className={`bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg w-full ${sizeClasses[size]} mx-4 max-h-[90vh] overflow-y-auto`}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-slate-50 dark:bg-slate-900">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white">{title}</h3>
          <button 
            onClick={onClose} 
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

// ============================================
// ENHANCED NODE CONFIGURATION PANEL
// ============================================

interface NodeConfigPanelProps {
  node: WorkflowNode | null;
  agents: AgentListItem[];
  onUpdate: (nodeId: string, config: Record<string, unknown>) => void;
  onClose: () => void;
  onViewAgent: (agentId: string) => void;
}

function NodeConfigPanel({ node, agents, onUpdate, onClose, onViewAgent }: NodeConfigPanelProps) {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [agentDetails, setAgentDetails] = useState<{ session: Session; config: AgentConfigType } | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(false);
  
  useEffect(() => {
    if (node) {
      try {
        setConfig(JSON.parse(node.config || '{}'));
      } catch {
        setConfig({});
      }
    }
  }, [node]);
  
  // Load agent details when agent is selected
  useEffect(() => {
    const agentId = config.agent_id as string;
    if (node?.node_type === 'agent' && agentId) {
      setLoadingAgent(true);
      Promise.all([
        sessions.get(agentId),
        agentConfig.get(agentId),
      ]).then(([sessionRes, configRes]) => {
        setAgentDetails({
          session: sessionRes.session,
          config: configRes.config,
        });
      }).catch(err => {
        console.error('Failed to load agent details:', err);
        setAgentDetails(null);
      }).finally(() => {
        setLoadingAgent(false);
      });
    } else {
      setAgentDetails(null);
    }
  }, [config.agent_id, node?.node_type]);
  
  if (!node) return null;
  
  const handleSave = () => {
    onUpdate(node.id, config);
  };
  
  return (
    <div className="absolute right-4 top-4 bottom-4 w-96 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg flex flex-col overflow-hidden z-40 shadow-2xl">
      <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
        <h3 className="text-lg font-medium text-slate-900 dark:text-white">Configure Node</h3>
        <button onClick={onClose} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-xl">×</button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name</label>
          <div className="text-slate-900 dark:text-white font-medium">{node.name}</div>
        </div>
        
        <div>
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Type</label>
          <div className="flex items-center gap-2">
            <span style={{ color: nodeColors[node.node_type] }}>
              {nodeIconComponents[node.node_type] && React.createElement(nodeIconComponents[node.node_type])}
            </span>
            <span className="text-slate-900 dark:text-white capitalize">{node.node_type.replace(/_/g, ' ')}</span>
          </div>
        </div>
        
        {node.node_type === 'agent' && (
          <>
            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Agent</label>
              <select
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
                value={(config.agent_id as string) || ''}
                onChange={(e) => setConfig({ ...config, agent_id: e.target.value })}
              >
                <option value="">Select an agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.config_name || a.repo_name || a.id}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Agent Details Panel */}
            {loadingAgent && (
              <div className="text-sm text-slate-500 dark:text-slate-400">Loading agent details...</div>
            )}
            
            {agentDetails && !loadingAgent && (
              <div className="bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-3">
                <div className="flex justify-between items-start">
                  <h4 className="text-sm font-medium text-slate-900 dark:text-white">
                    {agentDetails.config.name || agentDetails.session.repo_name}
                  </h4>
                  <button
                    onClick={() => onViewAgent(agentDetails.session.id)}
                    className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1"
                  >
                    <ExternalLinkIcon /> View Agent
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Type:</span>
                    <span className="text-slate-900 dark:text-white ml-1 capitalize">{agentDetails.session.agent_type}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Provider:</span>
                    <span className="text-slate-900 dark:text-white ml-1">{agentDetails.session.agent_provider}</span>
                  </div>
                  {agentDetails.session.repo_name && (
                    <div className="col-span-2">
                      <span className="text-slate-500 dark:text-slate-400">Repo:</span>
                      <span className="text-slate-900 dark:text-white ml-1">{agentDetails.session.repo_name}</span>
                    </div>
                  )}
                </div>
                
                {agentDetails.config.system_prompt && (
                  <div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">System Prompt:</span>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-1 bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-24 overflow-y-auto">
                      {agentDetails.config.system_prompt.slice(0, 200)}
                      {agentDetails.config.system_prompt.length > 200 && '...'}
                    </div>
                  </div>
                )}
              </div>
            )}
            
            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Prompt Template</label>
              <textarea
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white h-24 font-mono text-sm"
                placeholder="Use {{variable}} for context values..."
                value={(config.prompt_template as string) || ''}
                onChange={(e) => setConfig({ ...config, prompt_template: e.target.value })}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Variables: {'{{input}}'}, {'{{previous_result}}'}, or any context key
              </p>
            </div>
          </>
        )}
        
        {node.node_type === 'condition' && (
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Expression</label>
            <input
              type="text"
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white font-mono"
              placeholder="e.g., result.success === true"
              value={(config.expression as string) || ''}
              onChange={(e) => setConfig({ ...config, expression: e.target.value })}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              JavaScript expression using context variables. Outputs: true → "true" edge, false → "false" edge
            </p>
          </div>
        )}
        
        {node.node_type === 'human_checkpoint' && (
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Message</label>
            <textarea
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white h-24"
              placeholder="Message to show when awaiting approval..."
              value={(config.message as string) || ''}
              onChange={(e) => setConfig({ ...config, message: e.target.value })}
            />
          </div>
        )}
        
        {node.node_type === 'transform' && (
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Transform Expression</label>
            <textarea
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white h-24 font-mono text-sm"
              placeholder="({ result: input.toUpperCase() })"
              value={(config.expression as string) || ''}
              onChange={(e) => setConfig({ ...config, expression: e.target.value })}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Return an object to merge into context
            </p>
          </div>
        )}
        
        {node.node_type === 'delay' && (
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Delay (seconds)</label>
            <input
              type="number"
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
              min="1"
              value={(config.seconds as number) || 1}
              onChange={(e) => setConfig({ ...config, seconds: Number.parseInt(e.target.value) })}
            />
          </div>
        )}
      </div>
        
      <div className="p-4 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 hover:bg-blue-700 text-slate-900 dark:text-white py-2 rounded font-medium"
        >
          Save Configuration
        </button>
      </div>
    </div>
  );
}

// ============================================
// WORKFLOW LIST
// ============================================

function WorkflowList({
  workflows,
  onSelect,
  onCreate,
  onDelete,
}: {
  workflows: Workflow[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const [modal, setModal] = useState<{
    isOpen: boolean;
    workflowId: string | null;
  }>({ isOpen: false, workflowId: null });

  // Share modal state
  const [shareModal, setShareModal] = useState<{
    isOpen: boolean;
    workflowId: string;
    workflowName: string;
  }>({ isOpen: false, workflowId: '', workflowName: '' });

  const openShareModal = (e: React.MouseEvent, workflow: Workflow) => {
    e.stopPropagation();
    setShareModal({
      isOpen: true,
      workflowId: workflow.id,
      workflowName: workflow.name,
    });
  };

  const closeShareModal = () => {
    setShareModal({ isOpen: false, workflowId: '', workflowName: '' });
  };

  const handleDelete = (e: React.MouseEvent, workflowId: string) => {
    e.stopPropagation();
    setModal({ isOpen: true, workflowId });
  };

  const confirmDelete = () => {
    if (modal.workflowId) {
      onDelete(modal.workflowId);
    }
    setModal({ isOpen: false, workflowId: null });
  };

  return (
    <>
      <ConfirmModal
        isOpen={modal.isOpen}
        onClose={() => setModal({ isOpen: false, workflowId: null })}
        title="Delete Workflow"
        message="Are you sure you want to delete this workflow? This will also delete all runs and nodes."
        type="danger"
        onConfirm={confirmDelete}
      />
      
      <ShareResourceModal
        isOpen={shareModal.isOpen}
        onClose={closeShareModal}
        resourceType="workflow"
        resourceId={shareModal.workflowId}
        resourceName={shareModal.workflowName}
      />
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-text">Workflows</h1>
        <button
          onClick={onCreate}
          className="bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <span>+</span> New Workflow
        </button>
      </div>
      
      {workflows.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-sidebar-hover flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </div>
          <h2 className="text-xl text-text mb-2">No workflows yet</h2>
          <p className="text-text-secondary mb-6">
            Create multi-agent workflows with visual orchestration
          </p>
          <button
            onClick={onCreate}
            className="bg-slate-800 dark:bg-blue-500 hover:bg-slate-900 dark:hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium"
          >
            Create Your First Workflow
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className="bg-white dark:bg-slate-800 border border-border rounded-lg p-4 hover:border-blue-500/50 hover:shadow-sm transition-all"
            >
              <div className="flex justify-between items-start">
                <button
                  onClick={() => onSelect(workflow.id)}
                  className="text-left flex-1"
                >
                  <h3 className="text-lg font-medium text-text">{workflow.name}</h3>
                  {workflow.description && (
                    <p className="text-text-secondary text-sm mt-1">{workflow.description}</p>
                  )}
                </button>
                <div className="flex items-center gap-3">
                <div className={`px-2 py-1 rounded text-xs ${
                  workflow.is_active ? 'bg-green-100 text-green-700' : 'bg-sidebar-hover text-text-secondary'
                }`}>
                  {workflow.is_active ? 'Active' : 'Inactive'}
                  </div>
                  <button
                    onClick={(e) => openShareModal(e, workflow)}
                    className="text-slate-500 dark:text-slate-400 hover:text-purple-400 text-sm"
                    title="Share settings"
                  >
                    Share
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, workflow.id)}
                    className="text-slate-500 dark:text-slate-400 hover:text-red-400 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
              
              <button
                onClick={() => onSelect(workflow.id)}
                className="flex gap-4 mt-3 text-sm text-slate-500 dark:text-slate-400 text-left"
              >
                <span>{workflow.node_count || 0} nodes</span>
                <span>{workflow.run_count || 0} runs</span>
                {workflow.last_run && (
                  <span>
                    Last run: {workflow.last_run.status}
                  </span>
                )}
            </button>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}

// ============================================
// RUNS TAB COMPONENT
// ============================================

// Live workflow status update type
interface LiveNodeUpdate {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting';
  output?: string;
  error?: string;
  timestamp: number;
}

function RunsTab({
  workflowId,
  runs,
  workflowNodes,
  onRefresh,
  onSelectRun,
  onRun,
}: {
  workflowId: string;
  runs: WorkflowRun[];
  workflowNodes: WorkflowNode[];
  onRefresh: () => void;
  onSelectRun: (run: WorkflowRun) => void;
  onRun: (inputData: Record<string, string>) => Promise<void>;
}) {
  const [selectedRunDetails, setSelectedRunDetails] = useState<{ run: WorkflowRun; nodeRuns: WorkflowNodeRun[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [liveUpdates, setLiveUpdates] = useState<LiveNodeUpdate[]>([]);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [currentRunStatus, setCurrentRunStatus] = useState<string | null>(null);
  const [showInputDialog, setShowInputDialog] = useState(false);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [isStarting, setIsStarting] = useState(false);
  const [runViewMode, setRunViewMode] = useState<'result' | 'details'>('result');

  // Extract variables from workflow nodes (e.g., {{topic}}, {{query}})
  const extractVariables = useCallback(() => {
    const variables = new Set<string>();
    for (const node of workflowNodes) {
      try {
        const config = JSON.parse(node.config || '{}');
        // Check prompt_template and other string fields
        const fieldsToCheck = [config.prompt_template, config.system_prompt, config.message];
        for (const field of fieldsToCheck) {
          if (typeof field === 'string') {
            const matches = field.match(/\{\{(\w+)\}\}/g);
            if (matches) {
              matches.forEach(m => {
                const varName = m.replace(/\{\{|\}\}/g, '');
                // Skip internal variables
                if (!varName.startsWith('_') && !['input', 'previous_result', 'last_agent_output'].includes(varName)) {
                  variables.add(varName);
                }
              });
            }
          }
        }
      } catch {}
    }
    return Array.from(variables);
  }, [workflowNodes]);

  const variables = extractVariables();

  const handleStartRun = async () => {
    setIsStarting(true);
    try {
      await onRun(inputValues);
      setShowInputDialog(false);
      setInputValues({});
    } finally {
      setIsStarting(false);
    }
  };

  const handleNewRun = () => {
    if (variables.length > 0) {
      // Initialize input values
      const initial: Record<string, string> = {};
      variables.forEach(v => initial[v] = '');
      setInputValues(initial);
      setShowInputDialog(true);
    } else {
      // No variables, run directly
      onRun({});
    }
  };
  
  // Load run details - defined before useEffect that uses it
  const loadRunDetails = useCallback(async (run: WorkflowRun) => {
    setLoading(true);
    try {
      const res = await workflowOrchestration.getRun(workflowId, run.id);
      setSelectedRunDetails({ run: res.run, nodeRuns: res.node_runs });
    } catch (err) {
      console.error('Failed to load run:', err);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);
  
  // WebSocket connection for live updates
  useEffect(() => {
    if (!selectedRunDetails) {
      setLiveUpdates([]);
      setIsLiveConnected(false);
      setCurrentRunStatus(null);
      return;
    }
    
    const run = selectedRunDetails.run;
    // Only connect for running/paused runs
    if (run.status !== 'running' && run.status !== 'paused') {
      return;
    }
    
    // In development, connect directly to backend (bypass Vite proxy issues)
    const isDev = window.location.port === '5173';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = isDev 
      ? `ws://localhost:3000/ws/workflow?runId=${run.id}`
      : `${wsProtocol}//${window.location.host}/ws/workflow?runId=${run.id}`;
    
    console.log('[WS] Connecting to workflow updates:', wsUrl);
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('[WS] Connected to workflow updates');
      setIsLiveConnected(true);
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[WS] Received:', data);
        
        if (data.type === 'workflow_node_status') {
          setLiveUpdates(prev => {
            // Update existing or add new
            const existing = prev.findIndex(u => u.nodeId === data.nodeId);
            const update: LiveNodeUpdate = {
              nodeId: data.nodeId,
              nodeName: data.nodeName,
              nodeType: data.nodeType,
              status: data.status,
              output: data.output,
              error: data.error,
              timestamp: data.timestamp,
            };
            
            if (existing >= 0) {
              const newUpdates = [...prev];
              newUpdates[existing] = update;
              return newUpdates;
            }
            return [...prev, update];
          });
        } else if (data.type === 'workflow_run_status') {
          setCurrentRunStatus(data.status);
          // Refresh run details when completed or failed
          if (data.status === 'completed' || data.status === 'failed') {
            setTimeout(() => {
              loadRunDetails(run);
              onRefresh();
            }, 500);
          }
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };
    
    ws.onclose = () => {
      console.log('[WS] Disconnected from workflow updates');
      setIsLiveConnected(false);
    };
    
    ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
    
    return () => {
      ws.close();
    };
  }, [selectedRunDetails?.run.id]);
  
  const toggleNodeExpanded = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };
  
  const expandAllNodes = () => {
    if (selectedRunDetails) {
      setExpandedNodes(new Set(selectedRunDetails.nodeRuns.map(nr => nr.id)));
    }
  };
  
  const collapseAllNodes = () => {
    setExpandedNodes(new Set());
  };
  
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'running': return 'bg-yellow-900/50 text-yellow-400';
      case 'paused': return 'bg-purple-900/50 text-purple-400';
      case 'failed': return 'bg-red-900/50 text-red-400';
      case 'cancelled': return 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
      default: return 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
    }
  };
  
  // Extract the final result from workflow output for display
  const extractFinalResult = useCallback((outputData: string | null): string | null => {
    if (!outputData) return null;
    try {
      const parsed = JSON.parse(outputData);
      // Look for common result fields
      if (parsed.generate_final_summary) return parsed.generate_final_summary;
      if (parsed.final_summary) return parsed.final_summary;
      if (parsed.result) return typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result, null, 2);
      if (parsed.last_agent_output) return parsed.last_agent_output;
      // Check for any key that ends with '_summary' or contains 'result'
      for (const key of Object.keys(parsed)) {
        if (key.toLowerCase().includes('summary') || key.toLowerCase().includes('result')) {
          const val = parsed[key];
          if (typeof val === 'string' && val.length > 100) return val;
        }
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // Find the last completed agent node's result
  const getLastAgentResult = useCallback((nodeRuns: WorkflowNodeRun[]): string | null => {
    // Find the last completed agent node (before the end node)
    const completedAgentRuns = nodeRuns
      .filter(nr => nr.status === 'completed' && nr.node_type === 'agent')
      .reverse();
    
    for (const nr of completedAgentRuns) {
      if (nr.output_data) {
        try {
          const parsed = JSON.parse(nr.output_data);
          if (parsed.result && typeof parsed.result === 'string') {
            return parsed.result;
          }
        } catch {
          // Continue to next
        }
      }
    }
    return null;
  }, []);

  // Preprocess content for better rendering - uses HTML tags for headers (more reliable)
  const cleanupMarkdown = useCallback((md: string): string => {
    // Normalize line endings and remove invisible characters
    const normalized = md
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, ''); // Remove zero-width chars
    
    const lines = normalized.split('\n');
    const output: string[] = [];
    let foundFirstContent = false;
    
    // Helper to escape HTML in content
    const escapeHtml = (str: string) => str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines at very beginning
      if (!foundFirstContent && !line) continue;
      
      // First non-empty line becomes H1 (the title) - use HTML tag with inline styles
      if (!foundFirstContent) {
        foundFirstContent = true;
        // Strip any existing markdown header prefix (# ## ###)
        const cleanTitle = line.replace(/^#{1,6}\s*/, '');
        output.push(`<h1 style="font-size: 1.5rem; font-weight: 700; color: white; border-bottom: 1px solid #374151; padding-bottom: 0.5rem; margin-bottom: 1rem;">${escapeHtml(cleanTitle)}</h1>`);
        output.push('');
        continue;
      }
      
      // Lines starting with "N. EMOJI" or "N. ALL CAPS" -> H2
      const isNumberedSection = /^\d+\.\s*[📁📊📈🔥💡⚡🎯📋🔧💰🌐📱🔍⚠️✅❌🚀📌💎🏆📝🔑🎉⭐🔒💼🤖📂🗂️📑🧠💭📣🔔🎓🏢🌍💻⏰📆🔗📉]/.test(line) ||
                               /^\d+\.\s+[A-Z][A-Z\s]{3,}$/.test(line);
      if (isNumberedSection) {
        output.push('');
        output.push(`<h2 style="font-size: 1.25rem; font-weight: 600; color: #c4b5fd; margin-top: 1.5rem; margin-bottom: 0.75rem;">${escapeHtml(line)}</h2>`);
        output.push('');
        continue;
      }
      
      // Handle "Period: X | Platforms: Y" metadata lines specially
      if (/^(Period|Date|Platforms|Source|Author|Version):/i.test(line)) {
        output.push('<p class="text-sm text-slate-500 dark:text-slate-400">');
        const parts = line.split('|').map(p => p.trim());
        const formatted = parts.map(part => {
          const colonIdx = part.indexOf(':');
          if (colonIdx > 0) {
            const label = part.slice(0, colonIdx).trim();
            const value = part.slice(colonIdx + 1).trim();
            return `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`;
          }
          return escapeHtml(part);
        });
        output.push(formatted.join(' | '));
        output.push('</p>');
        output.push('');
        continue;
      }
      
      // Lines with "Label:" at start -> bold the label
      const labelMatch = line.match(/^([A-Z][A-Za-z\s&]+):\s*(.*)$/);
      if (labelMatch && labelMatch[1].length < 30) {
        output.push(`**${labelMatch[1]}:** ${labelMatch[2]}`);
        continue;
      }
      
      // Empty line -> paragraph break
      if (!line) {
        output.push('');
        continue;
      }
      
      // Regular content line
      output.push(line);
    }
    
    // Join, remove leading blank lines, limit consecutive blanks
    let result = output.join('\n');
    result = result.replace(/^\n+/, '');
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
  }, []);
  
  if (selectedRunDetails) {
    const { run, nodeRuns } = selectedRunDetails;
    const effectiveStatus = currentRunStatus || run.status;
    
    // Get the final result for the Result tab
    const rawResult = extractFinalResult(run.output_data) || getLastAgentResult(nodeRuns);
    const finalResult = rawResult ? cleanupMarkdown(rawResult) : null;
    
  return (
      <div className="p-6 space-y-6">
        <button
          onClick={() => setSelectedRunDetails(null)}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-sm flex items-center gap-1"
        >
          ← Back to runs
        </button>
        
        {/* Header with status */}
        <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-mono text-sm text-slate-500 dark:text-slate-400">{run.id}</div>
              <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{formatDate(run.created_at)}</div>
            </div>
            <div className="flex items-center gap-2">
              {isLiveConnected && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  Live
                </span>
              )}
              <span className={`px-2 py-1 rounded text-xs ${getStatusColor(effectiveStatus)}`}>
                {effectiveStatus}
              </span>
            </div>
          </div>
          
          {/* Live Updates Section */}
          {liveUpdates.length > 0 && (effectiveStatus === 'running' || effectiveStatus === 'paused') && (
            <div className="mt-4 p-3 bg-blue-900/20 border border-blue-900/50 rounded-lg">
              <div className="text-xs text-blue-400 font-medium mb-2 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                Live Execution
              </div>
              <div className="space-y-2">
                {liveUpdates.map((update, i) => (
                  <div key={update.nodeId + '-' + i} className="flex items-center gap-3 text-sm">
                    <span className={`w-2 h-2 rounded-full ${
                      update.status === 'running' ? 'bg-yellow-400 animate-pulse' :
                      update.status === 'waiting' ? 'bg-blue-400 animate-pulse' :
                      update.status === 'completed' ? 'bg-green-400' :
                      update.status === 'failed' ? 'bg-red-400' :
                      'bg-gray-400'
                    }`}></span>
                    <span className="text-slate-900 dark:text-white font-medium">{update.nodeName}</span>
                    <span className="text-slate-500 dark:text-slate-400 text-xs">({update.nodeType})</span>
                    <span className={`text-xs ${
                      update.status === 'running' ? 'text-yellow-400' :
                      update.status === 'waiting' ? 'text-blue-400' :
                      update.status === 'completed' ? 'text-green-400' :
                      update.status === 'failed' ? 'text-red-400' :
                      'text-slate-500 dark:text-slate-400'
                    }`}>
                      {update.status === 'waiting' ? update.output || 'Waiting...' : update.status}
                    </span>
                    {update.error && (
                      <span className="text-xs text-red-400 truncate max-w-xs">
                        {update.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Tabs for Result / Details */}
        <div className="border-b border-slate-200 dark:border-slate-700">
          <div className="flex gap-4">
            <button
              onClick={() => setRunViewMode('result')}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                runViewMode === 'result'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              📄 Result
            </button>
            <button
              onClick={() => setRunViewMode('details')}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                runViewMode === 'details'
                  ? 'border-violet-500 text-violet-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              🔧 Technical Details
            </button>
          </div>
        </div>
        
        {/* Result Tab - Formatted Markdown */}
        {runViewMode === 'result' && (
          <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-700 rounded-lg">
            {effectiveStatus === 'running' && (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-500 dark:text-slate-400">Workflow is running...</p>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Results will appear here when complete</p>
              </div>
            )}
            
            {effectiveStatus === 'failed' && (
              <div className="p-8">
                <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-4 mb-4">
                  <h3 className="text-red-400 font-medium mb-2">❌ Workflow Failed</h3>
                  <pre className="text-red-300 text-sm whitespace-pre-wrap">{run.error || 'Unknown error'}</pre>
                </div>
              </div>
            )}
            
            {effectiveStatus === 'completed' && !finalResult && (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                <p>No formatted result available.</p>
                <p className="text-sm mt-1">Check the Technical Details tab for raw output.</p>
              </div>
            )}
            
            {effectiveStatus === 'completed' && finalResult && (
              <div className="p-6">
                {/* Copy button */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(finalResult);
                    }}
                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-gray-700 rounded transition-colors"
                  >
                    📋 Copy Markdown
                  </button>
                </div>
                
                {/* Markdown Content */}
                <div 
                  className="prose prose-invert prose-sm max-w-none
                    prose-headings:text-slate-900 dark:text-white prose-headings:font-semibold
                    prose-h1:text-2xl prose-h1:border-b prose-h1:border-slate-200 dark:border-slate-700 prose-h1:pb-2 prose-h1:mb-4
                    prose-h2:text-xl prose-h2:text-violet-300 prose-h2:mt-8 prose-h2:mb-4
                    prose-h3:text-lg prose-h3:text-slate-700 dark:text-slate-200 prose-h3:mt-6
                    prose-p:text-slate-600 dark:text-slate-300 prose-p:leading-relaxed
                    prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline
                    prose-strong:text-slate-900 dark:text-white
                    prose-ul:text-slate-600 dark:text-slate-300 prose-ol:text-slate-600 dark:text-slate-300
                    prose-li:my-1
                    prose-code:text-violet-300 prose-code:bg-slate-100 dark:bg-slate-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono
                    prose-pre:bg-slate-100 dark:bg-slate-800 prose-pre:border prose-pre:border-slate-200 dark:border-slate-700 prose-pre:font-mono
                    prose-blockquote:border-violet-500 prose-blockquote:text-slate-500 dark:text-slate-400
                    prose-hr:border-slate-200 dark:border-slate-700
                    prose-table:text-sm
                    prose-th:bg-slate-100 dark:bg-slate-800 prose-th:text-slate-700 dark:text-slate-200 prose-th:font-medium prose-th:px-3 prose-th:py-2
                    prose-td:border-slate-200 dark:border-slate-700 prose-td:px-3 prose-td:py-2
                    prose-tr:border-slate-200 dark:border-slate-700"
                  style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}
                >
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]} 
                    rehypePlugins={[rehypeRaw]}
                  >
                    {finalResult}
                  </ReactMarkdown>
                </div>
              </div>
            )}
            
            {effectiveStatus === 'paused' && (
              <div className="p-8 text-center">
                <div className="text-yellow-400 text-4xl mb-4">⏸️</div>
                <p className="text-slate-600 dark:text-slate-300">Workflow is paused</p>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Waiting for human approval</p>
                <Link 
                  to="/approvals" 
                  className="inline-block mt-4 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-slate-900 dark:text-white rounded-lg text-sm"
                >
                  Go to Approvals
                </Link>
              </div>
            )}
          </div>
        )}
        
        {/* Details Tab - Raw Technical View */}
        {runViewMode === 'details' && (
          <>
            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          {run.input_data && run.input_data !== '{}' && (
            <div className="mb-4">
              <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Input Data</label>
              <pre className="bg-slate-100 dark:bg-slate-800 rounded p-2 text-xs text-slate-900 dark:text-white overflow-x-auto">
                {JSON.stringify(JSON.parse(run.input_data), null, 2)}
              </pre>
            </div>
          )}
          
          {run.output_data && (
            <div className="mb-4">
              <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Output Data</label>
                  <pre className="bg-green-900/20 border border-green-900/50 rounded p-2 text-xs text-green-300 overflow-x-auto max-h-96">
                {JSON.stringify(JSON.parse(run.output_data), null, 2)}
              </pre>
            </div>
          )}
          
          {run.error && (
            <div className="mb-4">
              <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">Error</label>
              <pre className="bg-red-900/20 border border-red-900/50 rounded p-2 text-xs text-red-300 overflow-x-auto">
                {run.error}
              </pre>
            </div>
          )}
        </div>
        
        <div>
      <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-slate-900 dark:text-white">Node Execution History</h3>
            {nodeRuns.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={expandAllNodes}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                >
                  Expand All
                </button>
                <span className="text-gray-600">|</span>
                <button
                  onClick={collapseAllNodes}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {nodeRuns.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400 text-sm">No node runs recorded</p>
            ) : (
              nodeRuns.map((nr: any, i) => {
                const isExpanded = expandedNodes.has(nr.id);
                const hasOutput = nr.output_data && nr.output_data !== '{}';
                const hasError = !!nr.error;
                
                // Parse output for display
                let outputContent = '';
                let outputPreview = '';
                if (hasOutput) {
                  try {
                    const parsed = JSON.parse(nr.output_data);
                    outputContent = JSON.stringify(parsed, null, 2);
                    // Create a preview - try to get the result field if it exists
                    if (parsed.result) {
                      outputPreview = typeof parsed.result === 'string' 
                        ? parsed.result.slice(0, 150) 
                        : JSON.stringify(parsed.result).slice(0, 150);
                    } else {
                      outputPreview = outputContent.slice(0, 150);
                    }
                  } catch {
                    outputContent = nr.output_data;
                    outputPreview = nr.output_data.slice(0, 150);
                  }
                }
                
                return (
                  <div 
                    key={nr.id} 
                    className={`bg-slate-50 dark:bg-slate-900/50 border rounded-lg ${
                      nr.status === 'failed' ? 'border-red-900/50' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {/* Header - always visible */}
                    <button
                      onClick={() => toggleNodeExpanded(nr.id)}
                      className="w-full p-4 text-left hover:bg-slate-100 dark:bg-slate-800/30 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500 dark:text-slate-400 transition-transform" style={{ 
                              display: 'inline-block',
                              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                            }}>
                              ▶
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">#{i + 1}</span>
                            <span className="text-slate-900 dark:text-white font-medium">
                              {nr.node_name || nr.node_id.slice(0, 8)}
                            </span>
                            {nr.node_type && (
                              <span className="text-xs text-slate-500 dark:text-slate-400 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">
                                {nr.node_type}
                              </span>
                            )}
                          </div>
                          {nr.started_at && (
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 ml-5">
                              {formatDate(nr.started_at)}
                              {nr.completed_at && ` → ${formatDate(nr.completed_at)}`}
                              {nr.started_at && nr.completed_at && (
                                <span className="ml-2 text-gray-600">
                                  ({Math.round((new Date(nr.completed_at).getTime() - new Date(nr.started_at).getTime()) / 1000)}s)
                                </span>
                              )}
                            </div>
                          )}
                          {/* Preview when collapsed */}
                          {!isExpanded && !hasError && outputPreview && (
                            <div className="mt-2 ml-5 text-xs text-slate-500 dark:text-slate-400 truncate max-w-2xl">
                              {outputPreview}...
                            </div>
                          )}
                          {!isExpanded && hasError && (
                            <div className="mt-2 ml-5 text-xs text-red-400 truncate max-w-2xl">
                              Error: {nr.error.slice(0, 100)}...
                            </div>
                          )}
                        </div>
                        <span className={`px-2 py-0.5 rounded text-xs flex-shrink-0 ${getStatusColor(nr.status)}`}>
                          {nr.status}
                        </span>
                      </div>
                    </button>
                    
                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-700">
                        {hasError && (
                          <div className="mt-3">
                            <div className="text-xs text-red-400 font-medium mb-1">Error:</div>
                            <pre className="bg-red-900/20 border border-red-900/50 rounded p-3 text-xs text-red-300 overflow-x-auto whitespace-pre-wrap">
                              {nr.error}
                            </pre>
                          </div>
                        )}
                        
                        {hasOutput && (
                          <div className="mt-3">
                            <div className="flex justify-between items-center mb-1">
                              <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">Output:</div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(outputContent);
                                }}
                                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                              >
                                Copy
                              </button>
                            </div>
                            <pre className="bg-slate-100 dark:bg-slate-800 rounded p-3 text-xs text-slate-600 dark:text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap">
                              {outputContent}
                            </pre>
                          </div>
                        )}
                        
                        {nr.input_data && nr.input_data !== '{}' && (
                          <div className="mt-3">
                            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">Input Context:</div>
                            <pre className="bg-slate-100 dark:bg-slate-800/50 rounded p-3 text-xs text-slate-500 dark:text-slate-400 overflow-auto max-h-48 whitespace-pre-wrap">
                              {(() => {
                                try {
                                  return JSON.stringify(JSON.parse(nr.input_data), null, 2);
                                } catch {
                                  return nr.input_data;
                                }
                              })()}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
          </>
        )}
      </div>
    );
  }
  
  return (
    <div className="p-6">
      {/* Input Dialog */}
      {showInputDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg w-full max-w-md mx-4">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-medium text-slate-900 dark:text-white">Start New Run</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Provide input values for this workflow
              </p>
            </div>
            <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
              {variables.map((variable) => (
                <div key={variable}>
                  <label className="block text-sm font-medium text-slate-900 dark:text-white mb-1 capitalize">
                    {variable.replace(/_/g, ' ')}
                  </label>
                  <input
                    type="text"
                    value={inputValues[variable] || ''}
                    onChange={(e) => setInputValues({ ...inputValues, [variable]: e.target.value })}
                    placeholder={`Enter ${variable}...`}
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              ))}
              {variables.length === 0 && (
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  This workflow has no input variables. Click Start to run it.
                </p>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => setShowInputDialog(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white hover:border-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleStartRun}
                disabled={isStarting || (variables.length > 0 && variables.some(v => !inputValues[v]?.trim()))}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-slate-900 dark:text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {isStarting ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Starting...
                  </>
                ) : (
                  <>
                    <PlayIcon />
                    Start Run
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Run History</h2>
        <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-sm"
        >
          Refresh
        </button>
          <button
            onClick={handleNewRun}
            className="bg-green-600 hover:bg-green-700 text-slate-900 dark:text-white px-4 py-1.5 rounded text-sm flex items-center gap-2"
          >
            <PlayIcon /> New Run
          </button>
        </div>
      </div>
      
      {runs.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-sidebar-hover flex items-center justify-center">
            <PlayIcon />
          </div>
          <p className="text-slate-900 dark:text-white text-lg mb-2">No runs yet</p>
          <p className="text-slate-500 dark:text-slate-400 mb-4">Start your first run to see results here</p>
          <button
            onClick={handleNewRun}
            className="bg-green-600 hover:bg-green-700 text-slate-900 dark:text-white px-6 py-2 rounded-lg inline-flex items-center gap-2"
          >
            <PlayIcon /> Start First Run
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            // Parse input data to show what was passed
            let inputSummary = '';
            try {
              const input = JSON.parse(run.input_data || '{}');
              const keys = Object.keys(input).filter(k => !k.startsWith('_'));
              if (keys.length > 0) {
                inputSummary = keys.map(k => `${k}: ${String(input[k]).slice(0, 30)}${String(input[k]).length > 30 ? '...' : ''}`).join(', ');
              }
            } catch {}

            return (
            <button
              key={run.id}
              onClick={() => {
                loadRunDetails(run);
                onSelectRun(run);
              }}
              disabled={loading}
              className="w-full bg-white dark:bg-slate-800 border border-border rounded-lg p-4 hover:border-blue-500/50 hover:shadow-sm transition-all text-left"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-mono text-sm text-slate-900 dark:text-white">{run.id.slice(0, 12)}...</div>
                    {inputSummary && (
                      <div className="text-sm text-blue-400 mt-1 truncate max-w-xs">{inputSummary}</div>
                    )}
                  <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{formatDate(run.created_at)}</div>
                </div>
                <span className={`px-2 py-1 rounded text-xs ${getStatusColor(run.status)}`}>
                  {run.status}
                </span>
              </div>
              
              {run.started_at && run.completed_at && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Duration: {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
              </div>
              )}
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// SETTINGS TAB COMPONENT
// ============================================

function SettingsTab({
  workflow,
  onUpdate,
  onDelete,
}: {
  workflow: Workflow;
  onUpdate: (data: Partial<Workflow>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description || '');
  const [maxRetries, setMaxRetries] = useState(workflow.max_retries);
  const [timeoutSeconds, setTimeoutSeconds] = useState(workflow.timeout_seconds);
  const [isActive, setIsActive] = useState(workflow.is_active === 1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  // Bucket state
  const [workflowBuckets, setWorkflowBuckets] = useState<WorkflowBucket[]>([]);
  const [userBuckets, setUserBuckets] = useState<Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [loadingBuckets, setLoadingBuckets] = useState(false);
  
  // Load buckets on mount
  useEffect(() => {
    const loadBuckets = async () => {
      setLoadingBuckets(true);
      try {
        console.log('[Workflows] Loading buckets for workflow:', workflow.id);
        const [workflowRes, userRes] = await Promise.all([
          workflowOrchestration.listBuckets(workflow.id),
          files.listBuckets(),
        ]);
        console.log('[Workflows] workflowRes:', workflowRes);
        console.log('[Workflows] userRes:', userRes);
        console.log('[Workflows] userRes.buckets:', userRes.buckets);
        console.log('[Workflows] userRes.buckets.length:', userRes.buckets?.length);
        setWorkflowBuckets(workflowRes.buckets);
        setUserBuckets(userRes.buckets);
      } catch (err) {
        console.error('[Workflows] Failed to load buckets:', err);
      } finally {
        setLoadingBuckets(false);
      }
    };
    loadBuckets();
  }, [workflow.id]);
  
  const handleAttachBucket = async () => {
    if (!selectedBucket) return;
    try {
      const result = await workflowOrchestration.attachBucket(workflow.id, {
        bucket_id: selectedBucket,
      });
      const bucket = userBuckets.find(b => b.id === selectedBucket);
      setWorkflowBuckets([...workflowBuckets, { ...result, bucket_name: bucket?.name || 'Unknown' }]);
      setSelectedBucket('');
      setMessage('Bucket attached!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('Failed to attach bucket');
    }
  };
  
  const handleDetachBucket = async (bucketId: string) => {
    try {
      await workflowOrchestration.detachBucket(workflow.id, bucketId);
      setWorkflowBuckets(workflowBuckets.filter(b => b.bucket_id !== bucketId));
      setMessage('Bucket detached!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('Failed to detach bucket');
    }
  };
  
  // Filter out already attached buckets
  const availableBuckets = userBuckets.filter(
    ub => !workflowBuckets.some(wb => wb.bucket_id === ub.id)
  );
  
  const handleDelete = () => {
    setShowDeleteModal(true);
  };
  
  const confirmDelete = () => {
    setShowDeleteModal(false);
      onDelete();
  };
  
  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        name,
        description: description || null,
        max_retries: maxRetries,
        timeout_seconds: timeoutSeconds,
        is_active: isActive ? 1 : 0,
      });
      setMessage('Settings saved!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage('Failed to save');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">Workflow Settings</h2>
      
      {message && (
        <div className={`mb-4 px-4 py-2 rounded text-sm ${
          message.includes('Failed') 
            ? 'bg-red-500/10 border border-red-500/50 text-red-400'
            : 'bg-green-500/10 border border-green-500/50 text-green-400'
        }`}>
          {message}
        </div>
      )}
      
      <div className="space-y-6">
        <div>
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Workflow Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
          />
        </div>
        
        <div>
          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
            placeholder="Optional description..."
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Max Retries</label>
            <input
              type="number"
              min="0"
              max="10"
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
            />
          </div>
          
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Timeout (seconds)</label>
            <input
              type="number"
              min="60"
              value={timeoutSeconds}
              onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
            />
          </div>
        </div>
        
        <div className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg">
          <div>
            <div className="text-slate-900 dark:text-white font-medium">Active Status</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Enable or disable this workflow</div>
          </div>
          <button
            onClick={() => setIsActive(!isActive)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              isActive ? 'bg-green-500' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                isActive ? 'left-7' : 'left-1'
              }`}
            />
          </button>
        </div>
        
        {/* File Buckets Section */}
        <div className="pt-6 border-t border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            📁 File Buckets
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              (Files available to all agents in this workflow)
            </span>
          </h3>
          
          {loadingBuckets ? (
            <div className="text-slate-500 dark:text-slate-400 text-sm">Loading buckets...</div>
          ) : (
            <>
              {/* Attached Buckets */}
              {workflowBuckets.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {workflowBuckets.map((wb) => (
                    <div
                      key={wb.id}
                      className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">📁</span>
                        <div>
                          <div className="text-slate-900 dark:text-white font-medium">{wb.bucket_name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            Mount: {wb.mount_path}
                            {wb.read_only ? ' (read-only)' : ''}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDetachBucket(wb.bucket_id)}
                        className="text-red-400 hover:text-red-300 text-sm px-3 py-1"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-slate-500 dark:text-slate-400 text-sm mb-4 p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                  No file buckets attached. Agents in this workflow won't have access to your files.
                </div>
              )}
              
              {/* Add Bucket */}
              {availableBuckets.length > 0 ? (
                <div className="flex gap-2">
                  <select
                    value={selectedBucket}
                    onChange={(e) => setSelectedBucket(e.target.value)}
                    className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="">Select a bucket to attach...</option>
                    {availableBuckets.map((bucket) => (
                      <option key={bucket.id} value={bucket.id}>
                        {bucket.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleAttachBucket}
                    disabled={!selectedBucket}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-slate-900 dark:text-white rounded"
                  >
                    Attach
                  </button>
                </div>
              ) : userBuckets.length === 0 ? (
                <Link
                  to="/files"
                  className="inline-block text-violet-400 hover:text-violet-300 text-sm"
                >
                  → Create your first bucket in Files
                </Link>
              ) : (
                <div className="text-slate-500 dark:text-slate-400 text-sm">
                  All your buckets are already attached.
                </div>
              )}
            </>
          )}
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-slate-900 dark:text-white rounded font-medium"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        
        {/* Danger Zone */}
        <div className="mt-12 pt-6 border-t border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-medium text-red-400 mb-4">Danger Zone</h3>
          <div className="p-4 bg-red-900/20 border border-red-900/50 rounded-lg">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-slate-900 dark:text-white font-medium">Delete Workflow</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  Permanently delete this workflow and all its runs, nodes, and edges.
                </div>
              </div>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-slate-900 dark:text-white rounded font-medium"
              >
                Delete Workflow
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Workflow"
        message="Are you sure you want to delete this workflow? This will delete all nodes, edges, and run history. This action cannot be undone."
        type="danger"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ============================================
// API TAB COMPONENT
// ============================================

function ApiTab({ workflow, workflowNodes }: { workflow: Workflow; workflowNodes: WorkflowNode[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  
  // Extract variables from workflow nodes
  const extractVariables = useCallback(() => {
    const variables = new Set<string>();
    for (const node of workflowNodes) {
      try {
        const config = JSON.parse(node.config || '{}');
        const fieldsToCheck = [config.prompt_template, config.system_prompt, config.message];
        for (const field of fieldsToCheck) {
          if (typeof field === 'string') {
            const matches = field.match(/\{\{(\w+)\}\}/g);
            if (matches) {
              matches.forEach(m => {
                const varName = m.replace(/\{\{|\}\}/g, '');
                if (!varName.startsWith('_') && !['input', 'previous_result', 'last_agent_output'].includes(varName)) {
                  variables.add(varName);
                }
              });
            }
          }
        }
      } catch {}
    }
    return Array.from(variables);
  }, [workflowNodes]);

  const variables = extractVariables();
  
  const baseUrl = window.location.origin;
  const triggerEndpoint = `${baseUrl}/api/v1/workflows/${workflow.id}/trigger`;
  const statusEndpoint = `${baseUrl}/api/v1/workflows/${workflow.id}/runs/{RUN_ID}`;
  
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };
  
  // Generate example input_data based on variables
  const exampleInputData = variables.length > 0
    ? JSON.stringify(Object.fromEntries(variables.map(v => [v, `your ${v} value`])), null, 2)
    : '{}';
  
  const triggerCurl = `curl -X POST "${triggerEndpoint}" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input_data": ${exampleInputData.replace(/\n/g, '\n  ')}}'`;
  
  const statusCurl = `curl "${statusEndpoint}" \\
  -H "Authorization: Bearer YOUR_API_KEY"`;
  
  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-6">API Access</h2>
      
      <div className="space-y-6">
        {/* Input Variables Section */}
        <div className="bg-purple-900/20 border border-purple-700/30 rounded-lg p-4">
          <div className="text-purple-400 font-medium mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
            Required Inputs
          </div>
          {variables.length > 0 ? (
            <>
              <p className="text-sm text-purple-300 mb-3">
                This workflow requires the following input variables:
              </p>
              <div className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                  <span
                    key={variable}
                    className="px-3 py-1.5 bg-purple-800/30 border border-purple-600/30 rounded-lg text-sm font-mono text-purple-200"
                  >
                    {`{{${variable}}}`}
                  </span>
                ))}
              </div>
              <div className="mt-4 p-3 bg-slate-100 dark:bg-slate-800/50 rounded-lg">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">Example input_data:</div>
                <pre className="text-xs font-mono text-purple-300">
                  {exampleInputData}
                </pre>
              </div>
            </>
          ) : (
            <p className="text-sm text-purple-300">
              This workflow has no required input variables. You can pass an empty object or omit input_data entirely.
            </p>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-slate-900 dark:text-white font-medium">Workflow ID</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Use this to reference the workflow</div>
            </div>
            <button
              onClick={() => copyToClipboard(workflow.id, 'id')}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              {copied === 'id' ? '✓ Copied!' : <CopyIcon />}
            </button>
          </div>
          <code className="block bg-slate-100 dark:bg-slate-800 rounded px-3 py-2 text-sm font-mono text-green-400">
            {workflow.id}
          </code>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="text-slate-900 dark:text-white font-medium">Trigger Endpoint</div>
              <div className="text-sm text-slate-500 dark:text-slate-400">POST to this URL to start a workflow run</div>
            </div>
            <button
              onClick={() => copyToClipboard(triggerEndpoint, 'trigger')}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              {copied === 'trigger' ? '✓ Copied!' : <CopyIcon />}
            </button>
          </div>
          <code className="block bg-slate-100 dark:bg-slate-800 rounded px-3 py-2 text-sm font-mono text-blue-400 break-all">
            {triggerEndpoint}
          </code>
        </div>
        
        <div>
          <div className="flex justify-between items-center mb-2">
            <div className="text-slate-900 dark:text-white font-medium">Trigger Workflow</div>
            <button
              onClick={() => copyToClipboard(triggerCurl, 'trigger-curl')}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              {copied === 'trigger-curl' ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="bg-slate-100 dark:bg-slate-800 rounded p-3 text-xs font-mono text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {triggerCurl}
          </pre>
        </div>
        
        <div>
          <div className="flex justify-between items-center mb-2">
            <div className="text-slate-900 dark:text-white font-medium">Check Run Status</div>
            <button
              onClick={() => copyToClipboard(statusCurl, 'status-curl')}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              {copied === 'status-curl' ? '✓ Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="bg-slate-100 dark:bg-slate-800 rounded p-3 text-xs font-mono text-slate-600 dark:text-slate-300 overflow-x-auto">
            {statusCurl}
          </pre>
        </div>
        
        <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
          <div className="text-blue-400 font-medium mb-2">💡 Need an API Key?</div>
          <p className="text-sm text-blue-300">
            Go to <a href="/settings" className="underline hover:text-blue-200">Settings → API Keys</a> to create one.
          </p>
        </div>
        
        <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="text-slate-900 dark:text-white font-medium mb-2">Response Format</div>
          <pre className="bg-slate-100 dark:bg-slate-800 rounded p-3 text-xs font-mono text-slate-600 dark:text-slate-300 overflow-x-auto">
{`{
  "run": {
    "id": "run-uuid",
    "workflow_id": "${workflow.id}",
    "status": "running",
    "input_data": ${exampleInputData.replace(/\n/g, '\n    ')},
    "created_at": "2024-01-15T10:30:00Z"
  }
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ============================================
// MAIN WORKFLOWS PAGE
// ============================================

export function Workflows() {
  const navigate = useNavigate();
  const { workflowId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = searchParams.get('run');
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'graph' | 'runs' | 'settings' | 'api'>('graph');
  
  // State
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [currentWorkflow, setCurrentWorkflow] = useState<Workflow | null>(null);
  const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([]);
  const [workflowEdges, setWorkflowEdges] = useState<WorkflowEdge[]>([]);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRun | null>(null);
  const [_nodeRuns, _setNodeRuns] = useState<WorkflowNodeRun[]>([]); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showNewNodeMenu, setShowNewNodeMenu] = useState(false);
  
  // Modal state
  const [showCreateWorkflowModal, setShowCreateWorkflowModal] = useState(false);
  const [showCreateNodeModal, setShowCreateNodeModal] = useState(false);
  const [showDeleteNodeModal, setShowDeleteNodeModal] = useState(false);
  const [showRunInputModal, setShowRunInputModal] = useState(false);
  const [runInputValues, setRunInputValues] = useState<Record<string, string>>({});
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeType, setNewNodeType] = useState<WorkflowNodeType | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CustomNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  
  // Convert backend nodes/edges to React Flow format
  const convertToFlowNodes = useCallback((wfNodes: WorkflowNode[], nodeRunsMap: Map<string, WorkflowNodeRun>): Node<CustomNodeData>[] => {
    return wfNodes.map((node) => {
      const nodeRun = nodeRunsMap.get(node.id);
      let parsedConfig: Record<string, unknown> = {};
      try {
        parsedConfig = typeof node.config === 'string' ? JSON.parse(node.config) : (node.config || {});
      } catch {
        parsedConfig = {};
      }
      return {
        id: node.id,
        type: 'custom',
        position: { x: node.position_x, y: node.position_y },
        data: {
          label: node.name,
          nodeType: node.node_type,
          description: node.description,
          config: parsedConfig,
          status: nodeRun?.status,
        } as CustomNodeData,
      };
    });
  }, []);
  
  const convertToFlowEdges = useCallback((wfEdges: WorkflowEdge[]): Edge[] => {
    return wfEdges.map((edge) => ({
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      label: edge.condition_label,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: '#6b7280' },
      labelStyle: { fill: '#9ca3af', fontSize: 10 },
    }));
  }, []);
  
  // Load workflows list
  useEffect(() => {
    async function load() {
      try {
        const [wfRes, agentsRes] = await Promise.all([
          workflowOrchestration.list(),
          agentConfig.listAgents(),
        ]);
        setWorkflows(wfRes.workflows);
        setAgents(agentsRes.agents);
      } catch (error) {
        console.error('Failed to load workflows:', error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);
  
  // Load specific workflow
  useEffect(() => {
    if (!workflowId) {
      setCurrentWorkflow(null);
      setWorkflowNodes([]);
      setWorkflowEdges([]);
      return;
    }
    
    async function loadWorkflow() {
      if (!workflowId) return;
      try {
        const [wfRes, runsRes] = await Promise.all([
          workflowOrchestration.get(workflowId),
          workflowOrchestration.listRuns(workflowId),
        ]);
        setCurrentWorkflow(wfRes.workflow);
        setWorkflowNodes(wfRes.nodes);
        setWorkflowEdges(wfRes.edges);
        setRuns(runsRes.runs);
        
        // Convert to React Flow format
        const nodeRunsMap = new Map<string, WorkflowNodeRun>();
        setNodes(convertToFlowNodes(wfRes.nodes, nodeRunsMap));
        setEdges(convertToFlowEdges(wfRes.edges));
      } catch (error) {
        console.error('Failed to load workflow:', error);
      }
    }
    loadWorkflow();
  }, [workflowId, convertToFlowNodes, convertToFlowEdges, setNodes, setEdges]);
  
  // Load specific run
  useEffect(() => {
    if (!workflowId || !runId) {
      setSelectedRun(null);
      return;
    }
    
    async function loadRun() {
      if (!workflowId || !runId) return;
      try {
        const res = await workflowOrchestration.getRun(workflowId, runId);
        setSelectedRun(res.run);
        
        // Update nodes with run status
        const nodeRunsMap = new Map(res.node_runs.map(nr => [nr.node_id, nr]));
        setNodes(convertToFlowNodes(workflowNodes, nodeRunsMap));
      } catch (error) {
        console.error('Failed to load run:', error);
      }
    }
    loadRun();
    
    // Poll for updates if running
    const interval = setInterval(loadRun, 2000);
    return () => clearInterval(interval);
  }, [workflowId, runId, workflowNodes, convertToFlowNodes, setNodes]);
  
  // Handlers
  const handleCreateWorkflow = async () => {
    if (!newWorkflowName.trim()) return;
    
    try {
      const res = await workflowOrchestration.create({ name: newWorkflowName });
      setWorkflows([res.workflow, ...workflows]);
      setShowCreateWorkflowModal(false);
      setNewWorkflowName('');
      navigate(`/workflows/${res.workflow.id}`);
    } catch (error) {
      console.error('Failed to create workflow:', error);
    }
  };
  
  const handleDeleteWorkflow = async (id: string) => {
    try {
      await workflowOrchestration.delete(id);
      setWorkflows(workflows.filter(w => w.id !== id));
      // If we're viewing the deleted workflow, go back to list
      if (workflowId === id) {
        navigate('/workflows');
      }
    } catch (error) {
      console.error('Failed to delete workflow:', error);
    }
  };
  
  const handleConnect = useCallback(
    async (connection: Connection) => {
      if (!workflowId || !connection.source || !connection.target) return;
      
      try {
        const res = await workflowOrchestration.addEdge(workflowId, {
          source_node_id: connection.source,
          target_node_id: connection.target,
        });
        setWorkflowEdges([...workflowEdges, res.edge]);
        setEdges((eds) => addEdge({
          ...connection,
          id: res.edge.id,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#6b7280' },
        }, eds));
      } catch (error) {
        console.error('Failed to add edge:', error);
      }
    },
    [workflowId, workflowEdges, setEdges]
  );
  
  const handleNodeDragStop = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      if (!workflowId) return;
      
      try {
        await workflowOrchestration.updateNode(workflowId, node.id, {
          position_x: node.position.x,
          position_y: node.position.y,
        });
      } catch (error) {
        console.error('Failed to update node position:', error);
      }
    },
    [workflowId]
  );
  
  const openAddNodeModal = (nodeType: WorkflowNodeType) => {
    setNewNodeType(nodeType);
    setNewNodeName('');
    setShowCreateNodeModal(true);
    setShowNewNodeMenu(false);
  };
  
  const handleAddNode = async () => {
    if (!workflowId || !newNodeType || !newNodeName.trim()) return;
    
    try {
      const res = await workflowOrchestration.addNode(workflowId, {
        node_type: newNodeType,
        name: newNodeName,
        position_x: 300,
        position_y: 200,
        config: {},
      } as WorkflowNode);
      setWorkflowNodes([...workflowNodes, res.node]);
      setNodes((nds) => [
        ...nds,
        {
          id: res.node.id,
          type: 'custom',
          position: { x: res.node.position_x, y: res.node.position_y },
          data: {
            label: res.node.name,
            nodeType: res.node.node_type,
          } as CustomNodeData,
        },
      ]);
      setShowCreateNodeModal(false);
      setNewNodeName('');
      setNewNodeType(null);
    } catch (error) {
      console.error('Failed to add node:', error);
    }
  };
  
  const handleUpdateNodeConfig = async (nodeId: string, config: Record<string, unknown>) => {
    if (!workflowId) return;
    
    try {
      const configStr = JSON.stringify(config);
      await workflowOrchestration.updateNode(workflowId, nodeId, { config: configStr });
      setWorkflowNodes(workflowNodes.map(n =>
        n.id === nodeId ? { ...n, config: configStr } : n
      ));
      setSelectedNodeId(null);
    } catch (error) {
      console.error('Failed to update node:', error);
    }
  };
  
  const openDeleteNodeModal = (nodeId: string) => {
    setNodeToDelete(nodeId);
    setShowDeleteNodeModal(true);
  };
  
  const handleDeleteNode = async () => {
    if (!workflowId || !nodeToDelete) return;
    
    try {
      await workflowOrchestration.deleteNode(workflowId, nodeToDelete);
      setWorkflowNodes(workflowNodes.filter(n => n.id !== nodeToDelete));
      setNodes((nds) => nds.filter(n => n.id !== nodeToDelete));
      setEdges((eds) => eds.filter(e => e.source !== nodeToDelete && e.target !== nodeToDelete));
      setShowDeleteNodeModal(false);
      setNodeToDelete(null);
    } catch (error) {
      console.error('Failed to delete node:', error);
    }
  };
  
  // Extract variables from workflow nodes for input dialog
  const extractWorkflowVariables = useCallback(() => {
    const variables = new Set<string>();
    for (const node of workflowNodes) {
      try {
        const config = JSON.parse(node.config || '{}');
        const fieldsToCheck = [config.prompt_template, config.system_prompt, config.message];
        for (const field of fieldsToCheck) {
          if (typeof field === 'string') {
            const matches = field.match(/\{\{(\w+)\}\}/g);
            if (matches) {
              matches.forEach(m => {
                const varName = m.replace(/\{\{|\}\}/g, '');
                if (!varName.startsWith('_') && !['input', 'previous_result', 'last_agent_output'].includes(varName)) {
                  variables.add(varName);
                }
              });
            }
          }
        }
      } catch {}
    }
    return Array.from(variables);
  }, [workflowNodes]);

  const workflowVariables = extractWorkflowVariables();

  const handleRunWorkflow = async (inputData?: Record<string, string>) => {
    if (!workflowId) return;
    
    try {
      const res = await workflowOrchestration.run(workflowId, inputData || runInputValues);
      setRuns([res.run, ...runs]);
      setSearchParams({ run: res.run.id });
      setShowRunInputModal(false);
      setRunInputValues({});
    } catch (error) {
      console.error('Failed to run workflow:', error);
    }
  };
  
  const openRunDialog = () => {
    if (workflowVariables.length > 0) {
      const initial: Record<string, string> = {};
      workflowVariables.forEach(v => initial[v] = '');
      setRunInputValues(initial);
      setShowRunInputModal(true);
    } else {
      handleRunWorkflow({});
    }
  };
  
  const handleUpdateWorkflow = async (data: Partial<Workflow>) => {
    if (!workflowId) return;
    
    try {
      const res = await workflowOrchestration.update(workflowId, data);
      setCurrentWorkflow(res.workflow);
    } catch (error) {
      console.error('Failed to update workflow:', error);
      throw error;
    }
  };
  
  const selectedNode = useMemo(
    () => workflowNodes.find(n => n.id === selectedNodeId) || null,
    [workflowNodes, selectedNodeId]
  );
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="text-slate-500 dark:text-slate-400">Loading...</div>
      </div>
    );
  }
  
  // Show workflow list if no workflow selected
  if (!workflowId) {
    return (
      <div className="max-w-4xl mx-auto">
        <WorkflowList
          workflows={workflows}
          onSelect={(id) => navigate(`/workflows/${id}`)}
          onCreate={() => setShowCreateWorkflowModal(true)}
          onDelete={handleDeleteWorkflow}
        />
        
        {/* Create Workflow Modal */}
        <Modal
          isOpen={showCreateWorkflowModal}
          onClose={() => setShowCreateWorkflowModal(false)}
          title="Create Workflow"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Workflow Name</label>
              <input
                type="text"
                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                placeholder="My Workflow"
                value={newWorkflowName}
                onChange={(e) => setNewWorkflowName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkflow()}
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCreateWorkflowModal(false)}
                className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkflow}
                disabled={!newWorkflowName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-slate-500 dark:text-slate-400 text-slate-900 dark:text-white rounded"
              >
                Create
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }
  
  // Show workflow editor with tabs
  return (
    <div 
      style={{ 
        height: 'calc(100vh - 64px)', 
        width: '100%',
        maxWidth: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box'
      }}
    >
      {/* Header */}
      <div className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
        <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/workflows')}
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
          >
            ← Back
          </button>
          <h1 className="text-lg font-medium text-slate-900 dark:text-white">
            {currentWorkflow?.name || 'Workflow'}
          </h1>
            {currentWorkflow?.is_active === 1 && (
              <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                Active
              </span>
            )}
        </div>
        
          {activeTab === 'graph' && (
        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowNewNodeMenu(!showNewNodeMenu)}
              className="bg-slate-100 dark:bg-slate-800 hover:bg-gray-700 text-slate-900 dark:text-white px-3 py-1.5 rounded text-sm"
            >
              + Add Node
            </button>
            {showNewNodeMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 w-48 z-50">
                {(['agent', 'condition', 'human_checkpoint', 'parallel_split', 'parallel_merge', 'transform', 'delay'] as WorkflowNodeType[]).map((type) => {
                  const IconComponent = nodeIconComponents[type];
                  return (
                    <button
                      key={type}
                      onClick={() => openAddNodeModal(type)}
                      className="w-full px-4 py-2 text-left text-sm text-slate-600 dark:text-slate-300 hover:bg-gray-700 flex items-center gap-2"
                    >
                      <span style={{ color: nodeColors[type] }}><IconComponent /></span>
                      <span className="capitalize">{type.replace(/_/g, ' ')}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          
          <button
            onClick={openRunDialog}
            className="bg-green-600 hover:bg-green-700 text-slate-900 dark:text-white px-4 py-1.5 rounded text-sm flex items-center gap-2"
          >
            <PlayIcon /> Run
          </button>
        </div>
          )}
      </div>
      
        {/* Tabs */}
        <div className="flex gap-1 mt-3 -mb-3">
          {(['graph', 'runs', 'settings', 'api'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm capitalize border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-blue-500 text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              {tab === 'runs' ? `Runs (${runs.length})` : tab}
            </button>
          ))}
        </div>
      </div>
      
      {/* Tab Content */}
      {activeTab === 'graph' && (
        <div style={{ flex: 1, position: 'relative', minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
          {/* Flow Canvas with border */}
          <div 
            className="absolute top-4 left-4 right-4 bottom-4 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900"
          >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeDragStop={handleNodeDragStop}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onNodeDoubleClick={(_, node) => openDeleteNodeModal(node.id)}
            nodeTypes={nodeTypes}
            fitView
            className="!bg-slate-100 dark:!bg-slate-900"
          >
            <Background className="!bg-slate-100 dark:!bg-slate-900" color="#94a3b8" gap={20} />
            <Controls className="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 !shadow-sm" />
            <MiniMap
              nodeColor={(node) => nodeColors[(node.data as CustomNodeData)?.nodeType] || '#6b7280'}
              maskColor="rgba(100,116,139,0.3)"
              className="!bg-white dark:!bg-slate-800 !border !border-slate-200 dark:!border-slate-700"
            />
          </ReactFlow>
        </div>
        
        {/* Node Config Panel */}
        {selectedNodeId && (
          <NodeConfigPanel
            node={selectedNode}
            agents={agents}
            onUpdate={handleUpdateNodeConfig}
            onClose={() => setSelectedNodeId(null)}
              onViewAgent={(agentId) => navigate(`/agents/${agentId}`)}
          />
        )}
        
        {/* Human Checkpoint Banner - links to approvals page */}
        {selectedRun?.status === 'paused' && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
            <Link
              to="/approvals"
              className="flex items-center gap-3 px-4 py-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-yellow-500/30 flex items-center justify-center">
                <UserIcon />
              </div>
              <div>
                <div className="text-sm font-medium text-yellow-400">
                Human Approval Required
              </div>
                <div className="text-xs text-yellow-400/70">
                  Click to review in Approvals Inbox →
            </div>
              </div>
            </Link>
          </div>
        )}
      </div>
      )}
      
      {activeTab === 'runs' && (
        <div className="flex-1 overflow-y-auto">
          <RunsTab
            workflowId={workflowId}
            runs={runs}
            workflowNodes={workflowNodes}
            onRefresh={async () => {
              const res = await workflowOrchestration.listRuns(workflowId);
              setRuns(res.runs);
            }}
            onSelectRun={(run) => setSearchParams({ run: run.id })}
            onRun={async (inputData) => {
              const res = await workflowOrchestration.run(workflowId, inputData);
              setRuns([res.run, ...runs]);
              setSearchParams({ run: res.run.id });
            }}
          />
        </div>
      )}
      
      {activeTab === 'settings' && currentWorkflow && (
        <div className="flex-1 overflow-y-auto">
          <SettingsTab
            workflow={currentWorkflow}
            onUpdate={handleUpdateWorkflow}
            onDelete={() => handleDeleteWorkflow(currentWorkflow.id)}
          />
        </div>
      )}
      
      {activeTab === 'api' && currentWorkflow && (
        <div className="flex-1 overflow-y-auto">
          <ApiTab workflow={currentWorkflow} workflowNodes={workflowNodes} />
        </div>
      )}
      
      {/* Create Node Modal */}
      <Modal
        isOpen={showCreateNodeModal}
        onClose={() => setShowCreateNodeModal(false)}
        title={`Add ${newNodeType?.replace(/_/g, ' ')} Node`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Node Name</label>
            <input
              type="text"
              className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
              placeholder="Enter node name"
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddNode()}
              autoFocus
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowCreateNodeModal(false)}
              className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleAddNode}
              disabled={!newNodeName.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-slate-500 dark:text-slate-400 text-slate-900 dark:text-white rounded"
            >
              Add Node
            </button>
          </div>
        </div>
      </Modal>
      
      {/* Delete Node Confirmation Modal */}
      <Modal
        isOpen={showDeleteNodeModal}
        onClose={() => setShowDeleteNodeModal(false)}
        title="Delete Node"
      >
        <div className="space-y-4">
          <p className="text-slate-600 dark:text-slate-300">
            Are you sure you want to delete this node? This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowDeleteNodeModal(false)}
              className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteNode}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-slate-900 dark:text-white rounded"
            >
              Delete
            </button>
          </div>
        </div>
      </Modal>
      
      {/* Run Input Modal */}
      <Modal
        isOpen={showRunInputModal}
        onClose={() => setShowRunInputModal(false)}
        title="Start Workflow Run"
      >
        <div className="space-y-4">
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Provide input values for this workflow run:
          </p>
          {workflowVariables.map((variable) => (
            <div key={variable}>
              <label className="block text-sm font-medium text-slate-900 dark:text-white mb-1 capitalize">
                {variable.replace(/_/g, ' ')}
              </label>
              <input
                type="text"
                value={runInputValues[variable] || ''}
                onChange={(e) => setRunInputValues({ ...runInputValues, [variable]: e.target.value })}
                placeholder={`Enter ${variable}...`}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          ))}
          {workflowVariables.length === 0 && (
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              This workflow has no input variables. Click Start to run it.
            </p>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <button
              onClick={() => setShowRunInputModal(false)}
              className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
            >
              Cancel
            </button>
            <button
              onClick={() => handleRunWorkflow()}
              disabled={workflowVariables.length > 0 && workflowVariables.some(v => !runInputValues[v]?.trim())}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-slate-500 dark:text-slate-400 text-slate-900 dark:text-white rounded flex items-center gap-2"
            >
              <PlayIcon /> Start Run
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
