import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { workflowOrchestration, type PendingApproval } from '@/lib/api';
import { Modal } from '@/components/Modal';

// Icons
const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const LoopBackIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
  </svg>
);

const InboxIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-17.5 0a2.25 2.25 0 00-2.25 2.25v4.5a2.25 2.25 0 002.25 2.25h19.5a2.25 2.25 0 002.25-2.25v-4.5a2.25 2.25 0 00-2.25-2.25m-17.5 0V6.75a2.25 2.25 0 012.25-2.25h15a2.25 2.25 0 012.25 2.25v6.75" />
  </svg>
);

const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

// Inbox list item component
function InboxItem({ 
  approval, 
  isSelected,
  onClick 
}: { 
  approval: PendingApproval;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
        isSelected ? 'bg-blue-50 dark:bg-slate-800/70 border-l-2 border-l-blue-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white truncate">{approval.workflow_name}</span>
            {approval.current_loop_count > 0 && (
              <span className="text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded flex-shrink-0">
                Rev #{approval.current_loop_count}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">
            {approval.node_name}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-1">
            {approval.message}
          </p>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
          {formatTimeAgo(approval.paused_at)}
        </div>
      </div>
    </button>
  );
}

// Detail view component
function DetailView({
  approval,
  onApprove,
  onReject,
  onRequestChanges,
  onBack,
}: {
  approval: PendingApproval;
  onApprove: (feedback: string) => Promise<void>;
  onReject: (feedback: string) => Promise<void>;
  onRequestChanges: (feedback: string, loopBackNodeId: string) => Promise<void>;
  onBack: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [selectedLoopBackNode, setSelectedLoopBackNode] = useState(
    approval.default_loop_back_node_id || ''
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleAction = async (action: 'approve' | 'reject' | 'request_changes') => {
    setIsSubmitting(true);
    try {
      if (action === 'approve') {
        await onApprove(feedback);
      } else if (action === 'reject') {
        await onReject(feedback);
      } else if (action === 'request_changes') {
        await onRequestChanges(feedback, selectedLoopBackNode);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="lg:hidden p-1 hover:bg-slate-100 dark:bg-slate-800 rounded"
          >
            <ChevronLeftIcon />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{approval.workflow_name}</h2>
              <span className="text-xs bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded">
                Awaiting Review
              </span>
              {approval.current_loop_count > 0 && (
                <span className="text-xs bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                  Revision #{approval.current_loop_count}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Paused at: <span className="text-slate-900 dark:text-white">{approval.node_name}</span>
              <span className="text-slate-500 dark:text-slate-400 ml-2">• {formatDateTime(approval.paused_at)}</span>
            </p>
          </div>
          <button
            onClick={() => navigate(`/workflows/${approval.workflow_id}?run=${approval.run_id}`)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex-shrink-0"
          >
            View Workflow →
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Checkpoint Message */}
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700/30 rounded-lg">
          <p className="text-yellow-800 dark:text-yellow-200 text-sm">{approval.message}</p>
        </div>

        {/* Previous feedback banner (if revision) */}
        {typeof approval.context._human_feedback === 'string' && approval.context._human_feedback && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/30 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <LoopBackIcon />
              <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Your Previous Feedback</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-gray-300">{approval.context._human_feedback}</p>
          </div>
        )}

        {/* MAIN: Agent Output - THE RESULT TO REVIEW */}
        {(() => {
          // Extract the actual output to review
          const lastOutput = approval.context.last_agent_output || approval.context.previous_result;
          const outputText = typeof lastOutput === 'string' 
            ? lastOutput 
            : typeof lastOutput === 'object' && lastOutput !== null
              ? ('result' in lastOutput ? String(lastOutput.result) : JSON.stringify(lastOutput, null, 2))
              : null;
          
          // Find the last completed agent node for context
          const lastAgentNode = [...(approval.node_history || [])].reverse().find(n => n.node_type === 'agent');
          
          if (!outputText && !lastAgentNode) return null;
          
          return (
            <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
              <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {lastAgentNode?.node_name || 'Agent'} Output
                  </span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Result to Review</span>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50">
                <div className="prose prose-slate dark:prose-invert prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-slate-700 dark:text-gray-200 font-sans text-sm leading-relaxed m-0 bg-transparent p-0">
                    {outputText || 'No output captured'}
                  </pre>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Execution Timeline (collapsed by default if there's output above) */}
        {approval.node_history && approval.node_history.length > 0 && (
          <details open={!approval.context.last_agent_output}>
            <summary className="text-sm font-medium text-slate-900 dark:text-white cursor-pointer hover:text-slate-600 dark:hover:text-gray-300 mb-3">
              Execution Timeline ({approval.node_history.length} steps)
            </summary>
            <div className="space-y-2 mt-3">
              {approval.node_history.map((node, idx) => (
                <div 
                  key={idx} 
                  className="flex items-start gap-3 p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg"
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    node.status === 'completed' ? 'bg-green-500' : 
                    node.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-900 dark:text-white">{node.node_name}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">({node.node_type})</span>
                    </div>
                    {node.output && Object.keys(node.output).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer">
                          View Output
                        </summary>
                        <pre className="mt-2 p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-transparent rounded text-xs text-slate-700 dark:text-gray-300 max-h-40 overflow-auto whitespace-pre-wrap">
                          {typeof node.output === 'object' && 'result' in node.output
                            ? String(node.output.result)
                            : JSON.stringify(node.output, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Raw Context (for debugging, hidden by default) */}
        {approval.context && Object.keys(approval.context).length > 0 && (
          <details className="text-xs">
            <summary className="text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-400 dark:text-slate-500">
              Debug: View Raw Context
            </summary>
            <pre className="mt-2 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-xs text-slate-400 dark:text-slate-500 max-h-40 overflow-auto">
              {JSON.stringify(approval.context, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* Action Footer */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 space-y-4 bg-slate-50 dark:bg-slate-900/50">
        {/* Feedback textarea */}
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-white mb-2">
            Your Response
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={approval.supports_loop_back 
              ? "Provide feedback for revisions, or leave empty to approve/reject..."
              : "Optional feedback..."
            }
            className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none text-sm"
            rows={3}
          />
        </div>

        {/* Loop back selector */}
        {approval.supports_loop_back && approval.loop_back_targets.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">Send back to:</label>
            <select
              value={selectedLoopBackNode}
              onChange={(e) => setSelectedLoopBackNode(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select agent...</option>
              {approval.loop_back_targets.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ({approval.current_loop_count + 1}/{approval.max_loops})
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleAction('reject')}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-600/20 hover:bg-red-200 dark:hover:bg-red-600/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-600/30 rounded-lg disabled:opacity-50 transition-colors text-sm"
          >
            <XIcon />
            Reject
          </button>
          
          {approval.supports_loop_back && (
            <button
              onClick={() => handleAction('request_changes')}
              disabled={isSubmitting || !feedback.trim() || !selectedLoopBackNode}
              className="flex items-center gap-2 px-4 py-2 bg-orange-100 dark:bg-orange-600/20 hover:bg-orange-200 dark:hover:bg-orange-600/30 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-600/30 rounded-lg disabled:opacity-50 transition-colors text-sm"
              title={!feedback.trim() ? 'Feedback required' : !selectedLoopBackNode ? 'Select agent' : ''}
            >
              <LoopBackIcon />
              Request Changes
            </button>
          )}
          
          <button
            onClick={() => handleAction('approve')}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors text-sm ml-auto"
          >
            <CheckIcon />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// Empty state
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-white dark:bg-slate-800 rounded-lg m-4">
      <div className="w-16 h-16 mb-4 rounded-full bg-green-100 dark:bg-green-500/10 flex items-center justify-center text-green-600 dark:text-green-400">
        <CheckIcon />
      </div>
      <h2 className="text-xl text-slate-900 dark:text-white mb-2">All caught up!</h2>
      <p className="text-slate-500 dark:text-slate-400 max-w-sm">
        No workflows are currently awaiting your approval. New items will appear here automatically.
      </p>
    </div>
  );
}

// No selection state
function NoSelectionState({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="text-slate-400 dark:text-slate-500">
        <InboxIcon />
      </div>
      <h2 className="text-lg text-slate-900 dark:text-white mt-4 mb-2">Select an item</h2>
      <p className="text-slate-500 dark:text-slate-400 text-sm">
        {count} workflow{count !== 1 ? 's' : ''} waiting for review
      </p>
    </div>
  );
}

export default function Approvals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<{ 
    isOpen: boolean; 
    title: string; 
    message: string;
    type: 'alert' | 'confirm';
  }>({ isOpen: false, title: '', message: '', type: 'alert' });

  const selectedId = searchParams.get('id');
  const selectedApproval = approvals.find(a => a.run_id === selectedId);

  // Filter approvals by search
  const filteredApprovals = approvals.filter(a => 
    !searchQuery || 
    a.workflow_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.node_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.message.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const loadApprovals = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const { pending_approvals } = await workflowOrchestration.getPendingApprovals();
      setApprovals(pending_approvals);
      
      // Auto-select first if none selected and on desktop
      if (!selectedId && pending_approvals.length > 0 && window.innerWidth >= 1024) {
        setSearchParams({ id: pending_approvals[0].run_id });
      }
    } catch (error) {
      console.error('Failed to load approvals:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedId, setSearchParams]);

  useEffect(() => {
    loadApprovals();
    const interval = setInterval(() => loadApprovals(), 30000);
    return () => clearInterval(interval);
  }, [loadApprovals]);

  const handleApprove = async (feedback: string) => {
    if (!selectedApproval) return;
    try {
      await workflowOrchestration.resumeRun(selectedApproval.workflow_id, selectedApproval.run_id, { 
        approved: true, 
        feedback: feedback || undefined 
      });
      setModal({
        isOpen: true,
        title: 'Approved',
        message: 'Workflow has been approved and will continue.',
        type: 'alert',
      });
      // Move to next or clear selection
      const currentIndex = approvals.findIndex(a => a.run_id === selectedId);
      loadApprovals().then(() => {
        const nextApproval = approvals[currentIndex + 1] || approvals[currentIndex - 1];
        if (nextApproval) {
          setSearchParams({ id: nextApproval.run_id });
        } else {
          setSearchParams({});
        }
      });
    } catch (error) {
      setModal({
        isOpen: true,
        title: 'Error',
        message: 'Failed to approve. Please try again.',
        type: 'alert',
      });
    }
  };

  const handleReject = async (feedback: string) => {
    if (!selectedApproval) return;
    try {
      await workflowOrchestration.resumeRun(selectedApproval.workflow_id, selectedApproval.run_id, { 
        approved: false, 
        action: 'fail',
        feedback: feedback || 'Rejected' 
      });
      setModal({
        isOpen: true,
        title: 'Rejected',
        message: 'Workflow has been rejected.',
        type: 'alert',
      });
      loadApprovals();
      setSearchParams({});
    } catch (error) {
      setModal({
        isOpen: true,
        title: 'Error',
        message: 'Failed to reject. Please try again.',
        type: 'alert',
      });
    }
  };

  const handleRequestChanges = async (feedback: string, loopBackNodeId: string) => {
    if (!selectedApproval) return;
    try {
      const result = await workflowOrchestration.resumeRun(selectedApproval.workflow_id, selectedApproval.run_id, { 
        approved: false,
        action: 'loop_back',
        feedback,
        loop_back_node_id: loopBackNodeId,
      });
      setModal({
        isOpen: true,
        title: 'Changes Requested',
        message: result.message || 'Sent back for revision.',
        type: 'alert',
      });
      loadApprovals();
      setSearchParams({});
    } catch (error: unknown) {
      setModal({
        isOpen: true,
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to request changes.',
        type: 'alert',
      });
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 dark:border-white"></div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Sidebar / List */}
      <div className={`w-full lg:w-96 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-900/30 ${
        selectedId ? 'hidden lg:flex' : 'flex'
      }`}>
        {/* List Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="text-slate-600 dark:text-slate-400"><InboxIcon /></span>
              Approvals
              {approvals.length > 0 && (
                <span className="text-sm bg-amber-100 dark:bg-yellow-500/20 text-amber-600 dark:text-yellow-400 px-2 py-0.5 rounded-full">
                  {approvals.length}
                </span>
              )}
            </h1>
            <button
              onClick={() => loadApprovals(true)}
              disabled={refreshing}
              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 text-slate-600 dark:text-slate-400"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          </div>
          
          {/* Search */}
          <div className="relative">
            <SearchIcon />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workflows..."
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              style={{ paddingLeft: '2.25rem' }}
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
              <SearchIcon />
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-transparent">
          {filteredApprovals.length === 0 ? (
            <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
              {searchQuery ? 'No matching workflows' : 'No pending approvals'}
            </div>
          ) : (
            filteredApprovals.map((approval) => (
              <InboxItem
                key={approval.run_id}
                approval={approval}
                isSelected={selectedId === approval.run_id}
                onClick={() => setSearchParams({ id: approval.run_id })}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail View */}
      <div className={`flex-1 bg-slate-50 dark:bg-slate-900 ${
        selectedId ? 'flex' : 'hidden lg:flex'
      }`}>
        {approvals.length === 0 ? (
          <EmptyState />
        ) : selectedApproval ? (
          <DetailView
            approval={selectedApproval}
            onApprove={handleApprove}
            onReject={handleReject}
            onRequestChanges={handleRequestChanges}
            onBack={() => setSearchParams({})}
          />
        ) : (
          <NoSelectionState count={approvals.length} />
        )}
      </div>

      {/* Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={() => setModal({ ...modal, isOpen: false })}
        title={modal.title}
        message={modal.message}
        type={modal.type}
      />
    </div>
  );
}
