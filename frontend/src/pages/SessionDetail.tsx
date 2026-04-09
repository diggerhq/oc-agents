import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { sessions, agent, agentConfig, schedules as schedulesApi, agentUsers, skills, runs as runsApi, files, Session, Task, Message, AgentConfigType, Schedule, ScheduleRun, AgentRun, BuiltinSkill, MCPServerConfig, PortalTheme } from '@/lib/api';
import { Terminal } from '@/components/Terminal';
import { AgentConfig } from '@/components/AgentConfig';
import { PortalAgentWizard } from '@/components/PortalAgentWizard';
import { PortalSandboxAgentWizard } from '@/components/PortalSandboxAgentWizard';
import { useWebSocket } from '@/hooks/useWebSocket';
import { Modal } from '@/components/Modal';

export function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isStartingSandbox, setIsStartingSandbox] = useState(false);
  const [isRunningTask, setIsRunningTask] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'playground' | 'chat' | 'config' | 'mcp' | 'schedule' | 'portal' | 'knowledge' | 'executions'>('playground');
  const [jwtSecret, setJwtSecret] = useState<string | null>(null);
  const [isGeneratingSecret, setIsGeneratingSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Knowledge base state
  const [allKnowledgeBases, setAllKnowledgeBases] = useState<Array<{id: string; name: string; status: string; indexed_files: number; indexed_chunks: number}>>([]);
  const [attachedKnowledgeBases, setAttachedKnowledgeBases] = useState<Array<{id: string; name: string; status: string; indexed_files: number; indexed_chunks: number}>>([]);
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);
  // Portal sub-tab and users state
  const [portalSubTab, setPortalSubTab] = useState<'settings' | 'customize' | 'css' | 'embed' | 'users' | 'skills'>('settings');
  const [customCSS, setCustomCSS] = useState('');
  const [activeSkills, setActiveSkills] = useState<Array<{id: string; name: string; friendlyName: string}>>([]);
  // Executions sub-tab state
  const [executionsSubTab, setExecutionsSubTab] = useState<'api' | 'sdk' | 'portal'>('api');
  const [apiRuns, setApiRuns] = useState<AgentRun[]>([]);
  const [sdkRuns, setSdkRuns] = useState<AgentRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [isTogglingPortal, setIsTogglingPortal] = useState(false);
  const [portalUsers, setPortalUsers] = useState<Array<{id: string; type: 'portal' | 'embed'; identifier: string; displayName: string; userContext: Record<string, unknown>; createdAt: string; updatedAt: string}>>([]);
  const [portalStats, setPortalStats] = useState<{totalUsers: number; portalUsers: number; embedUsers: number; totalThreads: number; totalMessages: number} | null>(null);
  const [selectedPortalUser, setSelectedPortalUser] = useState<{id: string; type: 'portal' | 'embed'; identifier: string; displayName: string; userContext: Record<string, unknown>; createdAt: string; updatedAt: string} | null>(null);
  const [portalUserThreads, setPortalUserThreads] = useState<Array<{id: string; title: string | null; messageCount: number; lastMessage: string | null; createdAt: string; updatedAt: string}>>([]);
  const [selectedPortalThread, setSelectedPortalThread] = useState<{id: string; title: string | null; messageCount: number; lastMessage: string | null; createdAt: string; updatedAt: string} | null>(null);
  const [portalThreadMessages, setPortalThreadMessages] = useState<Array<{id: string; role: string; content: string; createdAt: string}>>([]);
  const [isLoadingPortalUsers, setIsLoadingPortalUsers] = useState(false);
  const [isLoadingPortalThreads, setIsLoadingPortalThreads] = useState(false);
  const [isLoadingPortalMessages, setIsLoadingPortalMessages] = useState(false);
  // Portal customization state
  const [portalName, setPortalName] = useState('');
  const [portalGreeting, setPortalGreeting] = useState('');
  const [insightsPortalGreeting, setInsightsPortalGreeting] = useState('');
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [portalPrimaryColor, setPortalPrimaryColor] = useState('#3b5998');
  const [portalBackgroundColor, setPortalBackgroundColor] = useState('#0f0f0f');
  const [portalAccentColor, setPortalAccentColor] = useState('#1e1e2e');
  const [portalTextColor, setPortalTextColor] = useState('#ffffff');
  const [portalButtonColor, setPortalButtonColor] = useState('#3b5998');
  const [portalFontFamily, setPortalFontFamily] = useState<PortalTheme['fontFamily']>('system');
  const [portalLogoUrl, setPortalLogoUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isSavingPortalConfig, setIsSavingPortalConfig] = useState(false);
  const [portalConfigMessage, setPortalConfigMessage] = useState('');
  const [portalBucketId, setPortalBucketId] = useState<string | null>(null);
  const [attachedBuckets, setAttachedBuckets] = useState<Array<{ id: string; bucket_id: string; bucket_name: string }>>([]);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<AgentConfigType | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  // MCP/Skills state
  const [builtinSkills, setBuiltinSkills] = useState<Array<BuiltinSkill & { enabled: boolean; configured: boolean; missingSecrets: string[] }>>([]);
  const [customMcpServers, setCustomMcpServers] = useState<MCPServerConfig[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [isSavingSkills, setIsSavingSkills] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'sse' | 'streamable-http'>('streamable-http');
  const [newMcpAuthType, setNewMcpAuthType] = useState<'none' | 'bearer' | 'custom'>('none');
  const [newMcpAuthValue, setNewMcpAuthValue] = useState('');
  const [newMcpCustomHeaderName, setNewMcpCustomHeaderName] = useState('');
  const [testingMcpServer, setTestingMcpServer] = useState<string | null>(null);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { success: boolean; tools?: { name: string; description: string }[]; error?: string }>>({});
  // Schedule state
  const [agentSchedules, setAgentSchedules] = useState<Schedule[]>([]);
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRun[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    description: '',
    cron_expression: '0 9 * * *',
    timezone: 'UTC',
    prompt: '',
  });
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);
  
  // Modal state
  const [modal, setModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm' | 'danger';
    onConfirm?: () => void;
  }>({ isOpen: false, title: '', message: '', type: 'alert' });
  
  const closeModal = () => setModal(prev => ({ ...prev, isOpen: false }));

  // Determine if this is a task agent
  const isTaskAgent = session?.agent_type === 'task';
  const isPortalAgent = session?.agent_type === 'portal';
  const isPortalSandboxAgent = session?.agent_type === 'portal-sandbox';
  const showWizard = (isPortalAgent || isPortalSandboxAgent) && config && !config.setup_wizard_completed;

  // Handle WebSocket output - append new text
  const handleWebSocketOutput = useCallback((text: string, isStatus?: boolean) => {
    if (isStatus) {
      // Status messages go as separate entries with __STATUS__ prefix
      const newLines = text.split('\n').filter(l => l.trim());
      if (newLines.length > 0) {
        const markedLines = newLines.map(l => `__STATUS__${l}`);
        setStreamingOutput(prev => [...prev, ...markedLines]);
      }
    } else {
      // Text content gets accumulated - append to last text entry or create new one
      setStreamingOutput(prev => {
        // Find the last non-status entry to append to
        const lastIndex = prev.length - 1;
        if (lastIndex >= 0 && !prev[lastIndex].startsWith('__STATUS__')) {
          // Append to existing text entry
          const updated = [...prev];
          updated[lastIndex] = updated[lastIndex] + text;
          return updated;
        } else {
          // Create new text entry
          return [...prev, text];
        }
      });
    }
  }, []);

  // Handle task status updates from WebSocket
  const handleTaskStatusUpdate = useCallback((taskId: string, status: string, result?: string) => {
    console.log(`[WS] Task ${taskId} status: ${status}`);
    
    // Update the current task if it matches
    setCurrentTask(prev => {
      if (prev?.id === taskId) {
        return { ...prev, status: status as 'pending' | 'running' | 'completed' | 'failed', result };
      }
      return prev;
    });
    
    // Update the task in the tasks list
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, status: status as 'pending' | 'running' | 'completed' | 'failed', result } : t
    ));
    
    // If completed or failed, stop running state and reload to get full messages
    if (status === 'completed' || status === 'failed') {
      setIsRunningTask(false);
      // Reload to get the assistant message
      loadSession();
    }
  }, []);

  // Connect to WebSocket for real-time updates
  const { isConnected } = useWebSocket({
    sessionId,
    onOutput: handleWebSocketOutput,
    onTaskStatus: handleTaskStatusUpdate,
  });

  useEffect(() => {
    if (sessionId) {
      loadSession();
    }
  }, [sessionId]);

  // Set default tab based on agent type or URL params (only on first load)
  const initialTabSet = useRef(false);
  useEffect(() => {
    if (session && !initialTabSet.current) {
      // Check URL query params first
      const tabParam = searchParams.get('tab') as typeof activeTab | null;
      const subtabParam = searchParams.get('subtab');
      
      if (tabParam && ['playground', 'chat', 'config', 'mcp', 'schedule', 'portal', 'knowledge'].includes(tabParam)) {
        setActiveTab(tabParam);
        // Handle portal subtab
        if (tabParam === 'portal' && subtabParam === 'users') {
          setPortalSubTab('users');
        }
      } else {
        // Portal agents default to config (wizard), task agents to playground, code agents to chat
        setActiveTab((isPortalAgent || isPortalSandboxAgent) ? 'config' : isTaskAgent ? 'playground' : 'chat');
      }
      initialTabSet.current = true;
    }
  }, [session, isTaskAgent, isPortalAgent, isPortalSandboxAgent, searchParams]);

  // Poll for task status
  useEffect(() => {
    if (currentTask && currentTask.status === 'running') {
      const interval = setInterval(async () => {
        try {
          const { task, messages: msgs } = await agent.getTask(sessionId!, currentTask.id);
          setCurrentTask(task);
          
          setAllMessages(prev => {
            const otherMsgs = prev.filter(m => m.task_id !== task.id);
            return [...otherMsgs, ...msgs].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });

          if (task.status !== 'running') {
            clearInterval(interval);
            setIsRunningTask(false);
            // Don't clear streaming output - keep it for review
          }
        } catch {
          // Ignore polling errors
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [currentTask, sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [streamingOutput]);

  // Update elapsed time while running
  useEffect(() => {
    if (isRunningTask && runStartTime) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - runStartTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setElapsedTime(0);
    }
  }, [isRunningTask, runStartTime]);

  const loadSession = async () => {
    try {
      const { session: s, tasks: t } = await sessions.get(sessionId!);
      setSession(s);
      setTasks(t);

      // Load agent config
      try {
        const { config: cfg } = await agentConfig.get(sessionId!);
        setConfig(cfg);
        setPortalEnabled(Boolean(cfg.portal_enabled));
        
        // Load portal customization settings
        setPortalName(cfg.portal_name || '');
        setPortalGreeting(cfg.embed_greeting || '');
        setInsightsPortalGreeting(cfg.portal_greeting || '');
        setSuggestedQuestions(cfg.portal_suggested_questions || []);
        setCustomCSS(cfg.portal_custom_css || '');
        if (cfg.embed_theme) {
          try {
            const theme: PortalTheme = JSON.parse(cfg.embed_theme);
            setPortalPrimaryColor(theme.primaryColor || '#3b5998');
            setPortalBackgroundColor(theme.backgroundColor || '#0f0f0f');
            setPortalAccentColor(theme.accentColor || '#1e1e2e');
            setPortalTextColor(theme.textColor || '#ffffff');
            setPortalButtonColor(theme.buttonColor || '#3b5998');
            setPortalFontFamily(theme.fontFamily || 'system');
          } catch {
            // Use defaults
          }
        }
        if (cfg.portal_logo_url) {
          const logoVersion = cfg.updated_at ? encodeURIComponent(cfg.updated_at) : `${Date.now()}`;
          setPortalLogoUrl(`/api/agents/${sessionId}/config/logo/image?v=${logoVersion}`);
        }
        
        // Store saved portal settings for later
        const savedPortalBucketId = (cfg as any).portal_bucket_id;
        const savedPortalFilesHidden = (cfg as any).portal_files_hidden;
        
        // Load attached buckets for portal bucket selector
        try {
          const { buckets } = await files.getAgentBuckets(sessionId!);
          setAttachedBuckets(buckets);
          
          // Set portal bucket with smart defaults
          if (savedPortalFilesHidden) {
            // Files explicitly hidden
            setPortalBucketId('none');
          } else if (savedPortalBucketId) {
            // Use the explicitly saved bucket ID
            setPortalBucketId(savedPortalBucketId);
          } else if (buckets.length > 0) {
            // No saved value - find "Files" bucket or use first bucket
            const filesBucket = buckets.find(b => 
              b.bucket_name.toLowerCase() === 'files'
            );
            setPortalBucketId(filesBucket ? filesBucket.bucket_id : buckets[0].bucket_id);
          } else {
            // No buckets attached - default to "none"
            setPortalBucketId('none');
          }
        } catch {
          // Buckets might not be available
          setPortalBucketId('none');
        }
      } catch {
        // Config might not exist yet
      }

      // Load JWT secret if it exists
      try {
        const jwtRes = await fetch(`/api/portal/${sessionId}/jwt-secret`, { credentials: 'include' });
        if (jwtRes.ok) {
          const jwtData = await jwtRes.json();
          if (jwtData.secret) {
            setJwtSecret(jwtData.secret);
          }
        }
      } catch {
        // JWT secret might not exist yet
      }

      // Load messages from tasks
      const allMsgs: Message[] = [];
      for (const task of t) {
        try {
          const { messages: msgs } = await agent.getTask(sessionId!, task.id);
          allMsgs.push(...msgs);
        } catch {
          // Skip failed task message loads
        }
      }
      
      allMsgs.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setAllMessages(allMsgs);

      // Set current task to latest
      if (t.length > 0) {
        const latestTask = t[t.length - 1];
        setCurrentTask(latestTask);
        if (latestTask.status === 'running') {
          setIsRunningTask(true);
        }
      }
    } catch {
      setError('Failed to load agent');
    } finally {
      setIsLoading(false);
    }
  };

  // Load schedules for this agent
  const loadSchedules = async () => {
    if (!sessionId) return;
    setIsLoadingSchedules(true);
    try {
      const { schedules } = await schedulesApi.listForAgent(sessionId);
      setAgentSchedules(schedules);
    } catch (err) {
      console.error('Failed to load schedules:', err);
    } finally {
      setIsLoadingSchedules(false);
    }
  };

  // Load schedule details with runs
  const loadScheduleDetails = async (scheduleId: string) => {
    try {
      const { schedule, runs } = await schedulesApi.get(scheduleId);
      setSelectedSchedule(schedule);
      setScheduleRuns(runs);
    } catch (err) {
      console.error('Failed to load schedule details:', err);
    }
  };

  // Create a new schedule
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !scheduleForm.name || !scheduleForm.prompt) return;
    
    try {
      await schedulesApi.create({
        session_id: sessionId,
        name: scheduleForm.name,
        description: scheduleForm.description || undefined,
        cron_expression: scheduleForm.cron_expression,
        timezone: scheduleForm.timezone,
        prompt: scheduleForm.prompt,
      });
      setShowScheduleModal(false);
      setScheduleForm({ name: '', description: '', cron_expression: '0 9 * * *', timezone: 'UTC', prompt: '' });
      loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    }
  };

  // Toggle schedule active/inactive
  const handleToggleSchedule = async (scheduleId: string) => {
    try {
      await schedulesApi.toggle(scheduleId);
      loadSchedules();
      if (selectedSchedule?.id === scheduleId) {
        loadScheduleDetails(scheduleId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle schedule');
    }
  };

  // Run schedule now
  const handleRunScheduleNow = async (scheduleId: string) => {
    try {
      await schedulesApi.runNow(scheduleId);
      loadSchedules();
      if (selectedSchedule?.id === scheduleId) {
        loadScheduleDetails(scheduleId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run schedule');
    }
  };

  // Delete schedule
  const handleDeleteSchedule = async (scheduleId: string) => {
    setModal({
      isOpen: true,
      title: 'Delete Schedule',
      message: 'Delete this schedule? This cannot be undone.',
      type: 'danger',
      onConfirm: async () => {
    try {
      await schedulesApi.delete(scheduleId);
      setSelectedSchedule(null);
      setScheduleRuns([]);
      loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete schedule');
    }
      },
    });
  };

  // Load schedules when switching to schedule tab
  useEffect(() => {
    if (activeTab === 'schedule' && sessionId) {
      loadSchedules();
    }
  }, [activeTab, sessionId]);

  // Load knowledge bases when switching to knowledge tab
  const loadKnowledgeBases = async () => {
    if (!sessionId) return;
    setIsLoadingKnowledge(true);
    try {
      // Load all knowledge bases
      const allRes = await fetch('/api/knowledge', { credentials: 'include' });
      if (allRes.ok) {
        const data = await allRes.json();
        setAllKnowledgeBases(data.knowledgeBases || []);
      }
      
      // Load attached knowledge bases for this agent
      const attachedRes = await fetch(`/api/knowledge/agents/${sessionId}`, { credentials: 'include' });
      if (attachedRes.ok) {
        const data = await attachedRes.json();
        setAttachedKnowledgeBases(data.knowledgeBases || []);
      }
    } catch (err) {
      console.error('Failed to load knowledge bases:', err);
    } finally {
      setIsLoadingKnowledge(false);
    }
  };

  const handleAttachKnowledgeBase = async (kbId: string) => {
    try {
      const res = await fetch(`/api/knowledge/agents/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ knowledgeBaseId: kbId }),
      });
      if (res.ok) {
        loadKnowledgeBases();
      }
    } catch (err) {
      console.error('Failed to attach knowledge base:', err);
    }
  };

  const handleDetachKnowledgeBase = async (kbId: string) => {
    try {
      const res = await fetch(`/api/knowledge/agents/${sessionId}/${kbId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        loadKnowledgeBases();
      }
    } catch (err) {
      console.error('Failed to detach knowledge base:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'knowledge' && sessionId) {
      loadKnowledgeBases();
    }
  }, [activeTab, sessionId]);

  // Load skills when switching to MCP tab
  const loadSkills = async () => {
    if (!sessionId) return;
    setIsLoadingSkills(true);
    try {
      const data = await skills.getAgentSkills(sessionId);
      setBuiltinSkills(data.builtinSkills);
      setCustomMcpServers(data.customServers);
      setEnabledSkills(data.builtinSkills.filter(s => s.enabled).map(s => s.id));
    } catch (err) {
      console.error('Failed to load skills:', err);
    } finally {
      setIsLoadingSkills(false);
    }
  };

  const handleToggleSkill = async (skillId: string) => {
    if (!sessionId) return;
    const newEnabled = enabledSkills.includes(skillId)
      ? enabledSkills.filter(id => id !== skillId)
      : [...enabledSkills, skillId];
    
    setEnabledSkills(newEnabled);
    setIsSavingSkills(true);
    try {
      await skills.updateSkills(sessionId, newEnabled);
    } catch (err) {
      console.error('Failed to update skills:', err);
      // Revert on error
      setEnabledSkills(enabledSkills);
    } finally {
      setIsSavingSkills(false);
    }
  };

  const handleAddMcpServer = async () => {
    if (!sessionId || !newMcpName.trim() || !newMcpUrl.trim()) return;
    try {
      const headers: Record<string, string> = {};
      
      if (newMcpAuthType === 'bearer' && newMcpAuthValue.trim()) {
        headers['Authorization'] = `Bearer ${newMcpAuthValue.trim()}`;
      } else if (newMcpAuthType === 'custom' && newMcpCustomHeaderName.trim() && newMcpAuthValue.trim()) {
        headers[newMcpCustomHeaderName.trim()] = newMcpAuthValue.trim();
      }
      
      const { server } = await skills.addMcpServer(sessionId, {
        name: newMcpName.trim(),
        transport: newMcpTransport,
        url: newMcpUrl.trim(),
        ...(Object.keys(headers).length > 0 && { headers }),
      });
      setCustomMcpServers(prev => [...prev, server]);
      setNewMcpName('');
      setNewMcpUrl('');
      setNewMcpAuthType('none');
      setNewMcpAuthValue('');
      setNewMcpCustomHeaderName('');
    } catch (err) {
      console.error('Failed to add MCP server:', err);
    }
  };

  const handleRemoveMcpServer = async (serverId: string) => {
    if (!sessionId) return;
    try {
      await skills.removeMcpServer(sessionId, serverId);
      setCustomMcpServers(prev => prev.filter(s => s.id !== serverId));
      setMcpTestResults(prev => {
        const newResults = { ...prev };
        delete newResults[serverId];
        return newResults;
      });
    } catch (err) {
      console.error('Failed to remove MCP server:', err);
    }
  };

  const handleTestMcpServer = async (serverId: string) => {
    if (!sessionId) return;
    setTestingMcpServer(serverId);
    try {
      const result = await skills.testMcpServer(sessionId, serverId);
      setMcpTestResults(prev => ({
        ...prev,
        [serverId]: result,
      }));
    } catch (err) {
      setMcpTestResults(prev => ({
        ...prev,
        [serverId]: { success: false, error: (err as Error).message },
      }));
    } finally {
      setTestingMcpServer(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'mcp' && sessionId) {
      loadSkills();
    }
  }, [activeTab, sessionId]);

  // Helper function to get skill icon
  const getSkillIcon = (icon: string) => {
    const icons: Record<string, string> = {
      folder: '📁',
      brain: '🧠',
      'list-ordered': '📋',
      puzzle: '🧩',
      search: '🔍',
      database: '🗄️',
      code: '💻',
      globe: '🌐',
    };
    return icons[icon] || '⚡';
  };

  // Load portal users when users sub-tab is active
  const loadPortalUsers = async () => {
    if (!sessionId) return;
    setIsLoadingPortalUsers(true);
    try {
      const [usersData, stats] = await Promise.all([
        agentUsers.getUsers(sessionId),
        agentUsers.getStats(sessionId),
      ]);
      setPortalUsers(usersData.users);
      setPortalStats(stats);
    } catch (err) {
      console.error('Failed to load portal users:', err);
    } finally {
      setIsLoadingPortalUsers(false);
    }
  };

  // Load active skills for portal-sandbox agents
  const loadActiveSkills = async () => {
    if (!sessionId || !isPortalSandboxAgent) return;
    try {
      const { buckets: agentBuckets } = await files.getAgentBuckets(sessionId);
      const skillsBucket = agentBuckets.find((b: any) => b.bucket_name?.includes(' - Skills') || b.bucket_name?.includes('_skills'));
      if (!skillsBucket) return;

      const res = await fetch(`/api/files/buckets/${skillsBucket.bucket_id}/files?path=/`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const skillFiles = data.files
          .filter((f: any) => !f.is_folder && (f.name.endsWith('.md') || f.name.endsWith('.mdc')))
          .map((f: any) => ({
            id: f.id,
            name: f.name,
            friendlyName: f.friendly_name || f.name.replace(/\.(md|mdc)$/i, '').replace(/[-_]/g, ' ')
          }));
        setActiveSkills(skillFiles);
      }
    } catch (err) {
      console.error('Failed to load active skills:', err);
    }
  };

  // Load API and SDK runs
  const loadRuns = async () => {
    if (!sessionId) return;
    setIsLoadingRuns(true);
    try {
      const { runs } = await runsApi.list(sessionId, 100, 0);
      
      // Filter runs: API runs have no sdk_session_id, SDK runs have sdk_session_id
      const apiRunsList = runs.filter(run => !run.sdk_session_id);
      const sdkRunsList = runs.filter(run => run.sdk_session_id);
      
      setApiRuns(apiRunsList);
      setSdkRuns(sdkRunsList);
    } catch (err) {
      console.error('Failed to load runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  };

  const loadPortalUserThreads = async (user: typeof selectedPortalUser) => {
    if (!user || !sessionId) return;
    setSelectedPortalUser(user);
    setSelectedPortalThread(null);
    setPortalThreadMessages([]);
    setIsLoadingPortalThreads(true);
    try {
      const { threads } = await agentUsers.getThreads(sessionId, user.id, user.type);
      setPortalUserThreads(threads);
    } catch (err) {
      console.error('Failed to load threads:', err);
    } finally {
      setIsLoadingPortalThreads(false);
    }
  };

  const loadPortalThreadMessages = async (thread: typeof selectedPortalThread) => {
    if (!thread || !selectedPortalUser || !sessionId) return;
    setSelectedPortalThread(thread);
    setIsLoadingPortalMessages(true);
    try {
      const { messages } = await agentUsers.getMessages(sessionId, selectedPortalUser.id, thread.id, selectedPortalUser.type);
      setPortalThreadMessages(messages);
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setIsLoadingPortalMessages(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'portal' && portalSubTab === 'users' && sessionId) {
      loadPortalUsers();
    }
    // Load skills when Skills sub-tab is active
    if (activeTab === 'portal' && portalSubTab === 'skills' && sessionId && isPortalSandboxAgent) {
      loadActiveSkills();
    }
    // Also load portal users when in Executions -> Portal tab
    if (activeTab === 'executions' && executionsSubTab === 'portal' && sessionId) {
      loadPortalUsers();
    }
    // Load portal users for portal agent Executions tab (no sub-tabs)
    if (activeTab === 'executions' && (config?.agent_type === 'portal' || config?.agent_type === 'portal-sandbox') && sessionId) {
      loadPortalUsers();
    }
    // Load runs when in Executions -> API or SDK tab
    if (activeTab === 'executions' && (executionsSubTab === 'api' || executionsSubTab === 'sdk') && sessionId) {
      loadRuns();
    }
  }, [activeTab, portalSubTab, executionsSubTab, sessionId]);

  const handleTogglePortal = async () => {
    if (!sessionId) return;
    setIsTogglingPortal(true);
    try {
      const newValue = !portalEnabled;
      await agentConfig.update(sessionId, { portal_enabled: newValue ? 1 : 0 });
      setPortalEnabled(newValue);
    } catch (err) {
      console.error('Failed to toggle portal:', err);
    } finally {
      setIsTogglingPortal(false);
    }
  };

  const handleStartSandbox = async () => {
    setIsStartingSandbox(true);
    setError('');
    try {
      await agent.startSandbox(sessionId!);
      // Force refresh session state with cache-busting
      const { session: updatedSession, tasks: t } = await sessions.get(sessionId!);
      setSession(updatedSession);
      setTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setIsStartingSandbox(false);
    }
  };

  const handleCloseSandbox = async () => {
    // Stop directly without confirmation
    try {
      await agent.stopSandbox(sessionId!);
      // Force refresh session state
      const { session: updatedSession, tasks: t } = await sessions.get(sessionId!);
      setSession(updatedSession);
      setTasks(t);
    } catch {
      setError('Failed to close');
    }
  };

  const [isResettingSandbox, setIsResettingSandbox] = useState(false);
  
  const handleResetSandbox = async () => {
    // Reset sandbox (destroy and recreate)
    setIsResettingSandbox(true);
    setError('');
    try {
      await agent.resetSandbox(sessionId!);
      // Force refresh session state
      const { session: updatedSession, tasks: t } = await sessions.get(sessionId!);
      setSession(updatedSession);
      setTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset sandbox');
    } finally {
      setIsResettingSandbox(false);
    }
  };

  const handleExecutePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    // For task agents, start sandbox automatically if needed
    if (session?.status !== 'active') {
      setIsStartingSandbox(true);
      setError('');
      try {
        await agent.startSandbox(sessionId!);
        await loadSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start agent');
        setIsStartingSandbox(false);
        return;
      }
      setIsStartingSandbox(false);
    }

    setIsRunningTask(true);
    setError('');
    setStreamingOutput([]);
    setRunStartTime(Date.now());

    const tempUserMsg: Message = {
      id: 'temp-' + Date.now(),
      task_id: 'temp',
      role: 'user',
      content: prompt,
      created_at: new Date().toISOString(),
    };
    setAllMessages(prev => [...prev, tempUserMsg]);
    const sentPrompt = prompt;
    setPrompt('');

    try {
      const { task } = await agent.createTask(sessionId!, sentPrompt);
      
      setAllMessages(prev => prev.map(m => 
        m.id === tempUserMsg.id ? { ...m, task_id: task.id, id: 'user-' + task.id } : m
      ));

      await agent.runTask(sessionId!, task.id);

      const runningTask = { ...task, status: 'running' as const };
      setCurrentTask(runningTask);
      setTasks(prev => [...prev, runningTask]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run task');
      setIsRunningTask(false);
      setAllMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    }
  };

  const handlePush = async () => {
    try {
      await agent.push(sessionId!);
      setModal({
        isOpen: true,
        title: 'Success',
        message: 'Changes pushed successfully!',
        type: 'alert',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to push');
    }
  };

  const clearOutput = () => {
    setStreamingOutput([]);
    setCurrentTask(null);
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-slate-500 dark:text-slate-400">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-red-400">Agent not found</p>
      </div>
    );
  }

  const getProviderLabel = () => {
    switch (session.agent_provider) {
      case 'aider': return 'Aider';
      case 'opencode': return session.agent_model 
        ? `OpenCode (${session.agent_model.split('/').pop()})` 
        : 'OpenCode';
      default: return 'Claude Code';
    }
  };

  // Portal Agent — wizard takeover when not completed
  if ((isPortalAgent || isPortalSandboxAgent) && showWizard) {
    const WizardComponent = isPortalSandboxAgent ? PortalSandboxAgentWizard : PortalAgentWizard;
    return (
      <div className="h-[calc(100vh-4rem)] bg-white dark:bg-slate-900 overflow-y-auto">
        <div className="p-6">
          <WizardComponent
            sessionId={sessionId!}
            config={config}
            onComplete={() => {
              agentConfig.get(sessionId!).then(({ config: c }) => setConfig(c));
              setActiveTab('portal');
            }}
            onConfigUpdate={(updated) => setConfig(updated)}
          />
        </div>
      </div>
    );
  }

  // Portal Agent or Portal-Sandbox Agent — post-wizard (show in simplified layout)
  if (isPortalAgent || isPortalSandboxAgent) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div>
              <h1 className="font-medium">{config?.name || session.repo_name}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Portal Agent
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigate('/agents')}
                className="border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-4 py-1.5 rounded text-sm hover:border-gray-600 hover:text-slate-900 dark:text-white"
              >
                Back
              </button>
            </div>
          </div>
          
          {/* Tabs */}
          <div className="max-w-4xl mx-auto flex gap-6 mt-4">
            <button
              onClick={() => setActiveTab('config')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'config'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Configure
            </button>
            {/* <button
              onClick={() => setActiveTab('portal')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'portal'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Portal
            </button> */}
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'knowledge'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Knowledge
            </button>
            <button
              onClick={() => setActiveTab('mcp')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'mcp'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              MCP
            </button>
            <button
              onClick={() => setActiveTab('executions')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'executions'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Executions
            </button>
          </div>
        </div>

        {/* Config tab for portal agent */}
        {activeTab === 'config' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto">
              <AgentConfig sessionId={sessionId!} model={session?.agent_model} agentType={session?.agent_type} />
            </div>
          </div>
        )}

        {/* Portal tab reuses the same portal tab content from task agent */}
        {activeTab === 'portal' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              {/* Sub-tabs for portal configuration */}
              <div className="flex gap-6 border-b border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setPortalSubTab('settings')}
                  className={`pb-2 text-sm border-b-2 transition-colors ${
                    portalSubTab === 'settings'
                      ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  Settings
                </button>
                {isPortalSandboxAgent && (
                  <button
                    onClick={() => setPortalSubTab('skills')}
                    className={`pb-2 text-sm border-b-2 transition-colors ${
                      portalSubTab === 'skills'
                        ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                    }`}
                  >
                    Skills
                  </button>
                )}
                <button
                  onClick={() => setPortalSubTab('customize')}
                  className={`pb-2 text-sm border-b-2 transition-colors ${
                    portalSubTab === 'customize'
                      ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  Customize
                </button>
                <button
                  onClick={() => setPortalSubTab('css')}
                  className={`pb-2 text-sm border-b-2 transition-colors ${
                    portalSubTab === 'css'
                      ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  Custom CSS
                </button>
              </div>

              {/* Settings Sub-tab - Portal URL */}
              {portalSubTab === 'settings' && (
                <div>
                  <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Portal URL</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                    Claude Desktop-style chat with thinking, tool activity, and streaming.
                  </p>
                  <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/${isPortalSandboxAgent ? 'portal-sandbox-agent' : 'portal-agent'}/${sessionId}`}
                    className="flex-1 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-sm font-mono"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/${isPortalSandboxAgent ? 'portal-sandbox-agent' : 'portal-agent'}/${sessionId}`);
                      setCopied('portal-url');
                      setTimeout(() => setCopied(null), 2000);
                    }}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                      copied === 'portal-url'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-800 dark:bg-indigo-600 text-white hover:bg-slate-900 dark:hover:bg-indigo-700'
                    }`}
                  >
                    {copied === 'portal-url' ? 'Copied!' : 'Copy'}
                  </button>
                  <a
                    href={`/${isPortalSandboxAgent ? 'portal-sandbox-agent' : 'portal-agent'}/${sessionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-white dark:bg-slate-800 text-sm"
                  >
                    Open
                  </a>
                  </div>
                </div>
              )}

              {/* Skills Sub-tab - Show uploaded custom skills (portal-sandbox only) */}
              {portalSubTab === 'skills' && isPortalSandboxAgent && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Active Skills</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Custom instruction files uploaded during setup. These skills are automatically injected into the agent's sandbox environment.
                    </p>
                  </div>

                  {activeSkills.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                      <svg className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-slate-500 dark:text-slate-400 text-sm">No skills uploaded yet</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Upload skill files during the setup wizard</p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {activeSkills.map((skill) => (
                        <div
                          key={skill.id}
                          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-purple-500/50 transition-colors"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center">
                              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-slate-900 dark:text-white mb-1">{skill.friendlyName}</h4>
                              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{skill.name}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium rounded-full">
                                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                  Active
                                </span>
                                <span className="text-xs text-slate-400">Injected on sandbox startup</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">How Skills Work</p>
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                          Skills are automatically detected and injected into CLAUDE.md when the sandbox starts. The agent references these instructions throughout its execution.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Customize Sub-tab - Full customization from task agents */}
              {portalSubTab === 'customize' && (
                <>
                  {portalConfigMessage && (
                    <div className={`px-4 py-2 rounded text-sm ${
                      portalConfigMessage.includes('Failed') 
                        ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400'
                        : 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/50 text-green-700 dark:text-green-400'
                    }`}>
                      {portalConfigMessage}
                    </div>
                  )}

                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-semibold mb-2">Portal Appearance</h2>
                      <p className="text-slate-500 dark:text-slate-400 text-sm">
                        Customize the look and feel of your agent's public portal.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setPortalPrimaryColor('#3b5998');
                        setPortalBackgroundColor('#0f0f0f');
                        setPortalAccentColor('#1e1e2e');
                        setPortalTextColor('#ffffff');
                        setPortalButtonColor('#3b5998');
                        setPortalFontFamily('system');
                        setPortalName('');
                        setPortalGreeting('');
                        setInsightsPortalGreeting('');
                        setSuggestedQuestions([]);
                      }}
                      className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                    >
                      Reset to Defaults
                    </button>
                  </div>

                  {/* AI Website Style Matcher */}
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-6 mb-6">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                          AI Website Style Matcher
                        </h3>
                        <p className="text-purple-700 dark:text-purple-300 text-sm mb-4">
                          Enter any website URL and our AI will automatically extract its design system and style your portal to match.
                        </p>
                        <button
                          onClick={() => navigate(`/agents/${sessionId}/customize-portal`)}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors text-sm"
                        >
                          Open Style Matcher
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Logo Upload */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Logo</h3>
                    <div className="flex items-start gap-4">
                      {portalLogoUrl ? (
                        <div className="relative">
                          <img
                            src={portalLogoUrl}
                            alt="Portal logo"
                            className="h-16 w-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50"
                          />
                          <button
                            onClick={async () => {
                              try {
                                await agentConfig.deleteLogo(sessionId!);
                                setPortalLogoUrl(null);
                                setPortalConfigMessage('Logo removed!');
                                setTimeout(() => setPortalConfigMessage(''), 3000);
                              } catch (err) {
                                setPortalConfigMessage('Failed to remove logo');
                              }
                            }}
                            className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full text-slate-900 dark:text-white hover:bg-red-400"
                            title="Remove logo"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded border border-dashed border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/30 flex items-center justify-center text-slate-500 dark:text-slate-400">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      <div>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setIsUploadingLogo(true);
                            try {
                              const result = await agentConfig.uploadLogo(sessionId!, file);
                              const cacheBust = `v=${Date.now()}`;
                              setPortalLogoUrl(`${result.logoUrl}${result.logoUrl.includes('?') ? '&' : '?'}${cacheBust}`);
                              setPortalConfigMessage('Logo uploaded!');
                              setTimeout(() => setPortalConfigMessage(''), 3000);
                            } catch (err: any) {
                              setPortalConfigMessage(err.message || 'Failed to upload logo');
                            } finally {
                              setIsUploadingLogo(false);
                              if (logoInputRef.current) logoInputRef.current.value = '';
                            }
                          }}
                        />
                        <button
                          onClick={() => logoInputRef.current?.click()}
                          disabled={isUploadingLogo}
                          className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                        >
                          {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">PNG, JPG, GIF, WebP, or SVG. Max 10MB.</p>
                      </div>
                    </div>
                  </div>

                  {/* Quick Theme Templates */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Quick Theme Templates</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Apply a pre-built theme to quickly style your portal. Themes are saved automatically.
                    </p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Professional Light */}
                      <button
                        onClick={async () => {
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, { portal_custom_css: '/* Professional Light Theme */\n.portal-container { background: #f8f9fa !important; }\n.portal-sidebar { background: #ffffff !important; border-right: 1px solid #e9ecef !important; box-shadow: 2px 0 8px rgba(0,0,0,0.04) !important; }\n.portal-header { background: #ffffff !important; border-bottom: 1px solid #e9ecef !important; }\n.portal-title { color: #1a1a1a !important; }\n.new-thread-button { background: #6366f1 !important; color: white !important; border-radius: 8px !important; }\n.new-thread-button:hover { background: #6d28d9 !important; }\n.thread-item { color: #4b5563 !important; border-radius: 8px !important; }\n.thread-item:hover { background: #f3f4f6 !important; color: #1a1a1a !important; }\n.thread-active { background: #ede9fe !important; color: #6366f1 !important; border-left: 3px solid #6366f1 !important; }\n.portal-main { background: #f8f9fa !important; }\n.portal-topbar { background: #ffffff !important; border-bottom: 1px solid #e9ecef !important; }\n.chat-container { background: #f8f9fa !important; }\n.message-user .message-content { background: #6366f1 !important; color: white !important; border-radius: 16px !important; border-top-right-radius: 4px !important; }\n.message-assistant .message-content { background: #ffffff !important; color: #1a1a1a !important; border: 1px solid #e9ecef !important; border-radius: 16px !important; border-top-left-radius: 4px !important; }\n.input-container { background: #ffffff !important; border-top: 1px solid #e9ecef !important; }\n.input-field { background: #ffffff !important; border: 1.5px solid #d1d5db !important; border-radius: 12px !important; color: #1a1a1a !important; }\n.input-field:focus { border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(124,58,237,0.1) !important; }\n.send-button { background: #6366f1 !important; border-radius: 10px !important; }\n.send-button:hover:not(:disabled) { background: #6d28d9 !important; }\n.message-content code { background: #f3f4f6 !important; }\n.message-assistant .message-content code { color: #6366f1 !important; }\n.message-content a { color: #6366f1 !important; }\n.portal-container ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }' });
                            setCustomCSS('/* Professional Light Theme applied */');
                            setPortalConfigMessage('Professional Light theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-purple-500 dark:hover:border-purple-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-500/5 dark:to-slate-800"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-purple-600"></div>
                            <div className="font-semibold text-slate-900 dark:text-white">Professional Light</div>
                            <span className="text-[10px] bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">Default</span>
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-400 mb-3">Clean, modern with purple accents</div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-white border border-slate-200"></div>
                            <div className="w-6 h-6 rounded bg-purple-600"></div>
                            <div className="w-6 h-6 rounded bg-slate-100"></div>
                          </div>
                        </div>
                      </button>

                      {/* Modern Dark */}
                      <button
                        onClick={async () => {
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, { portal_custom_css: '/* Modern Dark Theme */\n.portal-container { background: #0f0f0f !important; }\n.portal-sidebar { background: #1a1a1a !important; border-right: 1px solid #2a2a2a !important; }\n.portal-header { background: #1a1a1a !important; border-bottom: 1px solid #2a2a2a !important; }\n.portal-title { color: #ffffff !important; }\n.new-thread-button { background: #3b82f6 !important; color: white !important; border-radius: 8px !important; }\n.new-thread-button:hover { background: #2563eb !important; }\n.thread-item { color: #a0a0a0 !important; border-radius: 6px !important; }\n.thread-item:hover { background: #252525 !important; color: #ffffff !important; }\n.thread-active { background: #3b82f6 !important; color: #ffffff !important; }\n.portal-main { background: #0f0f0f !important; }\n.portal-topbar { background: #1a1a1a !important; border-bottom: 1px solid #2a2a2a !important; color: #a0a0a0 !important; }\n.chat-container { background: #0f0f0f !important; }\n.message-user .message-content { background: #3b82f6 !important; color: white !important; border-radius: 16px !important; border-top-right-radius: 4px !important; }\n.message-assistant .message-content { background: #1a1a1a !important; color: #e5e5e5 !important; border: 1px solid #2a2a2a !important; border-radius: 16px !important; border-top-left-radius: 4px !important; }\n.input-container { background: #1a1a1a !important; border-top: 1px solid #2a2a2a !important; }\n.input-field { background: #0f0f0f !important; border: 1px solid #2a2a2a !important; color: #ffffff !important; border-radius: 12px !important; }\n.input-field:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 2px rgba(59,130,246,0.2) !important; }\n.input-field::placeholder { color: #666666 !important; }\n.send-button { background: #3b82f6 !important; border-radius: 10px !important; }\n.send-button:hover:not(:disabled) { background: #2563eb !important; }\n.message-content code { background: #2a2a2a !important; color: #60a5fa !important; }\n.portal-container ::-webkit-scrollbar-track { background: #0f0f0f; }\n.portal-container ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }\n.portal-container ::-webkit-scrollbar-thumb:hover { background: #3b82f6; }' });
                            setCustomCSS('/* Modern Dark Theme applied */');
                            setPortalConfigMessage('Modern Dark theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                            <div className="font-semibold text-white">Modern Dark</div>
                          </div>
                          <div className="text-xs text-slate-400 mb-3">Sleek, professional dark mode</div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-[#0f0f0f] border border-slate-700"></div>
                            <div className="w-6 h-6 rounded bg-[#1a1a1a] border border-slate-700"></div>
                            <div className="w-6 h-6 rounded bg-blue-500"></div>
                          </div>
                        </div>
                      </button>

                      {/* Neon Glow */}
                      <button
                        onClick={async () => {
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, { portal_custom_css: '/* Neon Glow Theme */\n.portal-container { background: #050505 !important; }\n.portal-sidebar { background: #0a0a0a !important; border-right: 1px solid rgba(139,92,246,0.2) !important; box-shadow: 2px 0 20px rgba(139,92,246,0.1) !important; }\n.portal-header { background: #0a0a0a !important; border-bottom: 1px solid rgba(139,92,246,0.2) !important; }\n.portal-title { color: #c4b5fd !important; text-shadow: 0 0 10px rgba(139,92,246,0.5) !important; }\n.new-thread-button { background: linear-gradient(135deg, #8b5cf6, #d946ef) !important; color: white !important; border-radius: 8px !important; box-shadow: 0 0 20px rgba(139,92,246,0.4) !important; }\n.new-thread-button:hover { box-shadow: 0 0 30px rgba(139,92,246,0.6) !important; transform: translateY(-2px) !important; }\n.thread-item { color: #a0a0a0 !important; border-radius: 6px !important; }\n.thread-item:hover { background: rgba(139,92,246,0.1) !important; color: #c4b5fd !important; }\n.thread-active { background: rgba(139,92,246,0.2) !important; color: #c4b5fd !important; border-left: 3px solid #8b5cf6 !important; }\n.portal-main { background: #050505 !important; }\n.portal-topbar { background: #0a0a0a !important; border-bottom: 1px solid rgba(139,92,246,0.2) !important; color: #a0a0a0 !important; }\n.chat-container { background: #050505 !important; }\n.message-user .message-content { background: linear-gradient(135deg, #8b5cf6, #d946ef) !important; color: white !important; border-radius: 16px !important; border-top-right-radius: 4px !important; box-shadow: 0 0 25px rgba(139,92,246,0.4) !important; }\n.message-assistant .message-content { background: #0a0a0a !important; color: #e5e5e5 !important; border: 1px solid rgba(139,92,246,0.3) !important; border-radius: 16px !important; border-top-left-radius: 4px !important; box-shadow: 0 0 15px rgba(139,92,246,0.15) !important; }\n.input-container { background: #0a0a0a !important; border-top: 1px solid rgba(139,92,246,0.2) !important; }\n.input-field { background: #050505 !important; border: 1px solid rgba(139,92,246,0.3) !important; color: #ffffff !important; border-radius: 12px !important; }\n.input-field:focus { border-color: #8b5cf6 !important; box-shadow: 0 0 20px rgba(139,92,246,0.3) !important; }\n.send-button { background: linear-gradient(135deg, #8b5cf6, #d946ef) !important; border-radius: 10px !important; box-shadow: 0 0 20px rgba(139,92,246,0.4) !important; }\n.send-button:hover:not(:disabled) { box-shadow: 0 0 35px rgba(139,92,246,0.6) !important; }\n.message-content code { background: rgba(139,92,246,0.2) !important; color: #c4b5fd !important; border: 1px solid rgba(139,92,246,0.3) !important; }\n.message-content a { color: #c4b5fd !important; }\n.portal-container ::-webkit-scrollbar-track { background: #050505; }\n.portal-container ::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.3); border-radius: 4px; }\n.portal-container ::-webkit-scrollbar-thumb:hover { background: #8b5cf6; }' });
                            setCustomCSS('/* Neon Glow Theme applied */');
                            setPortalConfigMessage('Neon Glow theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-purple-500 dark:hover:border-purple-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/50 to-pink-900/50"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 shadow-[0_0_10px_rgba(139,92,246,0.5)]"></div>
                            <div className="font-semibold text-white">Neon Glow</div>
                          </div>
                          <div className="text-xs text-purple-300 mb-3">Vibrant cyberpunk with glow effects</div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-[#050505] border border-purple-500/30"></div>
                            <div className="w-6 h-6 rounded bg-gradient-to-r from-purple-500 to-pink-500"></div>
                            <div className="w-6 h-6 rounded bg-purple-500/20 border border-purple-500/30"></div>
                          </div>
                        </div>
                      </button>

                      {/* CX Analytics */}
                      <button
                        onClick={async () => {
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, { portal_custom_css: '/* CX Analytics Theme */\n.portal-container { background: #f6f8fc !important; font-family: Inter, -apple-system, sans-serif !important; }\n.portal-sidebar { background: #ffffff !important; border-right: 1px solid #e2e8f0 !important; }\n.portal-header { background: #ffffff !important; border-bottom: 1px solid #e2e8f0 !important; }\n.portal-title { color: #1a1f36 !important; font-weight: 600 !important; }\n.new-thread-button { background: #c5f467 !important; color: #1a1f36 !important; border-radius: 8px !important; font-weight: 600 !important; }\n.new-thread-button:hover { background: #b8e85a !important; }\n.thread-item { color: #64748b !important; border-radius: 8px !important; }\n.thread-item:hover { background: #f1f5f9 !important; color: #1a1f36 !important; }\n.thread-active { background: #e8f4fc !important; color: #1a1f36 !important; border-left: 3px solid #3b82f6 !important; }\n.portal-main { background: #f6f8fc !important; }\n.portal-topbar { background: #ffffff !important; border-bottom: 1px solid #e2e8f0 !important; color: #64748b !important; }\n.chat-container { background: #f6f8fc !important; }\n.message-user .message-content { background: #3b82f6 !important; color: white !important; border-radius: 16px !important; border-top-right-radius: 4px !important; }\n.message-assistant .message-content { background: #ffffff !important; color: #1a1f36 !important; border: 1px solid #e2e8f0 !important; border-radius: 16px !important; border-top-left-radius: 4px !important; }\n.input-container { background: #ffffff !important; border-top: 1px solid #e2e8f0 !important; }\n.input-field { background: #ffffff !important; border: 1.5px solid #e2e8f0 !important; border-radius: 10px !important; color: #1a1f36 !important; }\n.input-field:focus { border-color: #3b82f6 !important; box-shadow: 0 0 0 3px rgba(59,130,246,0.1) !important; }\n.send-button { background: #3b82f6 !important; border-radius: 8px !important; }\n.send-button:hover:not(:disabled) { background: #2563eb !important; }\n.send-button:disabled { background: #cbd5e1 !important; }\n.message-content code { background: #f1f5f9 !important; color: #1a1f36 !important; }\n.message-content a { color: #3b82f6 !important; font-weight: 500 !important; }\n.message-content blockquote { border-left: 3px solid #c5f467 !important; }\n.portal-container ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }\n.portal-container ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }' });
                            setCustomCSS('/* CX Analytics Theme applied */');
                            setPortalConfigMessage('CX Analytics theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-lime-500 dark:hover:border-lime-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-blue-50"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-[#c5f467]"></div>
                            <div className="font-semibold text-slate-800">CX Analytics</div>
                          </div>
                          <div className="text-xs text-slate-600 mb-3">Clean, modern with lime accent</div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-white border border-slate-200"></div>
                            <div className="w-6 h-6 rounded bg-[#1a1f36]"></div>
                            <div className="w-6 h-6 rounded bg-[#c5f467]"></div>
                          </div>
                        </div>
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
                      Themes are applied instantly. Switch to the <strong>Custom CSS</strong> tab to view or customize the code.
                    </p>
                  </div>

                  {/* Portal Name */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Portal Name</h3>
                    <input
                      type="text"
                      value={portalName}
                      onChange={(e) => setPortalName(e.target.value)}
                      placeholder={config?.name || 'AI Assistant'}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      Custom name displayed in the portal. Leave empty to use the agent name.
                    </p>
                  </div>

                  {/* Greeting & Suggested Questions */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Portal Settings</h3>

                    {/* Custom Greeting */}
                    <div className="mb-4">
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-2">
                        Portal Greeting
                      </label>
                      <input
                        type="text"
                        value={insightsPortalGreeting}
                        onChange={(e) => setInsightsPortalGreeting(e.target.value)}
                        placeholder="Hey there, I'm {name}"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Use {'{name}'} as placeholder for the portal name.
                      </p>
                    </div>

                    {/* Suggested Questions */}
                    <div>
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-2">
                        Suggested Questions
                      </label>
                      <div className="space-y-2">
                        {suggestedQuestions.map((q, idx) => (
                          <div key={idx} className="flex gap-2">
                            <input
                              type="text"
                              value={q}
                              onChange={(e) => {
                                const updated = [...suggestedQuestions];
                                updated[idx] = e.target.value;
                                setSuggestedQuestions(updated);
                              }}
                              placeholder={`Question ${idx + 1}`}
                              className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setSuggestedQuestions(suggestedQuestions.filter((_, i) => i !== idx))}
                              className="px-2 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        {suggestedQuestions.length < 6 && (
                          <button
                            type="button"
                            onClick={() => setSuggestedQuestions([...suggestedQuestions, ''])}
                            className="w-full px-3 py-2 border border-dashed border-slate-300 dark:border-slate-600 rounded text-sm text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                          >
                            + Add suggested question
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Custom questions shown to users when they first open the portal.
                      </p>
                    </div>
                  </div>

                  {/* Theme Colors */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Theme Colors</h3>
                    <div className="grid grid-cols-3 gap-6 mb-6">
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Background</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portalBackgroundColor} onChange={(e) => setPortalBackgroundColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent" />
                          <input type="text" value={portalBackgroundColor} onChange={(e) => setPortalBackgroundColor(e.target.value)} className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Sidebar/Accent</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portalAccentColor} onChange={(e) => setPortalAccentColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent" />
                          <input type="text" value={portalAccentColor} onChange={(e) => setPortalAccentColor(e.target.value)} className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Text Color</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portalTextColor} onChange={(e) => setPortalTextColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent" />
                          <input type="text" value={portalTextColor} onChange={(e) => setPortalTextColor(e.target.value)} className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white" />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-6">
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Primary/Message</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portalPrimaryColor} onChange={(e) => setPortalPrimaryColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent" />
                          <input type="text" value={portalPrimaryColor} onChange={(e) => setPortalPrimaryColor(e.target.value)} className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Button Color</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portalButtonColor} onChange={(e) => setPortalButtonColor(e.target.value)} className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent" />
                          <input type="text" value={portalButtonColor} onChange={(e) => setPortalButtonColor(e.target.value)} className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        setIsSavingPortalConfig(true);
                        setPortalConfigMessage('');
                        try {
                          const portalTheme: PortalTheme = {
                            primaryColor: portalPrimaryColor,
                            backgroundColor: portalBackgroundColor,
                            accentColor: portalAccentColor,
                            textColor: portalTextColor,
                            buttonColor: portalButtonColor,
                            fontFamily: portalFontFamily,
                          };
                          const updatePayload: any = {
                            embed_theme: JSON.stringify(portalTheme),
                            embed_greeting: portalGreeting || null,
                            portal_name: portalName || null,
                            portal_greeting: insightsPortalGreeting.trim() === '' ? null : insightsPortalGreeting,
                            portal_suggested_questions: suggestedQuestions.filter(q => q.trim() !== '').length > 0 
                              ? suggestedQuestions.filter(q => q.trim() !== '') 
                              : null,
                          };
                          console.log('[Portal Agent Settings] Saving:', updatePayload);
                          await agentConfig.update(sessionId!, updatePayload);
                          setPortalConfigMessage('Portal settings saved!');
                          setTimeout(() => setPortalConfigMessage(''), 3000);
                        } catch (err) {
                          setPortalConfigMessage('Failed to save portal settings');
                        } finally {
                          setIsSavingPortalConfig(false);
                        }
                      }}
                      disabled={isSavingPortalConfig}
                      className="px-6 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                    >
                      {isSavingPortalConfig ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}

              {/* Custom CSS Sub-tab */}
              {portalSubTab === 'css' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Custom CSS</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Add custom CSS to further customize your portal's appearance.
                    </p>
                  </div>
                  
                  <textarea
                    value={customCSS}
                    onChange={(e) => setCustomCSS(e.target.value)}
                    placeholder="/* Enter custom CSS here... */"
                    className="w-full h-96 px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded text-sm font-mono resize-none"
                  />
                  
                  <button
                    onClick={async () => {
                      setIsSavingPortalConfig(true);
                      try {
                        await agentConfig.update(sessionId!, {
                          portal_custom_css: customCSS,
                        });
                        setPortalConfigMessage('Custom CSS saved successfully!');
                        setTimeout(() => setPortalConfigMessage(''), 3000);
                      } catch (err: any) {
                        setPortalConfigMessage('Failed to save custom CSS');
                      } finally {
                        setIsSavingPortalConfig(false);
                      }
                    }}
                    disabled={isSavingPortalConfig}
                    className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                  >
                    {isSavingPortalConfig ? 'Saving...' : 'Save Custom CSS'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Knowledge Tab - full KB management */}
        {activeTab === 'knowledge' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-2">Knowledge Bases</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Attach knowledge bases to enable RAG (Retrieval-Augmented Generation). 
                  The agent will automatically search relevant documents when responding.
                </p>
              </div>

              {isLoadingKnowledge ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading knowledge bases...</div>
              ) : (
                <>
                  {/* Attached Knowledge Bases */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Attached Knowledge Bases</h3>
                    {attachedKnowledgeBases.length === 0 ? (
                      <p className="text-slate-500 dark:text-slate-400 text-sm">No knowledge bases attached to this agent.</p>
                    ) : (
                      <div className="space-y-3">
                        {attachedKnowledgeBases.map(kb => (
                          <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{kb.name}</span>
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  kb.status === 'ready' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                  kb.status === 'indexing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                  'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400'
                                }`}>
                                  {kb.status}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {kb.indexed_files} files &bull; {kb.indexed_chunks} chunks
                              </div>
                            </div>
                            <button
                              onClick={() => handleDetachKnowledgeBase(kb.id)}
                              className="px-3 py-1.5 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                            >
                              Detach
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Available Knowledge Bases */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Available Knowledge Bases</h3>
                    {allKnowledgeBases.filter(kb => !attachedKnowledgeBases.some(akb => akb.id === kb.id)).length === 0 ? (
                      <div className="text-center py-4">
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">No additional knowledge bases available.</p>
                        <a href="/knowledge" className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
                          Create a knowledge base &rarr;
                        </a>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {allKnowledgeBases
                          .filter(kb => !attachedKnowledgeBases.some(akb => akb.id === kb.id))
                          .map(kb => (
                            <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{kb.name}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs ${
                                    kb.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                                    kb.status === 'indexing' ? 'bg-blue-500/20 text-blue-400' :
                                    'bg-gray-500/20 text-slate-500 dark:text-slate-400'
                                  }`}>
                                    {kb.status}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  {kb.indexed_files} files &bull; {kb.indexed_chunks} chunks
                                </div>
                              </div>
                              <button
                                onClick={() => handleAttachKnowledgeBase(kb.id)}
                                disabled={kb.status !== 'ready'}
                                className="px-3 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Attach
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* How RAG Works */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-2">How RAG Works</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      When this agent receives a message, it will:
                    </p>
                    <ol className="text-sm text-slate-500 dark:text-slate-400 mt-2 space-y-1 list-decimal list-inside">
                      <li>Search attached knowledge bases for relevant content</li>
                      <li>Inject the most relevant chunks into the context</li>
                      <li>Generate a response informed by your documents</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* MCP Tab - Portal Agent */}
        {activeTab === 'mcp' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">MCP Configuration</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Connect to MCP (Model Context Protocol) servers for custom integrations.
                </p>
              </div>

              {isLoadingSkills ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading...</div>
              ) : (
                <>
                  {/* Custom MCP Servers */}
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <span>🔌</span> Custom MCP Servers
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                      Connect to your own MCP servers for custom integrations.
                    </p>

                    {/* Existing custom servers */}
                    {customMcpServers.length > 0 && (
                      <div className="space-y-2 mb-4">
                        {customMcpServers.map((server) => {
                          const testResult = mcpTestResults[server.id];
                          return (
                            <div
                              key={server.id}
                              className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{server.name}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                    {server.transport || 'SSE'}
                                  </span>
                                  {server.status === 'connected' && (
                                    <span className="text-xs text-green-700 dark:text-green-400">● Connected</span>
                                  )}
                                  {server.status === 'error' && (
                                    <span className="text-xs text-red-700 dark:text-red-400">⚠️ Error</span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
                                  {server.url}
                                </p>
                                {testResult?.success && testResult.tools && (
                                  <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                                    ✓ {testResult.tools.length} tools available
                                  </p>
                                )}
                                {testResult && !testResult.success && (
                                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">{testResult.error}</p>
                                )}
                                {server.error && !testResult && (
                                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">{server.error}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleTestMcpServer(server.id)}
                                  disabled={testingMcpServer === server.id}
                                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white disabled:opacity-50"
                                >
                                  {testingMcpServer === server.id ? 'Testing...' : 'Test'}
                                </button>
                                <button
                                  onClick={() => handleRemoveMcpServer(server.id)}
                                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add new MCP server */}
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                      <h4 className="text-sm font-medium">Add MCP Server</h4>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name</label>
                          <input
                            type="text"
                            value={newMcpName}
                            onChange={(e) => setNewMcpName(e.target.value)}
                            placeholder="My Custom Server"
                            autoComplete="off"
                            data-lpignore="true"
                            data-1p-ignore
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Transport</label>
                          <select
                            value={newMcpTransport}
                            onChange={(e) => setNewMcpTransport(e.target.value as 'sse' | 'streamable-http')}
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white focus:border-white/30 focus:outline-none"
                          >
                            <option value="streamable-http">Streamable HTTP (recommended)</option>
                            <option value="sse">SSE (legacy)</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Server URL</label>
                        <input
                          type="text"
                          value={newMcpUrl}
                          onChange={(e) => setNewMcpUrl(e.target.value)}
                          placeholder="https://server.smithery.ai/@org/server"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none"
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">MCP server endpoint URL from Smithery, mcp.run, or your own server</p>
                      </div>

                      {/* Authentication */}
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Authentication <span className="text-slate-500 dark:text-slate-400/50">(optional)</span></label>
                        <div className="flex gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() => setNewMcpAuthType('none')}
                            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                              newMcpAuthType === 'none'
                                ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white'
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                            }`}
                          >
                            None
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewMcpAuthType('bearer')}
                            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                              newMcpAuthType === 'bearer'
                                ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white'
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                            }`}
                          >
                            Bearer Token
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewMcpAuthType('custom')}
                            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                              newMcpAuthType === 'custom'
                                ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white'
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                            }`}
                          >
                            Custom Header
                          </button>
                        </div>

                        {newMcpAuthType === 'bearer' && (
                          <div>
                            <input
                              type="text"
                              value={newMcpAuthValue}
                              onChange={(e) => setNewMcpAuthValue(e.target.value)}
                              placeholder="sk-xxx..."
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none [-webkit-text-security:disc]"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Will be sent as: Authorization: Bearer &lt;token&gt;</p>
                          </div>
                        )}

                        {newMcpAuthType === 'custom' && (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={newMcpCustomHeaderName}
                              onChange={(e) => setNewMcpCustomHeaderName(e.target.value)}
                              placeholder="Header name (e.g., X-Subscription-Token)"
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none"
                            />
                            <input
                              type="text"
                              value={newMcpAuthValue}
                              onChange={(e) => setNewMcpAuthValue(e.target.value)}
                              placeholder="Header value"
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none [-webkit-text-security:disc]"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400">Will be sent as: {newMcpCustomHeaderName || 'Header-Name'}: &lt;value&gt;</p>
                          </div>
                        )}

                        {newMcpAuthType === 'none' && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">No authentication required for this server</p>
                        )}
                      </div>

                      <button
                        onClick={handleAddMcpServer}
                        disabled={!newMcpName.trim() || !newMcpUrl.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
                      >
                        Add Server
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded text-sm">
                      <strong>💡 How it works</strong>
                      <ul className="mt-2 ml-4 list-disc text-slate-500 dark:text-slate-400 space-y-1">
                        <li>Custom MCP servers let you connect proprietary tools</li>
                        <li>All MCP tools appear automatically in agent conversations</li>
                        <li>Use the Test button to verify connectivity</li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Executions Tab - Portal Sessions */}
        {activeTab === 'executions' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">Executions</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  View portal sessions and conversations
                </p>
              </div>

              {/* Portal Sessions */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-medium">Portal Sessions</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Users who have interacted with this portal agent</p>
                  </div>
                  <button
                    onClick={loadPortalUsers}
                    className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                  >
                    Refresh
                  </button>
                </div>

                {isLoadingPortalUsers ? (
                  <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading portal sessions...</div>
                ) : portalUsers.length === 0 ? (
                  <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                    <div className="text-4xl mb-4">💬</div>
                    <div className="text-lg font-medium mb-2">No portal sessions yet</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Sessions will appear here when users interact with your portal
                    </div>
                  </div>
                ) : selectedPortalUser ? (
                  /* User Detail View */
                  <div className="space-y-4">
                    <button
                      onClick={() => { setSelectedPortalUser(null); setSelectedPortalThread(null); setPortalUserThreads([]); setPortalThreadMessages([]); }}
                      className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
                    >
                      &larr; Back to sessions
                    </button>

                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center text-indigo-500 font-medium text-lg">
                          {selectedPortalUser.displayName?.[0] || selectedPortalUser.identifier?.[0] || '?'}
                        </div>
                        <div>
                          <div className="font-medium">{selectedPortalUser.displayName || selectedPortalUser.identifier}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {selectedPortalUser.type} &bull; Joined {new Date(selectedPortalUser.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Threads */}
                    {isLoadingPortalThreads ? (
                      <div className="p-4 text-center text-slate-500 dark:text-slate-400">Loading threads...</div>
                    ) : selectedPortalThread ? (
                      /* Thread Messages */
                      <div className="space-y-3">
                        <button
                          onClick={() => { setSelectedPortalThread(null); setPortalThreadMessages([]); }}
                          className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          &larr; Back to threads
                        </button>
                        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                          <h4 className="font-medium mb-3">{selectedPortalThread.title || 'Untitled Thread'}</h4>
                          {isLoadingPortalMessages ? (
                            <div className="text-center py-4 text-slate-500 dark:text-slate-400">Loading messages...</div>
                          ) : (
                            <div className="space-y-3 max-h-96 overflow-y-auto">
                              {portalThreadMessages.map(msg => (
                                <div key={msg.id} className={`p-3 rounded-lg text-sm ${
                                  msg.role === 'user' 
                                    ? 'bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30' 
                                    : 'bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700'
                                }`}>
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{msg.role === 'user' ? 'User' : 'Assistant'}</span>
                                    <span className="text-xs text-slate-400 dark:text-slate-500">{new Date(msg.createdAt).toLocaleTimeString()}</span>
                                  </div>
                                  <div className="whitespace-pre-wrap">{msg.content.substring(0, 500)}{msg.content.length > 500 ? '...' : ''}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Thread List */
                      <div className="space-y-2">
                        {portalUserThreads.length === 0 ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400 p-4">No threads found for this user.</p>
                        ) : portalUserThreads.map(thread => (
                          <button
                            key={thread.id}
                            onClick={() => loadPortalThreadMessages(thread)}
                            className="w-full text-left p-3 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                          >
                            <div className="font-medium text-sm">{thread.title || 'Untitled'}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {thread.messageCount} messages &bull; {new Date(thread.updatedAt).toLocaleDateString()}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* User List */
                  <div className="space-y-2">
                    {portalUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => loadPortalUserThreads(user)}
                        className="w-full text-left p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center text-indigo-500 font-medium">
                            {user.displayName?.[0] || user.identifier?.[0] || '?'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{user.displayName || user.identifier}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {user.type} &bull; {new Date(user.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Stats */}
              {portalStats && (
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{portalStats.totalUsers}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Total Users</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{portalStats.portalUsers}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Portal Users</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{portalStats.totalThreads}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Threads</div>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{portalStats.totalMessages}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Messages</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Task Agent UI - API/SDK Preview
  if (isTaskAgent) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div>
              <h1 className="font-medium">{session.repo_name}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Task Agent · <span className="text-slate-500 dark:text-slate-400">{getProviderLabel()}</span>
                {session.status === 'active' && (
                  <span className="ml-2 inline-flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                    <span className={isConnected ? 'text-green-700 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-400'}>
                      {isConnected ? 'ready' : 'connecting...'}
                    </span>
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {session.status === 'active' && (
                <>
                  <button
                    onClick={handleCloseSandbox}
                    className="border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-4 py-1.5 rounded text-sm hover:border-gray-500 hover:text-slate-900 dark:text-white"
                  >
                    Stop
                  </button>
                  <button
                    onClick={handleResetSandbox}
                    disabled={isResettingSandbox}
                    className="border border-amber-300 dark:border-amber-600 text-amber-600 dark:text-amber-400 px-4 py-1.5 rounded text-sm hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
                  >
                    {isResettingSandbox ? 'Resetting...' : 'Reset'}
                  </button>
                </>
              )}
              <button
                onClick={() => navigate('/agents')}
                className="border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-4 py-1.5 rounded text-sm hover:border-gray-600 hover:text-slate-900 dark:text-white"
              >
                Back
              </button>
            </div>
          </div>
          
          {/* Tabs - Chat + API/SDK Preview + Configure */}
          <div className="max-w-4xl mx-auto flex gap-6 mt-4">
            <button
              onClick={() => setActiveTab('chat')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'chat'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('playground')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'playground'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              API/SDK Preview
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'config'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Configure
            </button>
            <button
              onClick={() => setActiveTab('mcp')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'mcp'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              MCP
            </button>
            <button
              onClick={() => setActiveTab('schedule')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'schedule'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Schedule
            </button>
            {/* <button
              onClick={() => setActiveTab('portal')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'portal'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Portal
            </button> */}
            <button
              onClick={() => setActiveTab('knowledge')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'knowledge'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Knowledge
            </button>
            <button
              onClick={() => setActiveTab('executions')}
              className={`pb-2 text-sm border-b-2 transition-colors ${
                activeTab === 'executions'
                  ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
              }`}
            >
              Executions
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400 px-6 py-2 text-sm">
            {error}
          </div>
        )}

        {/* Chat Tab - Same UI as code agent */}
        {activeTab === 'chat' && (
          <>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto space-y-4">
                {/* Tab heading */}
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-medium text-slate-900 dark:text-white">Chat</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Portal preview - Test the conversational experience your users will have or chat with your agent
                    </p>
                  </div>
                  {allMessages.length > 0 && (
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`/api/agent/sessions/${sessionId}/chat`, {
                            method: 'DELETE',
                            credentials: 'include',
                          });
                          setAllMessages([]);
                          setStreamingOutput([]);
                          setCurrentTask(null);
                          setTasks([]);
                        } catch (err) {
                          console.error('Failed to clear chat:', err);
                        }
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Clear Chat
                    </button>
                  )}
                </div>

                {/* Show start button when agent is not active */}
                {session.status !== 'active' && (
                  <div className={`text-center ${allMessages.length === 0 ? 'py-16' : 'py-6 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg mb-4'}`}>
                    <p className="text-slate-500 dark:text-slate-400 mb-4">
                      {allMessages.length === 0 
                        ? 'Start the agent to begin chatting.'
                        : 'Agent is stopped. Restart to continue the conversation.'}
                    </p>
                    <button
                      onClick={handleStartSandbox}
                      disabled={isStartingSandbox}
                      className="bg-slate-800 dark:bg-indigo-600 text-white px-6 py-2.5 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
                    >
                      {isStartingSandbox ? 'Starting...' : allMessages.length === 0 ? 'Start Agent' : 'Restart Agent'}
                    </button>
                  </div>
                )}

                {session.status === 'active' && allMessages.length === 0 && !isRunningTask && (
                  <div className="text-center py-16">
                    <p className="text-slate-500 dark:text-slate-400">
                      Agent is ready. Ask a question or give instructions.
                    </p>
                  </div>
                )}

                {allMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded p-4 ${
                      message.role === 'user'
                        ? 'bg-white/5 border border-slate-200 dark:border-slate-700 ml-12'
                        : message.role === 'assistant'
                        ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 mr-12'
                        : 'bg-white dark:bg-slate-800/50 text-sm text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                      {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'System'}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed font-mono">{message.content}</div>
                  </div>
                ))}

                {/* Thinking/streaming indicator */}
                {(isRunningTask || currentTask?.status === 'running') && (
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-4 mr-12">
                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                      Agent
                      {isRunningTask && (
                        <span className="text-xs text-yellow-600 dark:text-yellow-400/70">
                          • {elapsedTime > 0 ? `${elapsedTime}s` : 'starting...'}
                        </span>
                      )}
                    </div>
                    {streamingOutput.length > 0 ? (
                      <div className="space-y-3">
                        {(() => {
                          const statusLines = streamingOutput.filter(l => l.startsWith('__STATUS__'));
                          const textLines = streamingOutput.filter(l => !l.startsWith('__STATUS__'));
                          const textContent = textLines.join('\n');
                          return (
                            <>
                              {/* Streaming Response Text - shown prominently like Portal */}
                              {textContent && (
                                <div className="prose prose-sm dark:prose-invert max-w-none">
                                  <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed">
                                    {textContent}
                                    <span className="inline-block w-2 h-4 bg-indigo-500 ml-1 animate-pulse" />
                                  </div>
                                </div>
                              )}
                              {/* Tool Activity - collapsible panel below */}
                              {statusLines.length > 0 && (
                                <details className="group" open={!textContent}>
                                  <summary className="cursor-pointer list-none">
                                    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-900/70 transition-colors">
                                      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        Tool Activity ({statusLines.length})
                                      </div>
                                      <svg className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>
                                  </summary>
                                  <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700 space-y-1.5 max-h-48 overflow-y-auto">
                                    {statusLines.map((line, i) => {
                                      const text = line.replace('__STATUS__', '');
                                      const emoji = text.match(/^[\p{Emoji}]/u)?.[0] || '⚙️';
                                      const content = text.replace(/^[\p{Emoji}\s]+/u, '');
                                      return (
                                        <div key={i} className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                                          <span className="text-sm flex-shrink-0">{emoji}</span>
                                          <span className="truncate">{content}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}
                              {/* Show thinking indicator if no text yet */}
                              {!textContent && statusLines.length === 0 && (
                                <div className="flex items-center gap-3">
                                  <div className="flex gap-1">
                                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                  </div>
                                  <span className="text-slate-500 dark:text-slate-400 text-sm">Agent is thinking...</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <span className="text-slate-500 dark:text-slate-400 text-sm">Agent is thinking...</span>
                      </div>
                    )}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>
            
            {/* Chat Input - always show when agent is active */}
            {session.status === 'active' && (
              <div className="border-t border-slate-200 dark:border-slate-700 p-6">
              <div className="max-w-4xl mx-auto">
                <form onSubmit={handleExecutePrompt} className="flex gap-3">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Ask a question or give instructions..."
                      disabled={isRunningTask}
                      className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-white/20 focus:border-white/30 text-sm font-mono disabled:opacity-50"
                  />
                  <button
                    type="submit"
                      disabled={!prompt.trim() || isRunningTask}
                      className="bg-slate-800 dark:bg-indigo-600 text-white px-6 py-2.5 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
                  >
                      Send
                  </button>
                </form>
            </div>
          </div>
            )}
          </>
        )}

        {/* Configure Tab */}
        {activeTab === 'config' && (
          <div className="flex-1 flex flex-col">
            {/* Tab heading */}
            <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-900">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">
                  {showWizard ? 'Setup Wizard' : 'Configure'}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  {showWizard
                    ? 'Complete the setup wizard to configure your portal agent'
                    : 'Manage your agent\'s settings, files, secrets, and API access'}
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto">
                {showWizard ? (
                  isPortalSandboxAgent ? (
                    <PortalSandboxAgentWizard
                      sessionId={sessionId!}
                      config={config}
                      onComplete={() => {
                        // Refresh config and switch to portal tab
                        setActiveTab('portal');
                        // Re-fetch config
                        agentConfig.get(sessionId!).then(({ config: c }) => setConfig(c));
                      }}
                      onConfigUpdate={(updated) => setConfig(updated)}
                    />
                  ) : (
                    <PortalAgentWizard
                      sessionId={sessionId!}
                      config={config}
                      onComplete={() => {
                        // Refresh config and switch to portal tab
                        setActiveTab('portal');
                        // Re-fetch config
                        agentConfig.get(sessionId!).then(({ config: c }) => setConfig(c));
                      }}
                      onConfigUpdate={(updated) => setConfig(updated)}
                    />
                  )
                ) : (
                  <AgentConfig sessionId={sessionId!} model={session?.agent_model} agentType={session?.agent_type} />
                )}
              </div>
            </div>
          </div>
        )}

        {/* MCP Tab - Task Agent */}
        {activeTab === 'mcp' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">MCP Configuration</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Connect to MCP (Model Context Protocol) servers for custom integrations.
                </p>
              </div>

              {isLoadingSkills ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading...</div>
              ) : (
                <>
                  {/* Custom MCP Servers */}
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <span>🔌</span> Custom MCP Servers
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                      Connect to your own MCP servers for custom integrations.
                    </p>

                    {/* Existing custom servers */}
                    {customMcpServers.length > 0 && (
                      <div className="space-y-2 mb-4">
                        {customMcpServers.map((server) => {
                          const testResult = mcpTestResults[server.id];
                          return (
                            <div
                              key={server.id}
                              className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{server.name}</span>
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                    {server.transport || 'SSE'}
                                  </span>
                                  {server.status === 'connected' && (
                                    <span className="text-xs text-green-700 dark:text-green-400">● Connected</span>
                                  )}
                                  {server.status === 'error' && (
                                    <span className="text-xs text-red-700 dark:text-red-400">⚠️ Error</span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
                                  {server.url}
                                </p>
                                {testResult?.success && testResult.tools && (
                                  <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                                    ✓ {testResult.tools.length} tools available
                                  </p>
                                )}
                                {testResult && !testResult.success && (
                                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">{testResult.error}</p>
                                )}
                                {server.error && !testResult && (
                                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">{server.error}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleTestMcpServer(server.id)}
                                  disabled={testingMcpServer === server.id}
                                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white disabled:opacity-50"
                                >
                                  {testingMcpServer === server.id ? 'Testing...' : 'Test'}
                                </button>
                                <button
                                  onClick={() => handleRemoveMcpServer(server.id)}
                                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add new MCP server */}
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                      <h4 className="text-sm font-medium">Add MCP Server</h4>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name</label>
                          <input
                            type="text"
                            value={newMcpName}
                            onChange={(e) => setNewMcpName(e.target.value)}
                            placeholder="My Custom Server"
                            autoComplete="off"
                            data-lpignore="true"
                            data-1p-ignore
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Transport</label>
                          <select
                            value={newMcpTransport}
                            onChange={(e) => setNewMcpTransport(e.target.value as 'sse' | 'streamable-http')}
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white focus:border-white/30 focus:outline-none"
                          >
                            <option value="streamable-http">Streamable HTTP (recommended)</option>
                            <option value="sse">SSE (legacy)</option>
                          </select>
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Server URL</label>
                        <input
                          type="text"
                          value={newMcpUrl}
                          onChange={(e) => setNewMcpUrl(e.target.value)}
                          placeholder="https://server.smithery.ai/@org/server"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none"
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">MCP server endpoint URL from Smithery, mcp.run, or your own server</p>
                      </div>

                      {/* Authentication */}
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Authentication <span className="text-slate-500 dark:text-slate-400/50">(optional)</span></label>
                        <div className="flex gap-2 mb-2">
                          <button
                            type="button"
                            onClick={() => setNewMcpAuthType('none')}
                            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                              newMcpAuthType === 'none' 
                                ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white' 
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                            }`}
                          >
                            None
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewMcpAuthType('bearer')}
                            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                              newMcpAuthType === 'bearer' 
                                ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white' 
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                            }`}
                          >
                            Bearer Token
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewMcpAuthType('custom')}
                            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                              newMcpAuthType === 'custom' 
                                ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white' 
                                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                            }`}
                          >
                            Custom Header
                          </button>
                        </div>
                        
                        {newMcpAuthType === 'bearer' && (
                          <div>
                            <input
                              type="text"
                              value={newMcpAuthValue}
                              onChange={(e) => setNewMcpAuthValue(e.target.value)}
                              placeholder="sk-xxx..."
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none [-webkit-text-security:disc]"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Will be sent as: Authorization: Bearer &lt;token&gt;</p>
                          </div>
                        )}
                        
                        {newMcpAuthType === 'custom' && (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={newMcpCustomHeaderName}
                              onChange={(e) => setNewMcpCustomHeaderName(e.target.value)}
                              placeholder="Header name (e.g., X-Subscription-Token)"
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none"
                            />
                            <input
                              type="text"
                              value={newMcpAuthValue}
                              onChange={(e) => setNewMcpAuthValue(e.target.value)}
                              placeholder="Header value"
                              autoComplete="off"
                              data-lpignore="true"
                              data-1p-ignore
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none [-webkit-text-security:disc]"
                            />
                            <p className="text-xs text-slate-500 dark:text-slate-400">Will be sent as: {newMcpCustomHeaderName || 'Header-Name'}: &lt;value&gt;</p>
                          </div>
                        )}
                        
                        {newMcpAuthType === 'none' && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">No authentication required for this server</p>
                        )}
                      </div>

                      <button
                        onClick={handleAddMcpServer}
                        disabled={!newMcpName.trim() || !newMcpUrl.trim()}
                        className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
                      >
                        Add Server
                      </button>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                    <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded text-sm">
                      <strong>💡 How it works</strong>
                      <ul className="mt-2 ml-4 list-disc text-slate-500 dark:text-slate-400 space-y-1">
                        <li>Enable skills to give your agent new capabilities</li>
                        <li>Skills requiring secrets need the values configured in the Configure tab</li>
                        <li>Custom MCP servers let you connect proprietary tools</li>
                        <li>All MCP tools appear automatically in agent conversations</li>
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Schedule Tab */}
        {activeTab === 'schedule' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-medium text-slate-900 dark:text-white">Scheduled Runs</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configure automated runs for this agent</p>
                </div>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
                >
                  + New Schedule
                </button>
              </div>

              {isLoadingSchedules ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading schedules...</div>
              ) : agentSchedules.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
                  <div className="text-4xl mb-4">⏰</div>
                  <h3 className="text-slate-900 dark:text-white font-medium mb-2">No schedules yet</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">Create a schedule to run this agent automatically</p>
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
                  >
                    Create Schedule
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {agentSchedules.map(schedule => (
                    <div 
                      key={schedule.id}
                      className={`bg-white dark:bg-slate-800 border rounded-lg p-4 cursor-pointer transition-colors ${
                        selectedSchedule?.id === schedule.id ? 'border-blue-500' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                      onClick={() => loadScheduleDetails(schedule.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${schedule.is_active ? 'bg-green-500' : 'bg-gray-500'}`} />
                          <div>
                            <h3 className="text-slate-900 dark:text-white font-medium">{schedule.name}</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400">{schedule.description_human || schedule.cron_expression}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleSchedule(schedule.id); }}
                            className={`px-3 py-1 rounded text-xs font-medium ${
                              schedule.is_active 
                                ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-500/30' 
                                : 'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-gray-500/30'
                            }`}
                          >
                            {schedule.is_active ? 'Active' : 'Paused'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRunScheduleNow(schedule.id); }}
                            className="px-3 py-1 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-500/30"
                          >
                            Run Now
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(schedule.id); }}
                            className="px-3 py-1 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Last Run:</span>
                          <span className="text-slate-900 dark:text-white ml-2">
                            {schedule.last_run_at ? new Date(schedule.last_run_at).toLocaleString() : 'Never'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Next Run:</span>
                          <span className="text-slate-900 dark:text-white ml-2">
                            {schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString() : 'N/A'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Total Runs:</span>
                          <span className="text-slate-900 dark:text-white ml-2">{schedule.run_count}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Schedule Details Modal */}
              {selectedSchedule && (
                <div className="mt-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                  <h3 className="text-slate-900 dark:text-white font-medium mb-4">Schedule Details: {selectedSchedule.name}</h3>
                  <div className="space-y-3 text-sm">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Cron Expression:</span>
                      <code className="ml-2 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-900 dark:text-white">{selectedSchedule.cron_expression}</code>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Timezone:</span>
                      <span className="ml-2 text-slate-900 dark:text-white">{selectedSchedule.timezone}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Prompt:</span>
                      <pre className="mt-1 bg-slate-100 dark:bg-slate-800 p-3 rounded text-slate-900 dark:text-white text-xs whitespace-pre-wrap">{selectedSchedule.prompt}</pre>
                    </div>
                  </div>

                  {/* Recent Runs */}
                  {scheduleRuns.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-slate-900 dark:text-white font-medium mb-2">Recent Runs</h4>
                      <div className="space-y-2">
                        {scheduleRuns.slice(0, 10).map(run => (
                          <div key={run.id} className="flex items-center justify-between text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded">
                            <span className="text-slate-500 dark:text-slate-400">{new Date(run.created_at).toLocaleString()}</span>
                            <span className={`px-2 py-0.5 rounded ${
                              run.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                              run.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                              run.status === 'running' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                              'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400'
                            }`}>
                              {run.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Create Schedule Modal */}
              {showScheduleModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-lg shadow-xl">
                    <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Create Schedule</h2>
                    <form onSubmit={handleCreateSchedule} className="space-y-4">
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name</label>
                        <input
                          type="text"
                          value={scheduleForm.name}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                          placeholder="Daily report"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Description (optional)</label>
                        <input
                          type="text"
                          value={scheduleForm.description}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, description: e.target.value }))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                          placeholder="Runs every morning at 9am"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Schedule</label>
                        <select
                          value={scheduleForm.cron_expression}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, cron_expression: e.target.value }))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                        >
                          <option value="* * * * *">Every minute</option>
                          <option value="*/5 * * * *">Every 5 minutes</option>
                          <option value="*/15 * * * *">Every 15 minutes</option>
                          <option value="*/30 * * * *">Every 30 minutes</option>
                          <option value="0 * * * *">Every hour</option>
                          <option value="0 */2 * * *">Every 2 hours</option>
                          <option value="0 */4 * * *">Every 4 hours</option>
                          <option value="0 */6 * * *">Every 6 hours</option>
                          <option value="0 */12 * * *">Every 12 hours</option>
                          <option value="0 9 * * *">Daily at 9:00 AM</option>
                          <option value="0 0 * * *">Daily at midnight</option>
                          <option value="0 9 * * 1">Weekly on Monday at 9:00 AM</option>
                          <option value="0 9 1 * *">Monthly on 1st at 9:00 AM</option>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Cron: <code className="bg-slate-100 dark:bg-slate-800 px-1">{scheduleForm.cron_expression}</code>
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Timezone</label>
                        <select
                          value={scheduleForm.timezone}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, timezone: e.target.value }))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                        >
                          <option value="UTC">UTC</option>
                          <option value="America/New_York">Eastern (ET)</option>
                          <option value="America/Chicago">Central (CT)</option>
                          <option value="America/Denver">Mountain (MT)</option>
                          <option value="America/Los_Angeles">Pacific (PT)</option>
                          <option value="Europe/London">London (GMT)</option>
                          <option value="Europe/Paris">Paris (CET)</option>
                          <option value="Asia/Tokyo">Tokyo (JST)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                        <textarea
                          value={scheduleForm.prompt}
                          onChange={(e) => setScheduleForm(prev => ({ ...prev, prompt: e.target.value }))}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm h-32"
                          placeholder="What should the agent do?"
                          required
                        />
                      </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => setShowScheduleModal(false)}
                          className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-sm"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
                        >
                          Create Schedule
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Portal Tab */}
        {activeTab === 'portal' && (
          <div className="flex-1 flex flex-col">
            {/* Tab heading */}
            <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-900">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">Portal</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Configure and customize your public-facing chat portal
                </p>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-4xl mx-auto space-y-8">
                {/* Sub-tab Navigation */}
                <div className="flex gap-4 border-b border-slate-200 dark:border-slate-700">
                  <button
                    onClick={() => setPortalSubTab('settings')}
                    className={`pb-2 text-sm border-b-2 transition-colors ${
                      portalSubTab === 'settings'
                        ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                    }`}
                  >
                    Settings
                  </button>
                  <button
                    onClick={() => setPortalSubTab('customize')}
                    className={`pb-2 text-sm border-b-2 transition-colors ${
                      portalSubTab === 'customize'
                        ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                    }`}
                  >
                    Customize
                  </button>
                  <button
                    onClick={() => setPortalSubTab('css')}
                    className={`pb-2 text-sm border-b-2 transition-colors ${
                      portalSubTab === 'css'
                        ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                    }`}
                  >
                    Custom CSS
                  </button>
                  <button
                    onClick={() => setPortalSubTab('embed')}
                    className={`pb-2 text-sm border-b-2 transition-colors ${
                      portalSubTab === 'embed'
                        ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                    }`}
                  >
                    Iframe Embed
                  </button>
                </div>

              {/* Settings Sub-tab */}
              {portalSubTab === 'settings' && (
                <>
                  {/* Enable Portal Toggle */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Enable Portal</h3>
                      <p className="text-slate-500 dark:text-slate-400 text-sm">Allow public access to this agent via the portal URL</p>
                    </div>
                    <button
                      onClick={handleTogglePortal}
                      disabled={isTogglingPortal}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                        portalEnabled ? 'bg-green-500' : 'bg-gray-600'
                      } ${isTogglingPortal ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${
                          portalEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <h2 className="text-xl font-semibold mb-2">Public Portal</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Share a public URL where users can chat with this agent. The portal supports
                      JWT authentication for secure user context.
                    </p>
                  </div>

                  {/* Chat Portal URL (Primary) */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">Chat Portal</h3>
                      <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">Primary</span>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Full-featured chat portal with conversation threads, file access, and auditable thinking/tools.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/chat/${sessionId}`}
                        className="flex-1 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-sm font-mono"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/chat/${sessionId}`);
                          setCopied('chat-url');
                          setTimeout(() => setCopied(null), 2000);
                        }}
                        className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                          copied === 'chat-url'
                            ? 'bg-green-600 text-white'
                            : 'bg-slate-800 dark:bg-indigo-600 text-white hover:bg-slate-900 dark:hover:bg-indigo-700'
                        }`}
                      >
                        {copied === 'chat-url' ? '✓ Copied!' : 'Copy'}
                      </button>
                      <a
                        href={`/chat/${sessionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-white dark:bg-slate-800 text-sm"
                      >
                        Open
                      </a>
                    </div>
                  </div>

                  {/* Insights Portal URL */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">Insights Portal</h3>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      {isPortalAgent
                        ? 'Claude Desktop-style chat with thinking, tool activity, and streaming.'
                        : 'Structured insights portal with card-based response layout and collapsible sections.'}
                    </p>
                    <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/${isPortalSandboxAgent ? 'portal-sandbox-agent' : isPortalAgent ? 'portal-agent' : 'portal'}/${sessionId}`}
                      className="flex-1 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-sm font-mono"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}/${isPortalSandboxAgent ? 'portal-sandbox-agent' : isPortalAgent ? 'portal-agent' : 'portal'}/${sessionId}`);
                        setCopied('portal-url');
                        setTimeout(() => setCopied(null), 2000);
                      }}
                      className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                        copied === 'portal-url'
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-800 dark:bg-indigo-600 text-white hover:bg-slate-900 dark:hover:bg-indigo-700'
                      }`}
                    >
                      {copied === 'portal-url' ? '✓ Copied!' : 'Copy'}
                    </button>
                    <a
                      href={`/${isPortalSandboxAgent ? 'portal-sandbox-agent' : isPortalAgent ? 'portal-agent' : 'portal'}/${sessionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded hover:bg-white dark:bg-slate-800 text-sm"
                    >
                      Open
                    </a>
                    </div>
                  </div>

              {/* JWT Authentication */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h3 className="font-medium mb-2">JWT Authentication (Optional)</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                  Generate a JWT secret to securely pass user context to the portal. Sign tokens
                  with this secret and pass them via the <code className="bg-slate-100 dark:bg-slate-800/50 px-1 rounded">?token=</code> URL parameter.
                </p>
                
                {jwtSecret ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={jwtSecret}
                        className="flex-1 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-sm font-mono"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(jwtSecret);
                          setCopied('jwt-secret');
                          setTimeout(() => setCopied(null), 2000);
                        }}
                        className={`px-4 py-2 border rounded text-sm transition-colors ${
                          copied === 'jwt-secret'
                            ? 'bg-green-100 dark:bg-green-500/20 border-green-400 dark:border-green-500/30 text-green-700 dark:text-green-400'
                            : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {copied === 'jwt-secret' ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                    <button
                      onClick={async () => {
                        setIsGeneratingSecret(true);
                        try {
                          const res = await fetch(`/api/portal/${sessionId}/jwt-secret`, {
                            method: 'POST',
                            credentials: 'include',
                          });
                          const data = await res.json();
                          setJwtSecret(data.secret);
                        } catch (err) {
                          console.error('Failed to regenerate secret:', err);
                        } finally {
                          setIsGeneratingSecret(false);
                        }
                      }}
                      disabled={isGeneratingSecret}
                      className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                    >
                      Regenerate Secret
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={async () => {
                      setIsGeneratingSecret(true);
                      try {
                        // First try to get existing secret
                        const getRes = await fetch(`/api/portal/${sessionId}/jwt-secret`, {
                          credentials: 'include',
                        });
                        const getData = await getRes.json();
                        if (getData.secret) {
                          setJwtSecret(getData.secret);
                        } else {
                          // Generate new one
                          const postRes = await fetch(`/api/portal/${sessionId}/jwt-secret`, {
                            method: 'POST',
                            credentials: 'include',
                          });
                          const postData = await postRes.json();
                          setJwtSecret(postData.secret);
                        }
                      } catch (err) {
                        console.error('Failed to get/generate secret:', err);
                      } finally {
                        setIsGeneratingSecret(false);
                      }
                    }}
                    disabled={isGeneratingSecret}
                    className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
                  >
                    {isGeneratingSecret ? 'Loading...' : 'Generate JWT Secret'}
                  </button>
                )}
              </div>

              {/* Embed Code */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h3 className="font-medium mb-2">Embed Code</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                  Add this code to your website to embed the portal.
                </p>
                <pre className="bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded p-4 text-sm font-mono overflow-x-auto">
{`<iframe
  src="${window.location.origin}/chat/${sessionId}"
  style="width: 100%; height: 600px; border: none; border-radius: 8px;"
  allow="clipboard-write"
></iframe>`}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`<iframe
  src="${window.location.origin}/chat/${sessionId}"
  style="width: 100%; height: 600px; border: none; border-radius: 8px;"
  allow="clipboard-write"
></iframe>`);
                    setCopied('embed-code');
                    setTimeout(() => setCopied(null), 2000);
                  }}
                  className={`mt-3 px-4 py-2 border rounded text-sm transition-colors ${
                    copied === 'embed-code'
                      ? 'bg-green-100 dark:bg-green-500/20 border-green-400 dark:border-green-500/30 text-green-700 dark:text-green-400'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {copied === 'embed-code' ? '✓ Copied!' : 'Copy Embed Code'}
                </button>
              </div>

              {/* Usage with JWT */}
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h3 className="font-medium mb-4">Passing User Identity & Context</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
                  Pass user information to personalize the agent experience. The agent will have access to this context in its system prompt.
                </p>

                {/* Method 1: URL Parameters */}
                <div className="mb-6">
                  <h4 className="font-medium text-sm mb-2">Method 1: URL Parameters (Simple)</h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs mb-3">
                    Add query parameters directly to the portal URL. Best for testing or simple use cases.
                  </p>
                  <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs font-mono overflow-x-auto mb-2">
{`${window.location.origin}/chat/${sessionId}?user_id=123&user_email=john@example.com&user_name=John%20Doe`}
                  </pre>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/chat/${sessionId}?user_id=123&user_email=john@example.com&user_name=John%20Doe`);
                      setCopied('url-params-example');
                      setTimeout(() => setCopied(null), 2000);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      copied === 'url-params-example'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700 text-white hover:bg-slate-600'
                    }`}
                  >
                    {copied === 'url-params-example' ? '✓ Copied!' : 'Copy Example'}
                  </button>
                </div>

                {/* Method 2: Base64 Token */}
                <div className="mb-6">
                  <h4 className="font-medium text-sm mb-2">Method 2: Base64 Token (Testing)</h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs mb-3">
                    Encode a JSON object as base64 and pass via <code className="bg-slate-100 dark:bg-slate-800/50 px-1 rounded">?token=</code> parameter. Good for testing with multiple fields.
                  </p>
                  <div className="space-y-2 mb-2">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">JavaScript example:</p>
                      <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs font-mono overflow-x-auto">
{`const userContext = {
  user_id: "123",
  user_email: "john@example.com",
  user_name: "John Doe",
  company: "Acme Corp"
};
const token = btoa(JSON.stringify(userContext));
const portalUrl = \`${window.location.origin}/chat/${sessionId}?token=\${token}\`;`}
                      </pre>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const example = `const userContext = {
  user_id: "123",
  user_email: "john@example.com",
  user_name: "John Doe",
  company: "Acme Corp"
};
const token = btoa(JSON.stringify(userContext));
const portalUrl = \`${window.location.origin}/chat/${sessionId}?token=\${token}\`;`;
                      navigator.clipboard.writeText(example);
                      setCopied('base64-example');
                      setTimeout(() => setCopied(null), 2000);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      copied === 'base64-example'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700 text-white hover:bg-slate-600'
                    }`}
                  >
                    {copied === 'base64-example' ? '✓ Copied!' : 'Copy Example'}
                  </button>
                </div>

                {/* Method 3: JWT Token */}
                <div className="mb-6">
                  <h4 className="font-medium text-sm mb-2">Method 3: JWT Token (Production)</h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs mb-3">
                    Sign a JWT with your secret key (generated above) for secure production use. The token should contain user claims.
                  </p>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Node.js example:</p>
                      <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs font-mono overflow-x-auto">
{`const jwt = require('jsonwebtoken');

const payload = {
  user_id: "123",
  user_email: "john@example.com",
  user_name: "John Doe",
  company: "Acme Corp",
  role: "admin"
};

const token = jwt.sign(payload, '${jwtSecret || 'YOUR_JWT_SECRET'}', {
  expiresIn: '1h'
});

const portalUrl = \`${window.location.origin}/chat/${sessionId}?token=\${token}\`;`}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Python example:</p>
                      <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs font-mono overflow-x-auto">
{`import jwt
from datetime import datetime, timedelta

payload = {
    "user_id": "123",
    "user_email": "john@example.com",
    "user_name": "John Doe",
    "company": "Acme Corp",
    "role": "admin",
    "exp": datetime.utcnow() + timedelta(hours=1)
}

token = jwt.encode(payload, '${jwtSecret || 'YOUR_JWT_SECRET'}', algorithm='HS256')
portal_url = f"${window.location.origin}/chat/${sessionId}?token={token}"`}
                      </pre>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const example = `const jwt = require('jsonwebtoken');

const payload = {
  user_id: "123",
  user_email: "john@example.com",
  user_name: "John Doe",
  company: "Acme Corp",
  role: "admin"
};

const token = jwt.sign(payload, '${jwtSecret || 'YOUR_JWT_SECRET'}', {
  expiresIn: '1h'
});

const portalUrl = \`${window.location.origin}/chat/${sessionId}?token=\${token}\`;`;
                      navigator.clipboard.writeText(example);
                      setCopied('jwt-example');
                      setTimeout(() => setCopied(null), 2000);
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      copied === 'jwt-example'
                        ? 'bg-green-600 text-white'
                        : 'bg-slate-700 text-white hover:bg-slate-600'
                    }`}
                  >
                    {copied === 'jwt-example' ? '✓ Copied!' : 'Copy Node.js Example'}
                  </button>
                </div>

                {/* Iframe with Identity */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                  <h4 className="font-medium text-sm mb-2">Embedding with User Identity</h4>
                  <p className="text-slate-500 dark:text-slate-400 text-xs mb-3">
                    When embedding via iframe, generate the token server-side and append it to the iframe src:
                  </p>
                  <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs font-mono overflow-x-auto">
{`<!-- Server-side: Generate token with user's info -->
<iframe
  src="${window.location.origin}/chat/${sessionId}?token=<%= generateJWT(currentUser) %>"
  style="width: 100%; height: 600px; border: none; border-radius: 8px;"
  allow="clipboard-write"
></iframe>`}
                  </pre>
                </div>

                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs">
                  <p className="text-blue-800 dark:text-blue-200">
                    <strong>💡 Tip:</strong> The user context will be available to your agent in the system prompt. You can reference it like: "The current user is {'{user_name}'} ({'{user_email}'})"
                  </p>
                </div>
              </div>
                </>
              )}

              {/* Customize Sub-tab */}
              {portalSubTab === 'customize' && (
                <>
                  {portalConfigMessage && (
                    <div className={`px-4 py-2 rounded text-sm ${
                      portalConfigMessage.includes('Failed') 
                        ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400'
                        : 'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/50 text-green-700 dark:text-green-400'
                    }`}>
                      {portalConfigMessage}
                    </div>
                  )}

                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-semibold mb-2">Portal Appearance</h2>
                      <p className="text-slate-500 dark:text-slate-400 text-sm">
                        Customize the look and feel of your agent's public portal.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setPortalPrimaryColor('#3b5998');
                        setPortalBackgroundColor('#0f0f0f');
                        setPortalAccentColor('#1e1e2e');
                        setPortalTextColor('#ffffff');
                        setPortalButtonColor('#3b5998');
                        setPortalFontFamily('system');
                        setPortalName('');
                        setPortalGreeting('');
                        setInsightsPortalGreeting('');
                        setSuggestedQuestions([]);
                      }}
                      className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                    >
                      Reset to Defaults
                    </button>
                  </div>

                  {/* AI Website Style Matcher */}
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-6 mb-6">
                    <div className="flex items-start gap-4">
                      <div className="flex-shrink-0 w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
                          ✨ AI Website Style Matcher
                        </h3>
                        <p className="text-purple-700 dark:text-purple-300 text-sm mb-4">
                          Enter any website URL and our AI will automatically extract its design system and style your portal to match.
                        </p>
                        <button
                          onClick={() => navigate(`/agents/${sessionId}/customize-portal`)}
                          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium transition-colors text-sm"
                        >
                          Open Style Matcher →
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Logo Upload */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Logo</h3>
                    <div className="flex items-start gap-4">
                      {portalLogoUrl ? (
                        <div className="relative">
                          <img
                            src={portalLogoUrl}
                            alt="Portal logo"
                            className="h-16 w-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50"
                          />
                          <button
                            onClick={async () => {
                              try {
                                await agentConfig.deleteLogo(sessionId!);
                                setPortalLogoUrl(null);
                                setPortalConfigMessage('Logo removed!');
                                setTimeout(() => setPortalConfigMessage(''), 3000);
                              } catch (err) {
                                setPortalConfigMessage('Failed to remove logo');
                              }
                            }}
                            className="absolute -top-2 -right-2 p-1 bg-red-500 rounded-full text-slate-900 dark:text-white hover:bg-red-400"
                            title="Remove logo"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <div className="h-16 w-16 rounded border border-dashed border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/30 flex items-center justify-center text-slate-500 dark:text-slate-400">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      <div>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            
                            setIsUploadingLogo(true);
                            try {
                              const result = await agentConfig.uploadLogo(sessionId!, file);
                              const cacheBust = `v=${Date.now()}`;
                              setPortalLogoUrl(`${result.logoUrl}${result.logoUrl.includes('?') ? '&' : '?'}${cacheBust}`);
                              setPortalConfigMessage('Logo uploaded!');
                              setTimeout(() => setPortalConfigMessage(''), 3000);
                            } catch (err: any) {
                              setPortalConfigMessage(err.message || 'Failed to upload logo');
                            } finally {
                              setIsUploadingLogo(false);
                              if (logoInputRef.current) {
                                logoInputRef.current.value = '';
                              }
                            }
                          }}
                        />
                        <button
                          onClick={() => logoInputRef.current?.click()}
                          disabled={isUploadingLogo}
                          className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                        >
                          {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                          PNG, JPG, GIF, WebP, or SVG. Max 10MB.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Theme Templates */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Quick Theme Templates</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Apply a pre-built theme to quickly style your portal. Themes are saved automatically.
                    </p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Professional Light Theme */}
                      <button
                        onClick={async () => {
                          const theme = `/* ========================================
 * PROFESSIONAL LIGHT THEME
 * Clean, modern design with purple accents
 * ======================================== */

/* Main container - Light background */
.portal-container {
  background: #f8f9fa !important;
}

/* Sidebar - White with subtle shadow */
.portal-sidebar {
  background: #ffffff !important;
  border-right: 1px solid #e9ecef !important;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.04) !important;
}

/* Header - Clean white */
.portal-header {
  background: #ffffff !important;
  border-bottom: 1px solid #e9ecef !important;
  padding: 20px !important;
}

/* Portal title - Dark text */
.portal-title {
  color: #1a1a1a !important;
  font-weight: 600 !important;
  font-size: 18px !important;
}

/* New thread button - Purple accent */
.new-thread-button {
  background: #6366f1 !important;
  color: white !important;
  border-radius: 8px !important;
  padding: 12px 16px !important;
  font-weight: 500 !important;
  transition: all 0.2s ease !important;
  border: none !important;
}

.new-thread-button:hover {
  background: #6d28d9 !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3) !important;
}

/* Thread items */
.thread-item {
  border-radius: 8px !important;
  margin: 4px 8px !important;
  padding: 12px !important;
  color: #4b5563 !important;
  transition: all 0.2s ease !important;
}

.thread-item:hover {
  background: #f3f4f6 !important;
  color: #1a1a1a !important;
}

.thread-active {
  background: #ede9fe !important;
  color: #6366f1 !important;
  font-weight: 500 !important;
  border-left: 3px solid #6366f1 !important;
}

/* Main chat area - Light background */
.portal-main {
  background: #f8f9fa !important;
}

/* Top bar in main area */
.portal-topbar {
  background: #ffffff !important;
  border-bottom: 1px solid #e9ecef !important;
  padding: 16px 24px !important;
}

/* Chat container */
.chat-container {
  background: #f8f9fa !important;
  padding: 24px !important;
}

/* Message bubbles - Clean styling */
.message-bubble {
  margin-bottom: 16px !important;
}

/* User messages - Purple */
.message-user .message-content {
  background: #6366f1 !important;
  color: white !important;
  border-radius: 16px !important;
  border-top-right-radius: 4px !important;
  padding: 14px 18px !important;
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.2) !important;
  font-size: 15px !important;
  line-height: 1.5 !important;
}

/* Assistant messages - White with border */
.message-assistant .message-content {
  background: #ffffff !important;
  color: #1a1a1a !important;
  border: 1px solid #e9ecef !important;
  border-radius: 16px !important;
  border-top-left-radius: 4px !important;
  padding: 14px 18px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04) !important;
  font-size: 15px !important;
  line-height: 1.6 !important;
}

/* Input container - White */
.input-container {
  background: #ffffff !important;
  border-top: 1px solid #e9ecef !important;
  padding: 20px 24px !important;
}

/* Input field - Clean border */
.input-field {
  background: #ffffff !important;
  border: 1.5px solid #d1d5db !important;
  border-radius: 12px !important;
  padding: 14px 16px !important;
  color: #1a1a1a !important;
  font-size: 15px !important;
  transition: all 0.2s ease !important;
  resize: none !important;
}

.input-field:focus {
  border-color: #6366f1 !important;
  box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1) !important;
  outline: none !important;
}

.input-field::placeholder {
  color: #9ca3af !important;
}

/* Send button - Purple */
.send-button {
  background: #6366f1 !important;
  color: white !important;
  border-radius: 10px !important;
  padding: 14px 20px !important;
  font-weight: 500 !important;
  transition: all 0.2s ease !important;
  border: none !important;
}

.send-button:hover:not(:disabled) {
  background: #6d28d9 !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3) !important;
}

.send-button:disabled {
  opacity: 0.5 !important;
  cursor: not-allowed !important;
}

/* Thinking panel - Subtle styling */
.thinking-panel {
  background: #ffffff !important;
  border: 1px solid #e9ecef !important;
  border-radius: 12px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04) !important;
}

/* Scrollbar */
.chat-container::-webkit-scrollbar {
  width: 8px;
}

.chat-container::-webkit-scrollbar-track {
  background: transparent;
}

.chat-container::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

.chat-container::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

/* Typography improvements */
.message-content code {
  background: #f3f4f6 !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  font-size: 14px !important;
}

.message-assistant .message-content code {
  background: #f3f4f6 !important;
  color: #6366f1 !important;
}

.message-user .message-content code {
  background: rgba(255, 255, 255, 0.2) !important;
  color: white !important;
}

/* Links */
.message-content a {
  color: #6366f1 !important;
  text-decoration: underline !important;
}

.message-content a:hover {
  color: #6d28d9 !important;
}

/* Scrollbar - Light theme */
.portal-container ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.portal-container ::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.portal-container ::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

.portal-container ::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}

.chat-container::-webkit-scrollbar-thumb {
  background: #d1d5db;
}

.chat-container::-webkit-scrollbar-thumb:hover {
  background: #9ca3af;
}`;
                          setCustomCSS(theme);
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, {
                              portal_custom_css: theme,
                            });
                            setPortalConfigMessage('Professional Light theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-purple-500 dark:hover:border-purple-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-500/5 dark:to-slate-800"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-purple-600"></div>
                            <div className="font-semibold text-slate-900 dark:text-white">Professional Light</div>
                            <span className="text-[10px] bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded">Default</span>
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-400 mb-3">
                            Clean, modern design with purple accents
                          </div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-white border border-slate-200"></div>
                            <div className="w-6 h-6 rounded bg-purple-600"></div>
                            <div className="w-6 h-6 rounded bg-slate-100"></div>
                          </div>
                        </div>
                      </button>

                      {/* Modern Dark Theme */}
                      <button
                        onClick={async () => {
                          const theme = `/* ========================================
 * MODERN DARK THEME
 * Sleek, professional dark mode design
 * ======================================== */

/* Main container - Deep charcoal background */
.portal-container {
  background: #0f0f0f !important;
}

/* Sidebar - Darker panel */
.portal-sidebar {
  background: #1a1a1a !important;
  border-right: 1px solid #2a2a2a !important;
}

/* Header */
.portal-header {
  background: #1a1a1a !important;
  border-bottom: 1px solid #2a2a2a !important;
}

/* Portal title */
.portal-title {
  color: #ffffff !important;
}

/* New thread button - Subtle accent */
.new-thread-button {
  background: #3b82f6 !important;
  color: white !important;
  border-radius: 8px !important;
}

.new-thread-button:hover {
  background: #2563eb !important;
}

/* Thread items */
.thread-item {
  color: #a0a0a0 !important;
  border-radius: 6px !important;
}

.thread-item:hover {
  background: #252525 !important;
  color: #ffffff !important;
}

.thread-active {
  background: #3b82f6 !important;
  color: #ffffff !important;
}

/* Main area */
.portal-main {
  background: #0f0f0f !important;
}

.portal-topbar {
  background: #1a1a1a !important;
  border-bottom: 1px solid #2a2a2a !important;
  color: #a0a0a0 !important;
}

/* Chat area */
.chat-container {
  background: #0f0f0f !important;
}

/* User messages - Blue accent */
.message-user .message-content {
  background: #3b82f6 !important;
  color: white !important;
  border-radius: 16px !important;
  border-top-right-radius: 4px !important;
}

/* Assistant messages - Subtle dark card */
.message-assistant .message-content {
  background: #1a1a1a !important;
  color: #e5e5e5 !important;
  border: 1px solid #2a2a2a !important;
  border-radius: 16px !important;
  border-top-left-radius: 4px !important;
}

/* Input area */
.input-container {
  background: #1a1a1a !important;
  border-top: 1px solid #2a2a2a !important;
}

.input-field {
  background: #0f0f0f !important;
  border: 1px solid #2a2a2a !important;
  color: #ffffff !important;
  border-radius: 12px !important;
}

.input-field:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2) !important;
}

.input-field::placeholder {
  color: #666666 !important;
}

/* Send button */
.send-button {
  background: #3b82f6 !important;
  border-radius: 10px !important;
}

.send-button:hover:not(:disabled) {
  background: #2563eb !important;
}

/* Code blocks */
.message-content code {
  background: #2a2a2a !important;
  color: #60a5fa !important;
}

/* Scrollbar - Dark theme */
.portal-container ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.portal-container ::-webkit-scrollbar-track {
  background: #0f0f0f;
}

.portal-container ::-webkit-scrollbar-thumb {
  background: #2a2a2a;
  border-radius: 4px;
}

.portal-container ::-webkit-scrollbar-thumb:hover {
  background: #3b82f6;
}`;
                          setCustomCSS(theme);
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, {
                              portal_custom_css: theme,
                            });
                            setPortalConfigMessage('Modern Dark theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                            <div className="font-semibold text-white">Modern Dark</div>
                          </div>
                          <div className="text-xs text-slate-400 mb-3">
                            Sleek, professional dark mode design
                          </div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-[#0f0f0f] border border-slate-700"></div>
                            <div className="w-6 h-6 rounded bg-[#1a1a1a] border border-slate-700"></div>
                            <div className="w-6 h-6 rounded bg-blue-500"></div>
                          </div>
                        </div>
                      </button>

                      {/* Neon Glow Theme */}
                      <button
                        onClick={async () => {
                          const theme = `/* ========================================
 * NEON GLOW THEME
 * Vibrant cyberpunk aesthetic with glowing effects
 * ======================================== */

/* Main container - Deep black */
.portal-container {
  background: #050505 !important;
}

/* Sidebar - Dark with subtle glow */
.portal-sidebar {
  background: #0a0a0a !important;
  border-right: 1px solid rgba(139, 92, 246, 0.2) !important;
  box-shadow: 2px 0 20px rgba(139, 92, 246, 0.1) !important;
}

/* Header */
.portal-header {
  background: #0a0a0a !important;
  border-bottom: 1px solid rgba(139, 92, 246, 0.2) !important;
}

/* Portal title - Glowing text */
.portal-title {
  color: #c4b5fd !important;
  text-shadow: 0 0 10px rgba(139, 92, 246, 0.5) !important;
}

/* New thread button - Neon gradient */
.new-thread-button {
  background: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%) !important;
  color: white !important;
  border-radius: 8px !important;
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.4) !important;
}

.new-thread-button:hover {
  box-shadow: 0 0 30px rgba(139, 92, 246, 0.6) !important;
  transform: translateY(-2px) !important;
}

/* Thread items */
.thread-item {
  color: #a0a0a0 !important;
  border-radius: 6px !important;
  transition: all 0.3s ease !important;
}

.thread-item:hover {
  background: rgba(139, 92, 246, 0.1) !important;
  color: #c4b5fd !important;
  box-shadow: inset 0 0 20px rgba(139, 92, 246, 0.1) !important;
}

.thread-active {
  background: rgba(139, 92, 246, 0.2) !important;
  color: #c4b5fd !important;
  border-left: 3px solid #8b5cf6 !important;
  box-shadow: inset 0 0 30px rgba(139, 92, 246, 0.15) !important;
}

/* Main area */
.portal-main {
  background: #050505 !important;
}

.portal-topbar {
  background: #0a0a0a !important;
  border-bottom: 1px solid rgba(139, 92, 246, 0.2) !important;
  color: #a0a0a0 !important;
}

/* Chat area */
.chat-container {
  background: #050505 !important;
}

/* User messages - Neon gradient with glow */
.message-user .message-content {
  background: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%) !important;
  color: white !important;
  border-radius: 16px !important;
  border-top-right-radius: 4px !important;
  box-shadow: 0 0 25px rgba(139, 92, 246, 0.4) !important;
}

/* Assistant messages - Dark with border glow */
.message-assistant .message-content {
  background: #0a0a0a !important;
  color: #e5e5e5 !important;
  border: 1px solid rgba(139, 92, 246, 0.3) !important;
  border-radius: 16px !important;
  border-top-left-radius: 4px !important;
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.15) !important;
}

/* Input area */
.input-container {
  background: #0a0a0a !important;
  border-top: 1px solid rgba(139, 92, 246, 0.2) !important;
}

.input-field {
  background: #050505 !important;
  border: 1px solid rgba(139, 92, 246, 0.3) !important;
  color: #ffffff !important;
  border-radius: 12px !important;
  transition: all 0.3s ease !important;
}

.input-field:focus {
  border-color: #8b5cf6 !important;
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.3) !important;
}

.input-field::placeholder {
  color: #666666 !important;
}

/* Send button - Glowing */
.send-button {
  background: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%) !important;
  border-radius: 10px !important;
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.4) !important;
  transition: all 0.3s ease !important;
}

.send-button:hover:not(:disabled) {
  box-shadow: 0 0 35px rgba(139, 92, 246, 0.6) !important;
  transform: scale(1.05) !important;
}

/* Code blocks */
.message-content code {
  background: rgba(139, 92, 246, 0.2) !important;
  color: #c4b5fd !important;
  border: 1px solid rgba(139, 92, 246, 0.3) !important;
}

/* Scrollbar - Neon accent */
.portal-container ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.portal-container ::-webkit-scrollbar-track {
  background: #050505;
}

.portal-container ::-webkit-scrollbar-thumb {
  background: rgba(139, 92, 246, 0.3);
  border-radius: 4px;
}

.portal-container ::-webkit-scrollbar-thumb:hover {
  background: #8b5cf6;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.5);
}

/* Links */
.message-content a {
  color: #c4b5fd !important;
  text-shadow: 0 0 5px rgba(139, 92, 246, 0.3) !important;
}

.message-content a:hover {
  color: #ddd6fe !important;
  text-shadow: 0 0 10px rgba(139, 92, 246, 0.5) !important;
}`;
                          setCustomCSS(theme);
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, {
                              portal_custom_css: theme,
                            });
                            setPortalConfigMessage('Neon Glow theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-purple-500 dark:hover:border-purple-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/50 to-pink-900/50"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 shadow-[0_0_10px_rgba(139,92,246,0.5)]"></div>
                            <div className="font-semibold text-white">Neon Glow</div>
                          </div>
                          <div className="text-xs text-purple-300 mb-3">
                            Vibrant cyberpunk aesthetic with glowing effects
                          </div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-[#050505] border border-purple-500/30"></div>
                            <div className="w-6 h-6 rounded bg-gradient-to-r from-purple-500 to-pink-500"></div>
                            <div className="w-6 h-6 rounded bg-purple-500/20 border border-purple-500/30"></div>
                          </div>
                        </div>
                      </button>

                      {/* Insights / CX Analytics Theme */}
                      <button
                        onClick={async () => {
                          const theme = `/* ========================================
 * CX ANALYTICS THEME
 * Inspired by modern customer experience platforms
 * Clean, professional with lime accent
 * ======================================== */

/* Main container - Light blue-gray background */
.portal-container {
  background: #f6f8fc !important;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

/* Sidebar - Clean white with subtle border */
.portal-sidebar {
  background: #ffffff !important;
  border-right: 1px solid #e2e8f0 !important;
  box-shadow: none !important;
}

/* Header - White with navy text */
.portal-header {
  background: #ffffff !important;
  border-bottom: 1px solid #e2e8f0 !important;
  padding: 20px !important;
}

/* Portal title - Navy blue */
.portal-title {
  color: #1a1f36 !important;
  font-weight: 600 !important;
  font-size: 17px !important;
  letter-spacing: -0.01em !important;
}

/* New thread button - Lime/chartreuse accent */
.new-thread-button {
  background: #c5f467 !important;
  color: #1a1f36 !important;
  border-radius: 8px !important;
  padding: 12px 16px !important;
  font-weight: 600 !important;
  transition: all 0.2s ease !important;
  border: none !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
}

.new-thread-button:hover {
  background: #b8e85a !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 4px 12px rgba(197, 244, 103, 0.3) !important;
}

/* Thread items */
.thread-item {
  border-radius: 8px !important;
  margin: 4px 8px !important;
  padding: 12px !important;
  color: #64748b !important;
  transition: all 0.15s ease !important;
  font-size: 14px !important;
}

.thread-item:hover {
  background: #f1f5f9 !important;
  color: #1a1f36 !important;
}

.thread-active {
  background: #e8f4fc !important;
  color: #1a1f36 !important;
  font-weight: 500 !important;
  border-left: 3px solid #3b82f6 !important;
}

/* Main chat area - Light background */
.portal-main {
  background: #f6f8fc !important;
}

/* Top bar in main area */
.portal-topbar {
  background: #ffffff !important;
  border-bottom: 1px solid #e2e8f0 !important;
  padding: 16px 24px !important;
  color: #64748b !important;
}

/* Chat container */
.chat-container {
  background: #f6f8fc !important;
  padding: 24px !important;
}

/* Greeting container - Card style */
.greeting-container {
  background: #ffffff !important;
  border: 1px solid #e2e8f0 !important;
  border-radius: 12px !important;
  padding: 24px !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
}

/* Message bubbles - Clean styling */
.message-bubble {
  margin-bottom: 16px !important;
}

/* User messages - Blue accent */
.message-user .message-content {
  background: #3b82f6 !important;
  color: white !important;
  border-radius: 16px !important;
  border-top-right-radius: 4px !important;
  padding: 14px 18px !important;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15) !important;
  font-size: 15px !important;
  line-height: 1.5 !important;
}

/* Assistant messages - White card with border */
.message-assistant .message-content {
  background: #ffffff !important;
  color: #1a1f36 !important;
  border: 1px solid #e2e8f0 !important;
  border-radius: 16px !important;
  border-top-left-radius: 4px !important;
  padding: 16px 20px !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04) !important;
  font-size: 15px !important;
  line-height: 1.65 !important;
}

/* Input container - White */
.input-container {
  background: #ffffff !important;
  border-top: 1px solid #e2e8f0 !important;
  padding: 20px 24px !important;
}

/* Input field - Clean border */
.input-field {
  background: #ffffff !important;
  border: 1.5px solid #e2e8f0 !important;
  border-radius: 10px !important;
  padding: 14px 16px !important;
  color: #1a1f36 !important;
  font-size: 15px !important;
  transition: all 0.15s ease !important;
}

.input-field:focus {
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
  outline: none !important;
}

.input-field::placeholder {
  color: #94a3b8 !important;
}

/* Send button - Blue primary */
.send-button {
  background: #3b82f6 !important;
  border-radius: 8px !important;
  padding: 10px 16px !important;
  transition: all 0.15s ease !important;
}

.send-button:hover:not(:disabled) {
  background: #2563eb !important;
  transform: translateY(-1px) !important;
}

.send-button:disabled {
  background: #cbd5e1 !important;
  opacity: 1 !important;
}

/* Code blocks */
.message-content code {
  background: #f1f5f9 !important;
  color: #1a1f36 !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  font-size: 13px !important;
}

.message-content pre {
  background: #1a1f36 !important;
  border-radius: 8px !important;
  padding: 16px !important;
  overflow-x: auto !important;
}

.message-content pre code {
  background: transparent !important;
  color: #e2e8f0 !important;
  padding: 0 !important;
}

/* Links */
.message-content a {
  color: #3b82f6 !important;
  text-decoration: none !important;
  font-weight: 500 !important;
}

.message-content a:hover {
  text-decoration: underline !important;
}

/* Scrollbar - Subtle */
.portal-container ::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.portal-container ::-webkit-scrollbar-track {
  background: #f1f5f9;
}

.portal-container ::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 3px;
}

.portal-container ::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Headings in messages */
.message-content h1,
.message-content h2,
.message-content h3 {
  color: #1a1f36 !important;
  font-weight: 600 !important;
  margin-top: 20px !important;
  margin-bottom: 10px !important;
}

/* Lists */
.message-content ul,
.message-content ol {
  color: #334155 !important;
  padding-left: 20px !important;
}

.message-content li {
  margin-bottom: 6px !important;
}

/* Blockquotes */
.message-content blockquote {
  border-left: 3px solid #c5f467 !important;
  padding-left: 16px !important;
  color: #64748b !important;
  font-style: italic !important;
  margin: 16px 0 !important;
}

/* Tables */
.message-content table {
  border-collapse: collapse !important;
  width: 100% !important;
  margin: 16px 0 !important;
}

.message-content th {
  background: #f8fafc !important;
  color: #1a1f36 !important;
  font-weight: 600 !important;
  text-align: left !important;
  padding: 12px !important;
  border-bottom: 2px solid #e2e8f0 !important;
}

.message-content td {
  padding: 12px !important;
  border-bottom: 1px solid #e2e8f0 !important;
  color: #334155 !important;
}

/* Strong/bold text */
.message-content strong {
  color: #1a1f36 !important;
  font-weight: 600 !important;
}`;
                          setCustomCSS(theme);
                          setIsSavingPortalConfig(true);
                          setPortalConfigMessage('');
                          try {
                            await agentConfig.update(sessionId!, {
                              portal_custom_css: theme,
                            });
                            setPortalConfigMessage('CX Analytics theme applied!');
                            setTimeout(() => setPortalConfigMessage(''), 3000);
                          } catch (err) {
                            setPortalConfigMessage('Failed to apply theme');
                          } finally {
                            setIsSavingPortalConfig(false);
                          }
                        }}
                        disabled={isSavingPortalConfig}
                        className="group relative overflow-hidden rounded-lg border-2 border-slate-200 dark:border-slate-700 hover:border-lime-500 dark:hover:border-lime-500 transition-all p-4 text-left disabled:opacity-50"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 to-blue-50"></div>
                        <div className="relative">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-3 h-3 rounded-full bg-[#c5f467]"></div>
                            <div className="font-semibold text-slate-800">CX Analytics</div>
                          </div>
                          <div className="text-xs text-slate-600 mb-3">
                            Clean, modern with lime accent
                          </div>
                          <div className="flex gap-1">
                            <div className="w-6 h-6 rounded bg-white border border-slate-200"></div>
                            <div className="w-6 h-6 rounded bg-[#1a1f36]"></div>
                            <div className="w-6 h-6 rounded bg-[#c5f467]"></div>
                          </div>
                        </div>
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
                      💡 Themes are applied instantly. Switch to the <strong>Custom CSS</strong> tab to view or customize the code.
                    </p>
                  </div>

                  {/* Portal Name */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Portal Name</h3>
                    <input
                      type="text"
                      value={portalName}
                      onChange={(e) => setPortalName(e.target.value)}
                      placeholder={config?.name || 'AI Assistant'}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      Custom name displayed in the portal. Leave empty to use the agent name.
                    </p>
                  </div>

                  {/* Greeting */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Greeting Message</h3>
                    <input
                      type="text"
                      value={portalGreeting}
                      onChange={(e) => setPortalGreeting(e.target.value)}
                      placeholder="Hi! How can I help you today?"
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      The initial message displayed to users when they open the portal.
                    </p>
                  </div>

                  {/* Insights Portal Settings */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Insights Portal Settings</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                      These settings apply to the Insights Portal (Portal 2).
                    </p>
                    
                    {/* Custom Greeting */}
                    <div className="mb-4">
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-2">
                        Portal Greeting
                      </label>
                      <input
                        type="text"
                        value={insightsPortalGreeting}
                        onChange={(e) => setInsightsPortalGreeting(e.target.value)}
                        placeholder="Hey there, I'm {name} 👋"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Use {'{name}'} as placeholder for the portal name. Example: "Welcome! I'm {'{name}'}, your assistant"
                      </p>
                    </div>

                    {/* Suggested Questions */}
                    <div>
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-2">
                        Suggested Questions
                      </label>
                      <div className="space-y-2">
                        {suggestedQuestions.map((q, idx) => (
                          <div key={idx} className="flex gap-2">
                            <input
                              type="text"
                              value={q}
                              onChange={(e) => {
                                const updated = [...suggestedQuestions];
                                updated[idx] = e.target.value;
                                setSuggestedQuestions(updated);
                              }}
                              placeholder={`Question ${idx + 1}`}
                              className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setSuggestedQuestions(suggestedQuestions.filter((_, i) => i !== idx));
                              }}
                              className="px-2 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        {suggestedQuestions.length < 6 && (
                          <button
                            type="button"
                            onClick={() => setSuggestedQuestions([...suggestedQuestions, ''])}
                            className="w-full px-3 py-2 border border-dashed border-slate-300 dark:border-slate-600 rounded text-sm text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                          >
                            + Add suggested question
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        Custom questions shown to users when they first open the Insights Portal.
                      </p>
                    </div>

                    {/* Portal Files Bucket */}
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                      <label className="block text-sm text-slate-600 dark:text-slate-300 mb-2">
                        Portal Files Section
                      </label>
                      <select
                        value={portalBucketId || 'none'}
                        onChange={(e) => setPortalBucketId(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none"
                      >
                        <option value="none">None - Hide files in portal</option>
                        {attachedBuckets.map((bucket) => (
                          <option key={bucket.bucket_id} value={bucket.bucket_id}>
                            {bucket.bucket_name}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {attachedBuckets.length === 0 
                          ? 'No buckets attached. Attach a bucket in the Files tab to enable the portal files section.'
                          : 'Select which bucket is shown in the portal\'s Files section, or hide files entirely.'}
                      </p>
                    </div>
                  </div>

                  {/* Hidden: Theme Colors, Font Family, Preview - not commonly used */}
                  {/* To re-enable, change false to true below */}
                  {false && (
                    <>
                      {/* Theme Colors */}
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                        <h3 className="font-medium mb-4">Theme Colors</h3>
                        <div className="grid grid-cols-3 gap-6 mb-6">
                          <div>
                            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Background</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={portalBackgroundColor}
                                onChange={(e) => setPortalBackgroundColor(e.target.value)}
                                className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent"
                              />
                              <input
                                type="text"
                                value={portalBackgroundColor}
                                onChange={(e) => setPortalBackgroundColor(e.target.value)}
                                className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Sidebar/Accent</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={portalAccentColor}
                                onChange={(e) => setPortalAccentColor(e.target.value)}
                                className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent"
                              />
                              <input
                                type="text"
                                value={portalAccentColor}
                                onChange={(e) => setPortalAccentColor(e.target.value)}
                                className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Text Color</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={portalTextColor}
                                onChange={(e) => setPortalTextColor(e.target.value)}
                                className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent"
                              />
                              <input
                                type="text"
                                value={portalTextColor}
                                onChange={(e) => setPortalTextColor(e.target.value)}
                                className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-6">
                          <div>
                            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Primary/Message</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={portalPrimaryColor}
                                onChange={(e) => setPortalPrimaryColor(e.target.value)}
                                className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent"
                              />
                              <input
                                type="text"
                                value={portalPrimaryColor}
                                onChange={(e) => setPortalPrimaryColor(e.target.value)}
                                className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm text-slate-500 dark:text-slate-400 mb-2">Button Color</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={portalButtonColor}
                                onChange={(e) => setPortalButtonColor(e.target.value)}
                                className="w-12 h-10 rounded cursor-pointer border border-slate-200 dark:border-slate-700 bg-transparent"
                              />
                              <input
                                type="text"
                                value={portalButtonColor}
                                onChange={(e) => setPortalButtonColor(e.target.value)}
                                className="flex-1 px-2 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Font Family */}
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                        <h3 className="font-medium mb-4">Font Family</h3>
                        <div className="grid grid-cols-5 gap-3">
                          {([
                            { id: 'system', label: 'System', sample: 'Aa', font: 'system-ui, -apple-system, sans-serif' },
                            { id: 'sans', label: 'Sans', sample: 'Aa', font: 'Inter, sans-serif' },
                            { id: 'serif', label: 'Serif', sample: 'Aa', font: 'Georgia, serif' },
                            { id: 'mono', label: 'Mono', sample: 'Aa', font: 'JetBrains Mono, monospace' },
                            { id: 'display', label: 'Display', sample: 'Aa', font: 'Lexend, sans-serif' },
                          ] as const).map((font) => (
                            <button
                              key={font.id}
                              onClick={() => setPortalFontFamily(font.id)}
                              className={`p-4 border rounded-lg text-center transition-colors ${
                                portalFontFamily === font.id
                                  ? 'border-white bg-white/10'
                                  : 'border-slate-200 dark:border-slate-700 hover:border-gray-600'
                              }`}
                            >
                              <div 
                                className="text-2xl mb-1"
                                style={{ fontFamily: font.font }}
                              >
                                {font.sample}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{font.label}</div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Chat Portal Preview */}
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-medium">Chat Portal Preview</h3>
                          <a
                            href={`/chat/${sessionId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-500 hover:text-indigo-400 flex items-center gap-1"
                          >
                            Open full preview
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                        <div 
                          className="rounded-lg border border-[#e2e8f0] overflow-hidden bg-white"
                          style={{
                            fontFamily: portalFontFamily === 'system' ? 'system-ui, -apple-system, sans-serif' :
                                        portalFontFamily === 'sans' ? 'Inter, sans-serif' :
                                        portalFontFamily === 'serif' ? 'Georgia, serif' :
                                        portalFontFamily === 'mono' ? 'JetBrains Mono, monospace' :
                                        'Lexend, sans-serif'
                          }}
                        >
                          {/* Top bar */}
                          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#e2e8f0]">
                            <div className="flex items-center gap-2">
                              {portalLogoUrl ? (
                                <img src={portalLogoUrl || undefined} alt="Logo" className="h-5 w-auto" />
                              ) : null}
                              <span className="text-sm font-semibold text-[#1e2a4a]">{portalName || config?.name || 'AI Assistant'}</span>
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `${portalPrimaryColor}20`, color: portalPrimaryColor }}>Beta</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[#64748b] text-xs">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              Files
                            </div>
                          </div>
                          {/* Mock messages */}
                          <div className="p-4 space-y-3">
                            {/* User message */}
                            <div className="border border-[#e2e8f0] rounded-lg p-3 border-l-4 border-l-[#3b82f6]">
                              <div className="flex items-center gap-1.5 mb-1">
                                <div className="w-4 h-4 rounded-full bg-[#3b82f6] flex items-center justify-center">
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                </div>
                                <span className="text-[10px] font-medium text-[#1e2a4a]">You</span>
                              </div>
                              <p className="text-xs text-[#1e2a4a] pl-5">Analyze the Q4 results</p>
                            </div>
                            {/* Assistant message */}
                            <div className="border border-[#e2e8f0] rounded-lg p-3 border-l-4 border-l-[#c5f467]">
                              <div className="flex items-center gap-1.5 mb-1.5">
                                {portalLogoUrl ? (
                                  <img src={portalLogoUrl || undefined} alt="" className="w-4 h-4 rounded-full object-cover" />
                                ) : (
                                  <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#c5f467] to-[#22c55e] flex items-center justify-center">
                                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                  </div>
                                )}
                                <span className="text-[10px] font-medium text-[#1e2a4a]">{portalName || config?.name || 'AI Assistant'}</span>
                              </div>
                              <div className="pl-5 space-y-1.5">
                                <p className="text-xs text-[#334155]">Here are the key findings:</p>
                                {/* Styled bullet points with pink checkmarks */}
                                <div className="flex items-start gap-1.5">
                                  <svg className="w-3 h-3 text-[#f472b6] mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                  </svg>
                                  <span className="text-[11px] text-[#334155]"><strong>Revenue grew 23%</strong> year over year</span>
                                </div>
                                <div className="flex items-start gap-1.5">
                                  <svg className="w-3 h-3 text-[#f472b6] mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                                  </svg>
                                  <span className="text-[11px] text-[#334155]"><strong>Customer retention</strong> improved to 94%</span>
                                </div>
                                <p className="text-xs text-[#3b82f6] font-medium cursor-default">analysis_report.pdf</p>
                              </div>
                              {/* Thinking panel preview */}
                              <div className="mt-2 ml-5 bg-[#f8fafc] border border-[#e2e8f0] rounded-lg px-2.5 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <svg className="w-2.5 h-2.5 text-[#22c55e]" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                  </svg>
                                  <span className="text-[10px] text-[#334155] font-medium">Thinking & tools</span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#eff6ff] text-[#3b82f6]">2 tools</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          {/* Bottom input */}
                          <div className="border-t border-[#e2e8f0] px-4 py-2.5 flex items-center gap-2">
                            <div className="flex-1 px-3 py-2 text-xs text-[#94a3b8] border border-[#e2e8f0] rounded-lg bg-white">
                              Ask a follow up...
                            </div>
                            <div
                              className="px-3 py-1.5 rounded-lg text-white text-xs font-medium"
                              style={{ backgroundColor: portalButtonColor }}
                            >
                              Ask
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Save Button */}
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        setIsSavingPortalConfig(true);
                        setPortalConfigMessage('');
                        try {
                          const portalTheme: PortalTheme = {
                            primaryColor: portalPrimaryColor,
                            backgroundColor: portalBackgroundColor,
                            accentColor: portalAccentColor,
                            textColor: portalTextColor,
                            buttonColor: portalButtonColor,
                            fontFamily: portalFontFamily,
                          };
                          const updatePayload: any = {
                            embed_theme: JSON.stringify(portalTheme),
                            embed_greeting: portalGreeting || null,
                            portal_name: portalName || null,
                            portal_greeting: insightsPortalGreeting.trim() === '' ? null : insightsPortalGreeting,
                            portal_suggested_questions: suggestedQuestions.filter(q => q.trim() !== '').length > 0 
                              ? suggestedQuestions.filter(q => q.trim() !== '') 
                              : null,
                            portal_bucket_id: portalBucketId === 'none' ? null : (portalBucketId || null),
                            portal_files_hidden: portalBucketId === 'none',
                          };
                          console.log('[Portal Settings] Saving:', updatePayload);
                          await agentConfig.update(sessionId!, updatePayload);
                          setPortalConfigMessage('Portal settings saved!');
                          setTimeout(() => setPortalConfigMessage(''), 3000);
                        } catch (err) {
                          setPortalConfigMessage('Failed to save portal settings');
                        } finally {
                          setIsSavingPortalConfig(false);
                        }
                      }}
                      disabled={isSavingPortalConfig}
                      className="px-6 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                    >
                      {isSavingPortalConfig ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}

              {/* Custom CSS Sub-tab */}
              {portalSubTab === 'css' && (
                <>
                  <div>
                    <h2 className="text-xl font-semibold mb-2">Custom CSS</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Add custom CSS to deeply customize the Chat Portal appearance. This CSS is injected into the portal and iframe embed.
                    </p>
                  </div>

                  {/* Custom CSS Editor */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-2">CSS Editor</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Write custom CSS to customize the Chat Portal. The root element has class <code className="bg-slate-100 dark:bg-slate-800/50 px-1 rounded text-xs">.chat-portal</code>. Use the selectors below to target specific elements.
                    </p>
                    <textarea
                      value={customCSS}
                      onChange={(e) => setCustomCSS(e.target.value)}
                      placeholder={`/* ========================================
 * CHAT PORTAL — COMPLETE CSS REFERENCE
 * Every element has a CSS hook class.
 * Use !important to override inline styles.
 * ======================================== */

/* ── Layout ── */
.chat-portal { }          /* Root element */
.portal-container { }     /* Same as root */
.portal-sidebar { }       /* Left sidebar */
.portal-main { }          /* Main content area */
.portal-topbar { }        /* Top bar */
.portal-landing { }       /* Landing page */
.portal-hero { }          /* Landing hero section */
.portal-footer { }        /* Footer area */

/* ── Sidebar ── */
.portal-header { }        /* Sidebar header */
.portal-title { }         /* "Conversations" text */
.sidebar-collapse-btn { } /* Collapse chevron */
.sidebar-expand-btn { }   /* Expand hamburger */
.sidebar-new-btn { }      /* Header + button */
.new-thread-button { }    /* "New conversation" btn */
.thread-list { }          /* Thread scroll area */
.thread-empty { }         /* Empty state */

/* ── Threads ── */
.thread-item { }          /* Thread row */
.thread-active { }        /* Selected thread */
.thread-icon { }          /* Thread chat icon */
.thread-title { }         /* Thread title text */
.thread-date { }          /* Date/time text */
.share-button { }         /* Share hover btn */

/* ── Top Bar & Branding ── */
.portal-logo { }          /* Logo image */
.portal-name { }          /* Name text */
.portal-badge { }         /* "Beta" badge */
.portal-greeting { }      /* Greeting paragraph */
.portal-disclaimer { }    /* Footer disclaimer */
.files-button { }         /* Files toggle btn */
.files-active { }         /* Files btn active */
.files-count { }          /* Files count badge */

/* ── Messages ── */
.chat-container { }       /* Messages scroll area */
.chat-messages { }        /* Messages inner wrapper */
.message-bubble { }       /* Message card */
.message-user { }         /* User message */
.message-assistant { }    /* AI message */
.message-header { }       /* Avatar + name row */
.message-content { }      /* Message text */
.streaming-indicator { }  /* Typing dots */

/* ── Avatars & Labels ── */
.user-avatar { }          /* User circle icon */
.user-label { }           /* "You" text */
.assistant-avatar { }     /* AI circle icon */
.assistant-label { }      /* AI name text */

/* ── Input ── */
.input-container { }      /* Bottom input bar */
.input-field { }          /* Input border wrapper */
.send-button { }          /* "Ask" button */
.landing-form { }         /* Landing input form */

/* ── Landing Page ── */
.landing-title { }        /* Name heading */
.landing-logo { }         /* Logo wrapper */
.suggested-questions { }  /* Questions section */
.suggested-question { }   /* Question card */
.suggested-questions-header { }

/* ── Thinking & Tools ── */
.thinking-panel { }       /* Thinking wrapper */
.thinking-dots { }        /* Loading animation */
.thinking-entry { }       /* Individual thought */
.tool-activity { }        /* Tool list */

/* ── Files Sidebar ── */
.files-overlay { }        /* Backdrop */
.files-sidebar { }        /* Panel */
.files-header { }         /* Panel header */
.files-list { }           /* File list */
.files-empty { }          /* Empty state */
.file-item { }            /* File row */
.file-icon { }            /* File type icon */
.file-name { }            /* File name text */

/* ── Scrollbar ── */
.chat-portal *::-webkit-scrollbar { }
.chat-portal *::-webkit-scrollbar-thumb { }

/* ========================================
 * EXAMPLE: HIDE ELEMENTS
 * ======================================== */
/*
.portal-badge { display: none; }
.portal-disclaimer { display: none; }
.share-button { display: none; }
*/

/* ========================================
 * EXAMPLE: DARK MODE
 * ======================================== */
/*
.portal-container { background: #0f0f0f !important; }
.portal-sidebar { background: #1a1a1a !important; }
.portal-topbar { background: #1a1a1a !important; }
.message-assistant { background: #1a1a1a !important; }
.message-user { background: #1e1e2e !important; }
.input-field { background: #1a1a1a !important; border-color: #333 !important; }
.portal-name, .user-label, .assistant-label, .portal-title { color: #fff !important; }
.message-content { color: #e2e8f0 !important; }
.thread-item { color: #94a3b8 !important; }
*/`}
                      className="w-full h-96 px-4 py-3 bg-slate-900 dark:bg-slate-950 text-slate-100 border border-slate-700 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      spellCheck={false}
                    />
                  </div>

                  {/* CSS Presets */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Quick Start Templates</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => setCustomCSS(`/* Professional Light Theme (Default) */
.portal-container {
  background: #f8f9fa !important;
}

.portal-sidebar {
  background: #ffffff !important;
  border-right: 1px solid #e9ecef !important;
}

.message-user .message-content {
  background: #6366f1 !important;
  color: white !important;
}

.message-assistant .message-content {
  background: #ffffff !important;
  color: #1a1a1a !important;
  border: 1px solid #e9ecef !important;
}

.input-field {
  background: #ffffff !important;
  border: 1.5px solid #d1d5db !important;
}

.send-button {
  background: #6366f1 !important;
}

/* Light scrollbar */
::-webkit-scrollbar-track { background: #f1f5f9; }
::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #9ca3af; }`)}
                        className="px-4 py-3 bg-gradient-to-br from-purple-50 to-white dark:from-purple-500/10 dark:to-slate-800 border border-purple-200 dark:border-purple-500/20 rounded-lg text-sm hover:border-purple-400 dark:hover:border-purple-500/40 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-slate-900 dark:text-white">Professional Light</span>
                          <span className="text-[9px] bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1 py-0.5 rounded">Default</span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">Clean & modern</div>
                      </button>
                      
                      <button
                        onClick={() => setCustomCSS(`/* Modern Dark Theme */
.portal-container {
  background: #0f0f0f !important;
}

.portal-sidebar {
  background: #1a1a1a !important;
  border-right: 1px solid #2a2a2a !important;
}

.message-user .message-content {
  background: #3b82f6 !important;
  color: white !important;
}

.message-assistant .message-content {
  background: #1a1a1a !important;
  color: #e5e5e5 !important;
  border: 1px solid #2a2a2a !important;
}

.input-field {
  background: #0f0f0f !important;
  border: 1px solid #2a2a2a !important;
  color: #ffffff !important;
}

.send-button {
  background: #3b82f6 !important;
}

/* Dark scrollbar */
::-webkit-scrollbar-track { background: #0f0f0f; }
::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #3b82f6; }`)}
                        className="px-4 py-3 bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600 rounded-lg text-sm hover:border-blue-500/50 transition-colors text-left"
                      >
                        <div className="font-medium text-white mb-1">Modern Dark</div>
                        <div className="text-xs text-slate-400">Sleek dark mode</div>
                      </button>
                      
                      <button
                        onClick={() => setCustomCSS(`/* Neon Glow Theme */
.portal-container {
  background: #050505 !important;
}

.portal-sidebar {
  background: #0a0a0a !important;
  border-right: 1px solid rgba(139, 92, 246, 0.2) !important;
}

.message-user .message-content {
  background: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%) !important;
  box-shadow: 0 0 25px rgba(139, 92, 246, 0.4) !important;
}

.message-assistant .message-content {
  background: #0a0a0a !important;
  border: 1px solid rgba(139, 92, 246, 0.3) !important;
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.15) !important;
}

.send-button {
  background: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%) !important;
  box-shadow: 0 0 20px rgba(139, 92, 246, 0.4) !important;
}

.input-field {
  background: #050505 !important;
  border: 1px solid rgba(139, 92, 246, 0.3) !important;
}

/* Neon scrollbar */
::-webkit-scrollbar-track { background: #050505; }
::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.3); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #8b5cf6; }`)}
                        className="px-4 py-3 bg-gradient-to-br from-purple-900/50 to-pink-900/50 border border-purple-500/30 rounded-lg text-sm hover:border-purple-500/50 transition-colors text-left"
                      >
                        <div className="font-medium text-white mb-1">Neon Glow</div>
                        <div className="text-xs text-purple-300">Vibrant & glowing</div>
                      </button>
                    </div>
                  </div>

                  {/* CSS Class Reference */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Available CSS Classes — Every Element</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Layout</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.chat-portal</code> - Root element</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-container</code> - Main wrapper</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-sidebar</code> - Left sidebar</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-main</code> - Main content area</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-topbar</code> - Top bar</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-landing</code> - Landing page</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-hero</code> - Hero section</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-footer</code> - Footer area</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Sidebar</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-header</code> - Sidebar header</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-title</code> - "Conversations"</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.sidebar-collapse-btn</code> - Collapse btn</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.sidebar-expand-btn</code> - Expand btn</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.sidebar-new-btn</code> - Header + btn</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.new-thread-button</code> - New chat btn</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-list</code> - Thread list</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-empty</code> - Empty state</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Threads</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-item</code> - Thread row</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-active</code> - Active thread</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-icon</code> - Thread icon</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-title</code> - Thread title</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thread-date</code> - Date/time</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.share-button</code> - Share btn</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Top Bar & Branding</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-logo</code> - Logo image</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-name</code> - Name text</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-badge</code> - Beta badge</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-greeting</code> - Greeting text</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.portal-disclaimer</code> - Footer text</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-button</code> - Files toggle</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-active</code> - Files active</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-count</code> - Files badge</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Messages</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.chat-container</code> - Scroll area</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.chat-messages</code> - Messages inner</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.message-bubble</code> - Message card</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.message-user</code> - User message</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.message-assistant</code> - AI message</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.message-header</code> - Avatar + name</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.message-content</code> - Message text</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.streaming-indicator</code> - Typing dots</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Avatars & Labels</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.user-avatar</code> - User icon circle</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.user-label</code> - "You" text</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.assistant-avatar</code> - AI icon circle</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.assistant-label</code> - AI name text</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Input Area</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.input-container</code> - Bottom bar</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.input-field</code> - Input wrapper</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.send-button</code> - Ask button</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.landing-form</code> - Landing input</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Landing Page</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.landing-title</code> - Name heading</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.landing-logo</code> - Logo wrapper</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.suggested-questions</code> - Questions list</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.suggested-question</code> - Question card</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.suggested-questions-header</code> - Header</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Thinking & Tools</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thinking-panel</code> - Panel wrapper</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thinking-dots</code> - Loading dots</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.thinking-entry</code> - Thinking item</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.tool-activity</code> - Tool list</li>
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white mb-2">Files Sidebar</h4>
                        <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 font-mono">
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-overlay</code> - Backdrop</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-sidebar</code> - Panel</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-header</code> - Header</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-list</code> - File list</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.files-empty</code> - Empty state</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.file-item</code> - File row</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.file-icon</code> - File type icon</li>
                          <li>• <code className="bg-slate-100 dark:bg-slate-900 px-1 rounded">.file-name</code> - File name</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* CSS Tips & Advanced Techniques */}
                  <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-3">💡 CSS Tips & Advanced Techniques</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Basics</h5>
                        <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                          <li>• Use <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">!important</code> to override inline styles</li>
                          <li>• Target specific states with <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">:hover</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">:focus</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">:active</code></li>
                          <li>• Use CSS variables: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">:root {"{ --color: #fff; }"}</code></li>
                          <li>• Combine selectors: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.message-user .message-content</code></li>
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Visual Effects</h5>
                        <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                          <li>• Neon glow: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">box-shadow: 0 0 20px rgba(139,92,246,0.4)</code></li>
                          <li>• Shadows: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">box-shadow: 0 4px 12px rgba(0,0,0,0.15)</code></li>
                          <li>• Gradients: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">linear-gradient(135deg, ...)</code></li>
                          <li>• Transforms: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">transform: scale(1.05)</code></li>
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Animations</h5>
                        <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                          <li>• Define: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">@keyframes slideIn {"{ ... }"}</code></li>
                          <li>• Apply: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">animation: slideIn 0.3s ease</code></li>
                          <li>• Transitions: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">transition: all 0.3s ease</code></li>
                          <li>• Delays: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">animation-delay: 0.2s</code></li>
                        </ul>
                      </div>
                      <div>
                        <h5 className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Layout</h5>
                        <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                          <li>• Max width: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">max-width: 900px</code></li>
                          <li>• Centering: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">margin: 0 auto</code></li>
                          <li>• Spacing: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">padding, margin, gap</code></li>
                          <li>• Scrollbars: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">::-webkit-scrollbar</code></li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        setIsSavingPortalConfig(true);
                        setPortalConfigMessage('');
                        try {
                          await agentConfig.update(sessionId!, {
                            portal_custom_css: customCSS || undefined,
                          });
                          setPortalConfigMessage('Custom CSS saved!');
                          setTimeout(() => setPortalConfigMessage(''), 3000);
                        } catch (err) {
                          setPortalConfigMessage('Failed to save custom CSS');
                        } finally {
                          setIsSavingPortalConfig(false);
                        }
                      }}
                      disabled={isSavingPortalConfig}
                      className="px-6 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                    >
                      {isSavingPortalConfig ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>

                  {portalConfigMessage && (
                    <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg text-sm">
                      {portalConfigMessage}
                    </div>
                  )}
                </>
              )}

              {/* Embed Sub-tab */}
              {portalSubTab === 'embed' && (
                <>
                  <div>
                    <h2 className="text-xl font-semibold mb-2">Iframe Embed</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      Embed the portal as an iframe in your website with deep CSS customization.
                    </p>
                  </div>

                  {/* Iframe Code */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Embed Code</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Copy and paste this code into your website to embed the portal:
                    </p>
                    <div className="relative">
                      <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-4 rounded-lg overflow-x-auto text-xs font-mono">
{`<iframe
  src="${window.location.origin}/chat/${sessionId}"
  width="100%"
  height="600"
  frameborder="0"
  allow="clipboard-write"
  style="border-radius: 8px;"
></iframe>`}
                      </pre>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`<iframe src="${window.location.origin}/chat/${sessionId}" width="100%" height="600" frameborder="0" allow="clipboard-write" style="border-radius: 8px;"></iframe>`);
                          setCopied('iframe-code');
                          setTimeout(() => setCopied(null), 2000);
                        }}
                        className={`absolute top-2 right-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                          copied === 'iframe-code'
                            ? 'bg-green-600 text-white'
                            : 'bg-slate-700 text-white hover:bg-slate-600'
                        }`}
                      >
                        {copied === 'iframe-code' ? '✓ Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* Custom CSS */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-2">Custom CSS</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
                      Add custom CSS to deeply customize the portal appearance. This CSS will be injected into the iframe.
                    </p>
                    <textarea
                      value={customCSS}
                      onChange={(e) => setCustomCSS(e.target.value)}
                      placeholder={`/* Every element is customizable — see class reference below */

/* Layout & Background */
.portal-container { background: #f8fafc; }
.portal-sidebar { background: #fff; border-right: 1px solid #e2e8f0; }
.portal-topbar { background: #fff; border-bottom: 1px solid #e2e8f0; }
.portal-landing { background: #fafbfc; }

/* Branding */
.portal-logo { height: 28px; }
.portal-name { color: #1e2a4a; font-weight: 600; }
.portal-badge { display: none; } /* hide Beta badge */
.portal-greeting { color: #64748b; }
.portal-disclaimer { display: none; } /* hide disclaimer */

/* Messages */
.message-user { border-left-color: #3b82f6 !important; }
.message-assistant { border-left-color: #22c55e !important; }
.user-avatar { background: #3b82f6; }
.assistant-avatar { background: linear-gradient(135deg, #c5f467, #22c55e); }

/* Input & Buttons */
.send-button { background: #6366f1 !important; border-radius: 8px; }
.send-button:hover { transform: scale(1.02); }
.input-field { border-radius: 12px; border: 1px solid #e2e8f0; }

/* Threads & Sidebar */
.thread-item:hover { background: #f8fafc; }
.new-thread-button { border-radius: 8px; }

/* Landing Page */
.suggested-question { border-radius: 12px; }
.suggested-question:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }

/* Files */
.files-sidebar { width: 320px; }
.file-item:hover { background: #f8fafc; }`}
                      className="w-full h-64 px-4 py-3 bg-slate-900 dark:bg-slate-950 text-slate-100 border border-slate-700 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                      spellCheck={false}
                    />
                    <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg">
                      <p className="text-sm text-blue-900 dark:text-blue-300 mb-2 font-medium">
                        See the "Custom CSS" tab above for the full class reference (50+ hooks).
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-400">
                        Key classes: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.portal-container</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.portal-sidebar</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.message-user</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.message-assistant</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.send-button</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.input-field</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.suggested-question</code>, <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">.files-sidebar</code>
                      </p>
                    </div>
                  </div>

                  {/* Save Button */}
                  <div className="flex justify-end">
                    <button
                      onClick={async () => {
                        setIsSavingPortalConfig(true);
                        setPortalConfigMessage('');
                        try {
                          await agentConfig.update(sessionId!, {
                            portal_custom_css: customCSS || undefined,
                          });
                          setPortalConfigMessage('Embed settings saved!');
                          setTimeout(() => setPortalConfigMessage(''), 3000);
                        } catch (err) {
                          setPortalConfigMessage('Failed to save embed settings');
                        } finally {
                          setIsSavingPortalConfig(false);
                        }
                      }}
                      disabled={isSavingPortalConfig}
                      className="px-6 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                    >
                      {isSavingPortalConfig ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>

                  {portalConfigMessage && (
                    <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400 px-4 py-3 rounded-lg text-sm">
                      {portalConfigMessage}
                    </div>
                  )}
                </>
              )}

              {/* Users Sub-tab */}
              {portalSubTab === 'users' && (
                <>
                  {/* View: User selected - show Portal-like interface */}
                  {selectedPortalUser ? (
                    <div className="flex flex-col h-[600px]">
                      {/* Header with back button and user info */}
                      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white/5 rounded-t-lg">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              setSelectedPortalUser(null);
                              setSelectedPortalThread(null);
                              setPortalUserThreads([]);
                              setPortalThreadMessages([]);
                            }}
                            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                          >
                            ← Back to Users
                          </button>
                          <div>
                            <div className="font-medium">{selectedPortalUser.displayName}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded ${
                                selectedPortalUser.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                              }`}>
                                {selectedPortalUser.type}
                              </span>
                              <span>{selectedPortalUser.identifier}</span>
                              <span>•</span>
                              <span>Active {new Date(selectedPortalUser.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        {Object.keys(selectedPortalUser.userContext).length > 0 && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white">View Context</summary>
                            <pre className="absolute right-4 mt-2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs max-w-md overflow-auto z-10">
                              {JSON.stringify(selectedPortalUser.userContext, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>

                      {/* Portal-like layout: Threads sidebar + Chat area */}
                      <div className="flex flex-1 overflow-hidden border-x border-b border-slate-200 dark:border-slate-700 rounded-b-lg">
                        {/* Threads Sidebar */}
                        <div className="w-64 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-800/20">
                          <div className="p-3 border-b border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-500 dark:text-slate-400">
                            Conversations ({portalUserThreads.length})
                          </div>
                          <div className="flex-1 overflow-y-auto">
                            {isLoadingPortalThreads ? (
                              <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
                            ) : portalUserThreads.length === 0 ? (
                              <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">No conversations</div>
                            ) : (
                              portalUserThreads.map((thread) => (
                                <button
                                  key={thread.id}
                                  onClick={() => loadPortalThreadMessages(thread)}
                                  className={`w-full p-3 text-left border-b border-slate-200 dark:border-slate-700/50 hover:bg-white/5 transition-colors ${
                                    selectedPortalThread?.id === thread.id ? 'bg-white/10 border-l-2 border-l-indigo-500' : ''
                                  }`}
                                >
                                  <div className="font-medium text-sm truncate">
                                    {thread.title || 'Untitled'}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    {thread.messageCount} messages
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Chat Area */}
                        <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900">
                          {!selectedPortalThread ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                              Select a conversation to view messages
                            </div>
                          ) : (
                            <>
                              {/* Thread Header */}
                              <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/50">
                                <div className="font-medium text-slate-900 dark:text-white">{selectedPortalThread.title || 'Conversation'}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {selectedPortalThread.messageCount} messages • Started {new Date(selectedPortalThread.createdAt).toLocaleDateString()}
                                </div>
                              </div>

                              {/* Messages */}
                              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {isLoadingPortalMessages ? (
                                  <div className="text-center text-slate-500 dark:text-slate-400">Loading messages...</div>
                                ) : portalThreadMessages.length === 0 ? (
                                  <div className="text-center text-slate-500 dark:text-slate-400">No messages in this conversation</div>
                                ) : (
                                  portalThreadMessages.map((msg) => (
                                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                      <div
                                        className={`max-w-[80%] p-4 rounded-2xl ${
                                          msg.role === 'user'
                                            ? 'bg-indigo-600 dark:bg-indigo-600 text-white rounded-br-md shadow-sm'
                                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-md shadow-sm'
                                        }`}
                                      >
                                        <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                                        <div className={`text-xs mt-2 ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* View: No user selected - show user list */
                    <>
                      {/* Stats Overview */}
                      {portalStats && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                          <div className="p-4 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-lg text-center">
                            <div className="text-3xl font-bold">{portalStats.totalUsers}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Total Users</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold text-indigo-400">{portalStats.portalUsers}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Portal</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold text-green-700 dark:text-green-400">{portalStats.embedUsers}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Embed</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold">{portalStats.totalThreads}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Threads</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold">{portalStats.totalMessages}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Messages</div>
                          </div>
                        </div>
                      )}

                      {/* Users List */}
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-medium">Users</h3>
                          <button 
                            onClick={loadPortalUsers}
                            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                          >
                            ↻ Refresh
                          </button>
                        </div>

                        {isLoadingPortalUsers ? (
                          <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading users...</div>
                        ) : portalUsers.length === 0 ? (
                          <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                            <div className="text-4xl mb-4">👤</div>
                            <div className="text-lg font-medium mb-2">No users yet</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">
                              Users will appear here when they interact with your Portal or Embed chat.
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            {portalUsers.map((user) => (
                              <button
                                key={user.id}
                                onClick={() => loadPortalUserThreads(user)}
                                className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-white/5 hover:border-white/20 transition-all text-left group"
                              >
                                <div className="flex items-center gap-4">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium ${
                                    user.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                  }`}>
                                    {user.displayName.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="font-medium group-hover:text-slate-900 dark:text-white transition-colors">
                                      {user.displayName}
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400">
                                      {user.identifier}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className={`text-xs px-2 py-1 rounded ${
                                    user.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                  }`}>
                                    {user.type}
                                  </span>
                                  <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {new Date(user.updatedAt).toLocaleDateString()}
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:text-white transition-colors">→</span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
              </div>
            </div>
          </div>
        )}

        {/* Knowledge Tab */}
        {activeTab === 'knowledge' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-2">Knowledge Bases</h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm">
                  Attach knowledge bases to enable RAG (Retrieval-Augmented Generation). 
                  The agent will automatically search relevant documents when responding.
                </p>
              </div>

              {isLoadingKnowledge ? (
                <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading knowledge bases...</div>
              ) : (
                <>
                  {/* Attached Knowledge Bases */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Attached Knowledge Bases</h3>
                    {attachedKnowledgeBases.length === 0 ? (
                      <p className="text-slate-500 dark:text-slate-400 text-sm">No knowledge bases attached to this agent.</p>
                    ) : (
                      <div className="space-y-3">
                        {attachedKnowledgeBases.map(kb => (
                          <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{kb.name}</span>
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  kb.status === 'ready' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                  kb.status === 'indexing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                  'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400'
                                }`}>
                                  {kb.status}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {kb.indexed_files} files • {kb.indexed_chunks} chunks
                              </div>
                            </div>
                            <button
                              onClick={() => handleDetachKnowledgeBase(kb.id)}
                              className="px-3 py-1.5 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                            >
                              Detach
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Available Knowledge Bases */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-4">Available Knowledge Bases</h3>
                    {allKnowledgeBases.filter(kb => !attachedKnowledgeBases.some(akb => akb.id === kb.id)).length === 0 ? (
                      <div className="text-center py-4">
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">No additional knowledge bases available.</p>
                        <a
                          href="/knowledge"
                          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                        >
                          Create a knowledge base →
                        </a>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {allKnowledgeBases
                          .filter(kb => !attachedKnowledgeBases.some(akb => akb.id === kb.id))
                          .map(kb => (
                            <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{kb.name}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs ${
                                    kb.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                                    kb.status === 'indexing' ? 'bg-blue-500/20 text-blue-400' :
                                    'bg-gray-500/20 text-slate-500 dark:text-slate-400'
                                  }`}>
                                    {kb.status}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  {kb.indexed_files} files • {kb.indexed_chunks} chunks
                                </div>
                              </div>
                              <button
                                onClick={() => handleAttachKnowledgeBase(kb.id)}
                                disabled={kb.status !== 'ready'}
                                className="px-3 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                Attach
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* How RAG Works */}
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                    <h3 className="font-medium mb-2">How RAG Works</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      When this agent receives a message, it will:
                    </p>
                    <ol className="text-sm text-slate-500 dark:text-slate-400 mt-2 space-y-1 list-decimal list-inside">
                      <li>Search attached knowledge bases for relevant content</li>
                      <li>Inject the most relevant chunks into the context</li>
                      <li>Generate a response informed by your documents</li>
                    </ol>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Executions Tab */}
        {activeTab === 'executions' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto space-y-8">
              {/* Tab heading */}
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">Executions</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  View all production runs from SDK, API, and Portal sessions
                </p>
              </div>

              {/* Sub-tabs for API, SDK, and Portal */}
              <div className="flex gap-4 border-b border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setExecutionsSubTab('api')}
                  className={`pb-2 text-sm border-b-2 transition-colors ${
                    executionsSubTab === 'api'
                      ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  API Runs
                </button>
                <button
                  onClick={() => setExecutionsSubTab('sdk')}
                  className={`pb-2 text-sm border-b-2 transition-colors ${
                    executionsSubTab === 'sdk'
                      ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  SDK Runs
                </button>
                {/* <button
                  onClick={() => setExecutionsSubTab('portal')}
                  className={`pb-2 text-sm border-b-2 transition-colors ${
                    executionsSubTab === 'portal'
                      ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  Portal Sessions
                </button> */}
              </div>

              {/* API Runs */}
              {executionsSubTab === 'api' && (
                <div>
                  {selectedRun ? (
                    /* Run Detail View */
                    <div className="space-y-4">
                      <button
                        onClick={() => setSelectedRun(null)}
                        className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
                      >
                        ← Back to list
                      </button>

                      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-mono text-sm text-slate-900 dark:text-white">{selectedRun.id}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {new Date(selectedRun.created_at).toLocaleString()}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded ${
                            selectedRun.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                            selectedRun.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                            selectedRun.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                            'bg-slate-200 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400'
                          }`}>
                            {selectedRun.status}
                          </span>
                        </div>

                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                          <div className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap text-slate-900 dark:text-white">
                            {selectedRun.prompt}
                          </div>
                        </div>

                        {selectedRun.result && (
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Result</label>
                            <div className="text-sm bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-green-700 dark:text-green-300">
                              {selectedRun.result}
                            </div>
                          </div>
                        )}

                        {selectedRun.structured_output && (
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Structured Output</label>
                            <pre className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-slate-900 dark:text-white">
                              {JSON.stringify(selectedRun.structured_output, null, 2)}
                            </pre>
                          </div>
                        )}

                        {selectedRun.error && (
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Error</label>
                            <div className="text-sm bg-red-500/10 border border-red-500/30 p-3 rounded font-mono whitespace-pre-wrap text-red-700 dark:text-red-300">
                              {selectedRun.error}
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <div>Source: <span className="text-slate-900 dark:text-white">{selectedRun.source}</span></div>
                          {selectedRun.started_at && (
                            <div>Started: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.started_at).toLocaleString()}</span></div>
                          )}
                          {selectedRun.completed_at && (
                            <div>Completed: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.completed_at).toLocaleString()}</span></div>
                          )}
                          {selectedRun.completed_at && selectedRun.started_at && (
                            <div>Duration: <span className="text-slate-900 dark:text-white">{Math.round((new Date(selectedRun.completed_at).getTime() - new Date(selectedRun.started_at).getTime()) / 1000)}s</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Run List View */
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-sm font-medium">API Runs</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Direct API calls without SDK sessions
                          </p>
                        </div>
                        <button 
                          onClick={loadRuns}
                          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                        >
                          ↻ Refresh
                        </button>
                      </div>

                      {isLoadingRuns ? (
                        <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading runs...</div>
                      ) : apiRuns.length === 0 ? (
                        <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                          <div className="text-4xl mb-4">📋</div>
                          <div className="text-lg font-medium mb-2">No API runs yet</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">
                            API runs will appear here when you make direct API calls
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {apiRuns.map((run) => (
                            <button
                              key={run.id}
                              onClick={() => setSelectedRun(run)}
                              className="w-full text-left p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`px-2 py-0.5 text-xs rounded ${
                                      run.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' :
                                      run.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' :
                                      run.status === 'processing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                                      'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300'
                                    }`}>
                                      {run.status}
                                    </span>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      {new Date(run.created_at).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="text-sm text-slate-900 dark:text-white truncate mb-2">
                                    {run.prompt}
                                  </div>
                                  {run.result && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                      Result: {run.result.substring(0, 100)}...
                                    </div>
                                  )}
                                  {run.error && (
                                    <div className="text-xs text-red-600 dark:text-red-400 truncate">
                                      Error: {run.error}
                                    </div>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {run.completed_at && run.started_at && (
                                    <span>
                                      {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* SDK Runs */}
              {executionsSubTab === 'sdk' && (
                <div>
                  {selectedRun ? (
                    /* Run Detail View */
                    <div className="space-y-4">
                      <button
                        onClick={() => setSelectedRun(null)}
                        className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
                      >
                        ← Back to list
                      </button>

                      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-mono text-sm text-slate-900 dark:text-white">{selectedRun.id}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {new Date(selectedRun.created_at).toLocaleString()}
                            </div>
                            {selectedRun.sdk_session_id && (
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                Session: {selectedRun.sdk_session_id}
                              </div>
                            )}
                          </div>
                          <span className={`px-2 py-0.5 text-xs rounded ${
                            selectedRun.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                            selectedRun.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                            selectedRun.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                            'bg-slate-200 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400'
                          }`}>
                            {selectedRun.status}
                          </span>
                        </div>

                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                          <div className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap text-slate-900 dark:text-white">
                            {selectedRun.prompt}
                          </div>
                        </div>

                        {selectedRun.result && (
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Result</label>
                            <div className="text-sm bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-green-700 dark:text-green-300">
                              {selectedRun.result}
                            </div>
                          </div>
                        )}

                        {selectedRun.structured_output && (
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Structured Output</label>
                            <pre className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-slate-900 dark:text-white">
                              {JSON.stringify(selectedRun.structured_output, null, 2)}
                            </pre>
                          </div>
                        )}

                        {selectedRun.error && (
                          <div>
                            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Error</label>
                            <div className="text-sm bg-red-500/10 border border-red-500/30 p-3 rounded font-mono whitespace-pre-wrap text-red-700 dark:text-red-300">
                              {selectedRun.error}
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <div>Source: <span className="text-slate-900 dark:text-white">{selectedRun.source}</span></div>
                          {selectedRun.started_at && (
                            <div>Started: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.started_at).toLocaleString()}</span></div>
                          )}
                          {selectedRun.completed_at && (
                            <div>Completed: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.completed_at).toLocaleString()}</span></div>
                          )}
                          {selectedRun.completed_at && selectedRun.started_at && (
                            <div>Duration: <span className="text-slate-900 dark:text-white">{Math.round((new Date(selectedRun.completed_at).getTime() - new Date(selectedRun.started_at).getTime()) / 1000)}s</span></div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Run List View */
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-sm font-medium">SDK Runs</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            SDK session-based executions
                          </p>
                        </div>
                        <button 
                          onClick={loadRuns}
                          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                        >
                          ↻ Refresh
                        </button>
                      </div>

                      {isLoadingRuns ? (
                        <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading runs...</div>
                      ) : sdkRuns.length === 0 ? (
                        <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                          <div className="text-4xl mb-4">🔗</div>
                          <div className="text-lg font-medium mb-2">No SDK runs yet</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">
                            SDK runs will appear here when you use the SDK with sessions
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {sdkRuns.map((run) => (
                            <button
                              key={run.id}
                              onClick={() => setSelectedRun(run)}
                              className="w-full text-left p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className={`px-2 py-0.5 text-xs rounded ${
                                      run.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' :
                                      run.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' :
                                      run.status === 'processing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                                      'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300'
                                    }`}>
                                      {run.status}
                                    </span>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      Session: {run.sdk_session_id?.substring(0, 8)}...
                                    </span>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      {new Date(run.created_at).toLocaleString()}
                                    </span>
                                  </div>
                                  <div className="text-sm text-slate-900 dark:text-white truncate mb-2">
                                    {run.prompt}
                                  </div>
                                  {run.result && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                      Result: {run.result.substring(0, 100)}...
                                    </div>
                                  )}
                                  {run.error && (
                                    <div className="text-xs text-red-600 dark:text-red-400 truncate">
                                      Error: {run.error}
                                    </div>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {run.completed_at && run.started_at && (
                                    <span>
                                      {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Portal Sessions */}
              {executionsSubTab === 'portal' && (
                <>
                  {/* View: User selected - show Portal-like interface */}
                  {selectedPortalUser ? (
                    <div className="flex flex-col h-[600px]">
                      {/* Header with back button and user info */}
                      <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white/5 rounded-t-lg">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => {
                              setSelectedPortalUser(null);
                              setSelectedPortalThread(null);
                              setPortalUserThreads([]);
                              setPortalThreadMessages([]);
                            }}
                            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                          >
                            ← Back to Users
                          </button>
                          <div>
                            <div className="font-medium">{selectedPortalUser.displayName}</div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                              <span className={`px-2 py-0.5 rounded ${
                                selectedPortalUser.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                              }`}>
                                {selectedPortalUser.type}
                              </span>
                              <span>{selectedPortalUser.identifier}</span>
                              <span>•</span>
                              <span>Active {new Date(selectedPortalUser.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                        {Object.keys(selectedPortalUser.userContext).length > 0 && (
                          <details className="text-sm">
                            <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white">View Context</summary>
                            <pre className="absolute right-4 mt-2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs max-w-md overflow-auto z-10">
                              {JSON.stringify(selectedPortalUser.userContext, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>

                      {/* Portal-like layout: Threads sidebar + Chat area */}
                      <div className="flex flex-1 overflow-hidden border-x border-b border-slate-200 dark:border-slate-700 rounded-b-lg">
                        {/* Threads Sidebar */}
                        <div className="w-64 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-800/20">
                          <div className="p-3 border-b border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-500 dark:text-slate-400">
                            Conversations ({portalUserThreads.length})
                          </div>
                          <div className="flex-1 overflow-y-auto">
                            {isLoadingPortalThreads ? (
                              <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
                            ) : portalUserThreads.length === 0 ? (
                              <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">No conversations</div>
                            ) : (
                              portalUserThreads.map((thread) => (
                                <button
                                  key={thread.id}
                                  onClick={() => loadPortalThreadMessages(thread)}
                                  className={`w-full p-3 text-left border-b border-slate-200 dark:border-slate-700/50 hover:bg-white/5 transition-colors ${
                                    selectedPortalThread?.id === thread.id ? 'bg-white/10 border-l-2 border-l-indigo-500' : ''
                                  }`}
                                >
                                  <div className="font-medium text-sm truncate">
                                    {thread.title || 'Untitled'}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    {thread.messageCount} messages
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </div>

                        {/* Chat Area */}
                        <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900">
                          {!selectedPortalThread ? (
                            <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                              Select a conversation to view messages
                            </div>
                          ) : (
                            <>
                              {/* Thread Header */}
                              <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/50">
                                <div className="font-medium text-slate-900 dark:text-white">{selectedPortalThread.title || 'Conversation'}</div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {selectedPortalThread.messageCount} messages • Started {new Date(selectedPortalThread.createdAt).toLocaleDateString()}
                                </div>
                              </div>

                              {/* Messages */}
                              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {isLoadingPortalMessages ? (
                                  <div className="text-center text-slate-500 dark:text-slate-400">Loading messages...</div>
                                ) : portalThreadMessages.length === 0 ? (
                                  <div className="text-center text-slate-500 dark:text-slate-400">No messages in this conversation</div>
                                ) : (
                                  portalThreadMessages.map((msg) => (
                                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                      <div
                                        className={`max-w-[80%] p-4 rounded-2xl ${
                                          msg.role === 'user'
                                            ? 'bg-indigo-600 dark:bg-indigo-600 text-white rounded-br-md shadow-sm'
                                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-md shadow-sm'
                                        }`}
                                      >
                                        <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                                        <div className={`text-xs mt-2 ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* View: No user selected - show user list */
                    <>
                      {/* Stats Overview */}
                      {portalStats && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                          <div className="p-4 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-lg text-center">
                            <div className="text-3xl font-bold">{portalStats.totalUsers}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Total Users</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold text-indigo-400">{portalStats.portalUsers}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Portal</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold text-green-700 dark:text-green-400">{portalStats.embedUsers}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Embed</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold">{portalStats.totalThreads}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Threads</div>
                          </div>
                          <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                            <div className="text-2xl font-bold">{portalStats.totalMessages}</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">Messages</div>
                          </div>
                        </div>
                      )}

                      {/* Users List */}
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-medium">Portal Users</h3>
                          <button 
                            onClick={loadPortalUsers}
                            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                          >
                            ↻ Refresh
                          </button>
                        </div>

                        {isLoadingPortalUsers ? (
                          <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading users...</div>
                        ) : portalUsers.length === 0 ? (
                          <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                            <div className="text-4xl mb-4">👤</div>
                            <div className="text-lg font-medium mb-2">No users yet</div>
                            <div className="text-sm text-slate-500 dark:text-slate-400">
                              Users will appear here when they interact with your Portal or Embed chat.
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3">
                            {portalUsers.map((user) => (
                              <button
                                key={user.id}
                                onClick={() => loadPortalUserThreads(user)}
                                className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-white/5 hover:border-white/20 transition-all text-left group"
                              >
                                <div className="flex items-center gap-4">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium ${
                                    user.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                  }`}>
                                    {user.displayName.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                    <div className="font-medium group-hover:text-slate-900 dark:text-white transition-colors">
                                      {user.displayName}
                                    </div>
                                    <div className="text-sm text-slate-500 dark:text-slate-400">
                                      {user.identifier}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className={`text-xs px-2 py-1 rounded ${
                                    user.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                  }`}>
                                    {user.type}
                                  </span>
                                  <span className="text-sm text-slate-500 dark:text-slate-400">
                                    {new Date(user.updatedAt).toLocaleDateString()}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* API/SDK Preview Tab */}
        {activeTab === 'playground' && (
          <div className="flex-1 flex flex-col">
            {/* Tab heading */}
            <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-900">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">API/SDK Preview</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Test single-shot executions like your developers will use via API or SDK
                </p>
              </div>
            </div>

            {/* Config Summary */}
            <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-3 bg-slate-50 dark:bg-slate-900">
              <div className="max-w-4xl mx-auto">
                <button
                  onClick={() => setShowConfig(!showConfig)}
                  className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                >
                  <svg className={`w-4 h-4 transition-transform ${showConfig ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Configuration
                  {config?.system_prompt && (
                    <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 text-xs rounded">System Prompt</span>
                  )}
                  {config?.name && (
                    <span className="text-slate-500 dark:text-slate-400">· {config.name}</span>
                  )}
                </button>
                {showConfig && config && (
                  <div className="mt-3 space-y-3 text-sm">
                    {config.system_prompt && (
                      <div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">System Prompt</div>
                        <pre className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-3 text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
                          {config.system_prompt}
                        </pre>
                      </div>
                    )}
                    {config.allowed_tools && (
                      <div className="text-xs">
                        <span className="text-slate-500 dark:text-slate-400">Tools: </span>
                        <span className="text-slate-500 dark:text-slate-400">{JSON.parse(config.allowed_tools).join(', ') || 'All'}</span>
                      </div>
                    )}
                    {!config.system_prompt && (
                      <p className="text-xs text-yellow-400">No system prompt configured. Add one in the Configure tab.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Input Section */}
            <div className="border-b border-slate-200 dark:border-slate-700 p-6">
              <div className="max-w-4xl mx-auto">
                <form onSubmit={handleExecutePrompt} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Prompt</label>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Enter a prompt..."
                      rows={4}
                      disabled={isRunningTask || isStartingSandbox}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-white/20 focus:border-white/30 text-sm font-mono disabled:opacity-50 resize-none"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                      Default is "execute" to run the agent with its configured system prompt. Edit to customize.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    {isRunningTask && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsRunningTask(false);
                          setStreamingOutput(prev => [...prev, '__STATUS__Task cancelled by user']);
                        }}
                        className="border border-red-500/50 text-red-400 px-4 py-2.5 rounded text-sm font-medium hover:bg-red-500/10"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!prompt.trim() || isRunningTask || isStartingSandbox}
                      className="bg-slate-800 dark:bg-indigo-600 text-white px-6 py-2.5 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500 flex items-center gap-2"
                    >
                      {isStartingSandbox ? (
                        <>
                          <span className="animate-spin w-4 h-4 border-2 border-black border-t-transparent rounded-full" />
                          Starting...
                        </>
                      ) : isRunningTask ? (
                        <>
                          <span className="animate-spin w-4 h-4 border-2 border-black border-t-transparent rounded-full" />
                          Running...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          Run
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Output Section */}
            <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-white dark:bg-slate-900">
              <div className="max-w-4xl mx-auto pb-8">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">Output</h3>
                    {isRunningTask && (
                      <span className="text-xs text-yellow-400 flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                        Running for {elapsedTime}s...
                      </span>
                    )}
                  </div>
                  {(streamingOutput.length > 0 || currentTask) && (
                    <button
                      onClick={clearOutput}
                      disabled={isRunningTask}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white disabled:opacity-50"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {streamingOutput.length === 0 && !currentTask && !isRunningTask && (
                  <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                    <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p>Click Run to execute the agent</p>
                    {config?.system_prompt && (
                      <p className="text-xs mt-2 text-slate-500 dark:text-slate-400">System prompt will be applied</p>
                    )}
                  </div>
                )}

                {(streamingOutput.length > 0 || isRunningTask) && (
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 font-mono text-sm">
                    {isRunningTask && streamingOutput.length === 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-yellow-400">
                          <span className="animate-spin w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full" />
                          Agent is processing...
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {elapsedTime < 10 && 'Initializing sandbox and agent...'}
                          {elapsedTime >= 10 && elapsedTime < 30 && 'Agent is working on the task...'}
                          {elapsedTime >= 30 && elapsedTime < 60 && 'Still working... The agent may be making web requests or processing data.'}
                          {elapsedTime >= 60 && 'Taking longer than expected. Check the Configure tab for complex system prompts.'}
                        </div>
                        {!isConnected && (
                          <div className="text-xs text-red-700 dark:text-red-400 mt-2">
                            WebSocket disconnected - output may not stream in real-time
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="space-y-1">
                      {streamingOutput.map((line, i) => {
                        const isStatus = line.startsWith('__STATUS__');
                        const text = isStatus ? line.replace('__STATUS__', '') : line;
                        return (
                          <div 
                            key={i} 
                            className={`whitespace-pre-wrap ${isStatus ? 'text-blue-700 dark:text-blue-400 text-xs' : 'text-slate-600 dark:text-slate-300'}`}
                          >
                            {text}
                          </div>
                        );
                      })}
                    </div>
                    
                    {isRunningTask && (
                      <span className="inline-block w-2 h-4 bg-white/70 ml-1 animate-pulse mt-2" />
                    )}
                    
                    <div ref={outputEndRef} />
                  </div>
                )}

                {/* Task Status */}
                {currentTask && !isRunningTask && (
                  <div className={`mt-4 p-3 rounded-lg border text-sm ${
                    currentTask.status === 'completed' 
                      ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-400'
                      : currentTask.status === 'failed'
                      ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400'
                      : 'bg-gray-50 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30 text-slate-500 dark:text-slate-400'
                  }`}>
                    <div className="flex items-center gap-2">
                      {currentTask.status === 'completed' ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : currentTask.status === 'failed' ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      ) : null}
                      Task {currentTask.status}
                    </div>
                  </div>
                )}

                {/* Recent Runs */}
                {tasks.length > 0 && (
                  <div className="mt-8">
                    <h4 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3">Recent Runs</h4>
                    <div className="space-y-2">
                      {tasks.slice(-10).reverse().map((task) => (
                        <div 
                          key={task.id}
                          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm overflow-hidden"
                        >
                          <button
                            onClick={() => setCurrentTask(currentTask?.id === task.id ? null : task)}
                            className="w-full flex items-center justify-between p-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-left"
                          >
                            <span className="text-slate-500 dark:text-slate-400 truncate flex-1 font-mono text-xs">
                              {task.prompt.slice(0, 60)}{task.prompt.length > 60 ? '...' : ''}
                            </span>
                            <div className="flex items-center gap-2 ml-3">
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                task.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                task.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                                task.status === 'running' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400'
                              }`}>
                                {task.status}
                              </span>
                              <svg 
                                className={`w-4 h-4 text-slate-500 dark:text-slate-400 transition-transform ${currentTask?.id === task.id ? 'rotate-180' : ''}`} 
                                fill="none" 
                                viewBox="0 0 24 24" 
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>
                          
                          {/* Expanded Details */}
                          {currentTask?.id === task.id && (
                            <div className="border-t border-slate-200 dark:border-slate-700 p-4 space-y-4">
                              {/* Full Prompt */}
                              <div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Prompt</div>
                                <pre className="bg-slate-100 dark:bg-slate-800/50 p-3 rounded text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap overflow-x-auto">
                                  {task.prompt}
                                </pre>
                              </div>
                              
                              {/* Result */}
                              {task.result && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-slate-500 dark:text-slate-400">Result</span>
                                    <button
                                      onClick={() => navigator.clipboard.writeText(task.result || '')}
                                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white"
                                    >
                                      Copy
                                    </button>
                                  </div>
                                  <pre className="bg-green-50 dark:bg-slate-800/50 border border-green-200 dark:border-transparent p-3 rounded text-xs text-green-700 dark:text-green-300 whitespace-pre-wrap overflow-x-auto">
                                    {task.result}
                                  </pre>
                                </div>
                              )}
                              
                              {/* Error */}
                              {task.error && (
                                <div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Error</div>
                                  <pre className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-transparent p-3 rounded text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap overflow-x-auto">
                                    {task.error}
                                  </pre>
                                </div>
                              )}
                              
                              {/* Metadata */}
                              <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                                <span>ID: {task.id.slice(0, 8)}...</span>
                                <span>{new Date(task.created_at).toLocaleString()}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Code Agent UI - Full Chat/Terminal/Configure
  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="font-medium">{session.repo_name}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {session.branch} · <span className="text-slate-500 dark:text-slate-400">{getProviderLabel()}</span>
              {session.status === 'active' && (
                <span className="ml-2 inline-flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`} />
                  <span className={isConnected ? 'text-green-700 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-400'}>
                    {isConnected ? 'connected' : 'connecting...'}
                  </span>
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            {session.status === 'active' && (
              <>
                <button
                  onClick={() => setShowTerminal(!showTerminal)}
                  className={`border px-4 py-1.5 rounded text-sm ${
                    showTerminal 
                      ? 'border-blue-500/50 text-blue-400 bg-blue-500/10' 
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-gray-500 hover:text-slate-900 dark:text-white'
                  }`}
                >
                  Terminal
                </button>
                <button
                  onClick={handlePush}
                  className="border border-green-300 dark:border-green-500/50 text-green-600 dark:text-green-400 px-4 py-1.5 rounded text-sm hover:bg-green-50 dark:hover:bg-green-500/10"
                >
                  Push
                </button>
                <button
                  onClick={handleCloseSandbox}
                  className="border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-4 py-1.5 rounded text-sm hover:border-gray-500 hover:text-slate-900 dark:text-white"
                >
                  Close
                </button>
              </>
            )}
            {(session.status === 'pending' || session.status === 'completed') && (
              <button
                onClick={handleStartSandbox}
                disabled={isStartingSandbox}
                className="bg-slate-800 dark:bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
              >
                {isStartingSandbox ? 'Starting...' : 'Start'}
              </button>
            )}
            <button
              onClick={() => navigate('/agents')}
              className="border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 px-4 py-1.5 rounded text-sm hover:border-gray-600 hover:text-slate-900 dark:text-white"
            >
              Back
            </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="max-w-4xl mx-auto flex gap-6 mt-4">
          <button
            onClick={() => setActiveTab('chat')}
            className={`pb-2 text-sm border-b-2 transition-colors ${
              activeTab === 'chat'
                ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`pb-2 text-sm border-b-2 transition-colors ${
              activeTab === 'config'
                ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            }`}
          >
            Configure
          </button>
          <button
            onClick={() => setActiveTab('mcp')}
            className={`pb-2 text-sm border-b-2 transition-colors ${
              activeTab === 'mcp'
                ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            }`}
          >
            MCP
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`pb-2 text-sm border-b-2 transition-colors ${
              activeTab === 'schedule'
                ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            }`}
          >
            Schedule
          </button>
          {/* Portal tab hidden for now */}
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`pb-2 text-sm border-b-2 transition-colors ${
              activeTab === 'knowledge'
                ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            }`}
          >
            Knowledge
          </button>
          <button
            onClick={() => setActiveTab('executions')}
            className={`pb-2 text-sm border-b-2 transition-colors ${
              activeTab === 'executions'
                ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
            }`}
          >
            Executions
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/50 text-red-700 dark:text-red-400 px-6 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Configure Tab */}
      {activeTab === 'config' && (
        <div className="flex-1 flex flex-col">
          {/* Tab heading */}
          <div className="border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-900">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-lg font-medium text-slate-900 dark:text-white">
                {showWizard ? 'Setup Wizard' : 'Configure'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {showWizard
                  ? 'Complete the setup wizard to configure your portal agent'
                  : 'Manage your agent\'s settings, files, secrets, and API access'}
              </p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl mx-auto">
              {showWizard ? (
                isPortalSandboxAgent ? (
                  <PortalSandboxAgentWizard
                    sessionId={sessionId!}
                    config={config}
                    onComplete={() => {
                      setActiveTab('portal');
                      agentConfig.get(sessionId!).then(({ config: c }) => setConfig(c));
                    }}
                    onConfigUpdate={(updated) => setConfig(updated)}
                  />
                ) : (
                  <PortalAgentWizard
                    sessionId={sessionId!}
                    config={config}
                    onComplete={() => {
                      setActiveTab('portal');
                      agentConfig.get(sessionId!).then(({ config: c }) => setConfig(c));
                    }}
                    onConfigUpdate={(updated) => setConfig(updated)}
                  />
                )
              ) : (
                  <AgentConfig sessionId={sessionId!} model={session?.agent_model} agentType={session?.agent_type} />
              )}
            </div>
          </div>
          </div>
        )}

        {/* MCP Tab */}
      {activeTab === 'mcp' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-8">
            <div>
              <h2 className="text-lg font-medium text-slate-900 dark:text-white">MCP Skills</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Extend your agent with MCP (Model Context Protocol) skills. Enable builtin integrations or add custom MCP servers.
              </p>
            </div>

            {isLoadingSkills ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading skills...</div>
            ) : (
              <>
                {/* Builtin Skills */}
                <div>
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <span>⚡</span> Builtin Skills
                    {isSavingSkills && <span className="text-xs text-slate-500 dark:text-slate-400">(saving...)</span>}
                  </h3>
                  
                  {['development', 'data', 'productivity', 'communication', 'ai'].map((category) => {
                    const categorySkills = builtinSkills.filter(s => s.category === category);
                    if (categorySkills.length === 0) return null;
                    
                    return (
                      <div key={category} className="mb-4">
                        <h4 className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">{category}</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {categorySkills.map((skill) => {
                            const isEnabled = enabledSkills.includes(skill.id);
                            
                            return (
                              <div
                                key={skill.id}
                                className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                                  isEnabled
                                    ? 'border-green-500/50 bg-green-500/10'
                                    : 'border-slate-200 dark:border-slate-700 hover:border-gray-600'
                                }`}
                                onClick={() => handleToggleSkill(skill.id)}
                              >
                                <span className="text-xl">{getSkillIcon(skill.icon)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{skill.name}</span>
                                    {isEnabled && <span className="text-xs text-green-700 dark:text-green-400">✓ Enabled</span>}
                                  </div>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{skill.description}</p>
                                  {skill.requiredSecrets && skill.requiredSecrets.length > 0 && (
                                    <p className="text-xs mt-1">
                                      {skill.missingSecrets && skill.missingSecrets.length > 0 ? (
                                        <span className="text-yellow-400">
                                          ⚠️ Requires: {skill.missingSecrets.join(', ')}
                                        </span>
                                      ) : (
                                        <span className="text-green-700 dark:text-green-400">✓ Secrets configured</span>
                                      )}
                                    </p>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Custom MCP Servers */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <span>🔌</span> Custom MCP Servers
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    Connect to your own MCP servers for custom integrations.
                  </p>

                  {/* Existing custom servers */}
                  {customMcpServers.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {customMcpServers.map((server) => {
                        const testResult = mcpTestResults[server.id];
                        return (
                          <div
                            key={server.id}
                            className="flex items-center justify-between p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{server.name}</span>
                                <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
                                  {server.transport || 'SSE'}
                                </span>
                                {server.status === 'connected' && (
                                  <span className="text-xs text-green-700 dark:text-green-400">● Connected</span>
                                )}
                                {server.status === 'error' && (
                                  <span className="text-xs text-red-700 dark:text-red-400">⚠️ Error</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono truncate">
                                {server.url}
                              </p>
                              {testResult?.success && testResult.tools && (
                                <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                                  ✓ {testResult.tools.length} tools available
                                </p>
                              )}
                              {testResult && !testResult.success && (
                                <p className="text-xs text-red-700 dark:text-red-400 mt-1">{testResult.error}</p>
                              )}
                              {server.error && !testResult && (
                                <p className="text-xs text-red-700 dark:text-red-400 mt-1">{server.error}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleTestMcpServer(server.id)}
                                disabled={testingMcpServer === server.id}
                                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white disabled:opacity-50"
                              >
                                {testingMcpServer === server.id ? 'Testing...' : 'Test'}
                              </button>
                              <button
                                onClick={() => handleRemoveMcpServer(server.id)}
                                className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add new MCP server */}
                  <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                    <h4 className="text-sm font-medium">Add MCP Server</h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name</label>
                        <input
                          type="text"
                          value={newMcpName}
                          onChange={(e) => setNewMcpName(e.target.value)}
                          placeholder="My Custom Server"
                          autoComplete="off"
                          data-lpignore="true"
                          data-1p-ignore
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white placeholder-gray-500 focus:border-white/30 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Transport</label>
                        <select
                          value={newMcpTransport}
                          onChange={(e) => setNewMcpTransport(e.target.value as 'sse' | 'streamable-http')}
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white focus:border-white/30 focus:outline-none"
                        >
                          <option value="streamable-http">Streamable HTTP (recommended)</option>
                          <option value="sse">SSE (legacy)</option>
                        </select>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Server URL</label>
                      <input
                        type="text"
                        value={newMcpUrl}
                        onChange={(e) => setNewMcpUrl(e.target.value)}
                        placeholder="https://server.smithery.ai/@org/server"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none"
                      />
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">MCP server endpoint URL from Smithery, mcp.run, or your own server</p>
                    </div>

                    {/* Authentication */}
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Authentication <span className="text-slate-500 dark:text-slate-400/50">(optional)</span></label>
                      <div className="flex gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => setNewMcpAuthType('none')}
                          className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                            newMcpAuthType === 'none' 
                              ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white' 
                              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                          }`}
                        >
                          None
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewMcpAuthType('bearer')}
                          className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                            newMcpAuthType === 'bearer' 
                              ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white' 
                              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                          }`}
                        >
                          Bearer Token
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewMcpAuthType('custom')}
                          className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                            newMcpAuthType === 'custom' 
                              ? 'bg-slate-200 dark:bg-white/10 border-slate-400 dark:border-white/30 text-slate-900 dark:text-white' 
                              : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:bg-slate-100 dark:hover:bg-transparent'
                          }`}
                        >
                          Custom Header
                        </button>
                      </div>
                      
                      {newMcpAuthType === 'bearer' && (
                        <div>
                          <input
                            type="text"
                            value={newMcpAuthValue}
                            onChange={(e) => setNewMcpAuthValue(e.target.value)}
                            placeholder="sk-xxx..."
                            autoComplete="off"
                            data-lpignore="true"
                            data-1p-ignore
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none [-webkit-text-security:disc]"
                          />
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Will be sent as: Authorization: Bearer &lt;token&gt;</p>
                        </div>
                      )}
                      
                      {newMcpAuthType === 'custom' && (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={newMcpCustomHeaderName}
                            onChange={(e) => setNewMcpCustomHeaderName(e.target.value)}
                            placeholder="Header name (e.g., X-Subscription-Token)"
                            autoComplete="off"
                            data-lpignore="true"
                            data-1p-ignore
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={newMcpAuthValue}
                            onChange={(e) => setNewMcpAuthValue(e.target.value)}
                            placeholder="Header value"
                            autoComplete="off"
                            data-lpignore="true"
                            data-1p-ignore
                            className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-sm text-slate-900 dark:text-white font-mono placeholder-gray-500 focus:border-white/30 focus:outline-none [-webkit-text-security:disc]"
                          />
                          <p className="text-xs text-slate-500 dark:text-slate-400">Will be sent as: {newMcpCustomHeaderName || 'Header-Name'}: &lt;value&gt;</p>
                        </div>
                      )}
                      
                      {newMcpAuthType === 'none' && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">No authentication required for this server</p>
                      )}
                    </div>

                    <button
                      onClick={handleAddMcpServer}
                      disabled={!newMcpName.trim() || !newMcpUrl.trim()}
                      className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
                    >
                      Add Server
                    </button>
                  </div>
                </div>

                {/* Info */}
                <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                  <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded text-sm">
                    <strong>💡 How it works</strong>
                    <ul className="mt-2 ml-4 list-disc text-slate-500 dark:text-slate-400 space-y-1">
                      <li>Enable skills to give your agent new capabilities</li>
                      <li>Skills requiring secrets need the values configured in the Configure tab</li>
                      <li>Custom MCP servers let you connect proprietary tools</li>
                      <li>All MCP tools appear automatically in agent conversations</li>
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Schedule Tab */}
      {activeTab === 'schedule' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-medium text-slate-900 dark:text-white">Scheduled Runs</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configure automated runs for this agent</p>
              </div>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
              >
                + New Schedule
              </button>
            </div>

            {isLoadingSchedules ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading schedules...</div>
            ) : agentSchedules.length === 0 ? (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center">
                <div className="text-4xl mb-4">⏰</div>
                <h3 className="text-slate-900 dark:text-white font-medium mb-2">No schedules yet</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">Create a schedule to run this agent automatically on a recurring basis</p>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
                >
                  Create Schedule
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {agentSchedules.map(schedule => (
                  <div 
                    key={schedule.id}
                    className={`bg-white dark:bg-slate-800 border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedSchedule?.id === schedule.id ? 'border-blue-500' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                    onClick={() => loadScheduleDetails(schedule.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${schedule.is_active ? 'bg-green-500' : 'bg-gray-500'}`} />
                        <div>
                          <h3 className="text-slate-900 dark:text-white font-medium">{schedule.name}</h3>
                          <p className="text-sm text-slate-500 dark:text-slate-400">{schedule.description_human || schedule.cron_expression}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleSchedule(schedule.id); }}
                          className={`px-3 py-1 rounded text-xs font-medium ${
                            schedule.is_active 
                              ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-500/30' 
                              : 'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-gray-500/30'
                          }`}
                        >
                          {schedule.is_active ? 'Active' : 'Paused'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRunScheduleNow(schedule.id); }}
                          className="px-3 py-1 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-500/30"
                        >
                          Run Now
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(schedule.id); }}
                          className="px-3 py-1 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Last Run:</span>
                        <span className="text-slate-900 dark:text-white ml-2">
                          {schedule.last_run_at ? new Date(schedule.last_run_at).toLocaleString() : 'Never'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Next Run:</span>
                        <span className="text-slate-900 dark:text-white ml-2">
                          {schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString() : 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Total Runs:</span>
                        <span className="text-slate-900 dark:text-white ml-2">{schedule.run_count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Schedule Details */}
            {selectedSchedule && (
              <div className="mt-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                <h3 className="text-slate-900 dark:text-white font-medium mb-4">Schedule Details: {selectedSchedule.name}</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Cron Expression:</span>
                    <code className="ml-2 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-900 dark:text-white">{selectedSchedule.cron_expression}</code>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Timezone:</span>
                    <span className="ml-2 text-slate-900 dark:text-white">{selectedSchedule.timezone}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Prompt:</span>
                    <pre className="mt-1 bg-slate-100 dark:bg-slate-800 p-3 rounded text-slate-900 dark:text-white text-xs whitespace-pre-wrap">{selectedSchedule.prompt}</pre>
                  </div>
                </div>

                {/* Recent Runs */}
                {scheduleRuns.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-slate-900 dark:text-white font-medium mb-2">Recent Runs</h4>
                    <div className="space-y-2">
                      {scheduleRuns.slice(0, 10).map(run => (
                        <div key={run.id} className="flex items-center justify-between text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded">
                          <span className="text-slate-500 dark:text-slate-400">{new Date(run.created_at).toLocaleString()}</span>
                          <span className={`px-2 py-0.5 rounded ${
                            run.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                            run.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                            run.status === 'running' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-gray-500/20 text-slate-500 dark:text-slate-400'
                          }`}>
                            {run.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Create Schedule Modal */}
            {showScheduleModal && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-6 w-full max-w-lg shadow-xl">
                  <h2 className="text-lg font-medium text-slate-900 dark:text-white mb-4">Create Schedule</h2>
                  <form onSubmit={handleCreateSchedule} className="space-y-4">
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Name</label>
                      <input
                        type="text"
                        value={scheduleForm.name}
                        onChange={(e) => setScheduleForm(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                        placeholder="Daily issue check"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Description (optional)</label>
                      <input
                        type="text"
                        value={scheduleForm.description}
                        onChange={(e) => setScheduleForm(prev => ({ ...prev, description: e.target.value }))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                        placeholder="Check for new issues every morning"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Schedule</label>
                      <select
                        value={scheduleForm.cron_expression}
                        onChange={(e) => setScheduleForm(prev => ({ ...prev, cron_expression: e.target.value }))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                      >
                        <option value="* * * * *">Every minute</option>
                        <option value="*/5 * * * *">Every 5 minutes</option>
                        <option value="*/15 * * * *">Every 15 minutes</option>
                        <option value="*/30 * * * *">Every 30 minutes</option>
                        <option value="0 * * * *">Every hour</option>
                        <option value="0 */2 * * *">Every 2 hours</option>
                        <option value="0 */4 * * *">Every 4 hours</option>
                        <option value="0 */6 * * *">Every 6 hours</option>
                        <option value="0 */12 * * *">Every 12 hours</option>
                        <option value="0 9 * * *">Daily at 9:00 AM</option>
                        <option value="0 0 * * *">Daily at midnight</option>
                        <option value="0 9 * * 1">Weekly on Monday at 9:00 AM</option>
                        <option value="0 9 1 * *">Monthly on 1st at 9:00 AM</option>
                      </select>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Cron: <code className="bg-slate-100 dark:bg-slate-800 px-1">{scheduleForm.cron_expression}</code>
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Timezone</label>
                      <select
                        value={scheduleForm.timezone}
                        onChange={(e) => setScheduleForm(prev => ({ ...prev, timezone: e.target.value }))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm"
                      >
                        <option value="UTC">UTC</option>
                        <option value="America/New_York">Eastern (ET)</option>
                        <option value="America/Chicago">Central (CT)</option>
                        <option value="America/Denver">Mountain (MT)</option>
                        <option value="America/Los_Angeles">Pacific (PT)</option>
                        <option value="Europe/London">London (GMT)</option>
                        <option value="Europe/Paris">Paris (CET)</option>
                        <option value="Asia/Tokyo">Tokyo (JST)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                      <textarea
                        value={scheduleForm.prompt}
                        onChange={(e) => setScheduleForm(prev => ({ ...prev, prompt: e.target.value }))}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-white text-sm h-32"
                        placeholder="Check for new issues labeled 'bug' and summarize them"
                        required
                      />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowScheduleModal(false)}
                        className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-slate-800 dark:bg-indigo-600 text-white rounded hover:bg-slate-900 dark:hover:bg-indigo-700 text-sm font-medium"
                      >
                        Create Schedule
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {/* Knowledge Tab */}
      {activeTab === 'knowledge' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-8">
            <div>
              <h2 className="text-xl font-semibold mb-2">Knowledge Bases</h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Attach knowledge bases to enable RAG (Retrieval-Augmented Generation). 
                The agent will automatically search relevant documents when responding.
              </p>
            </div>

            {isLoadingKnowledge ? (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">Loading knowledge bases...</div>
            ) : (
              <>
                {/* Attached Knowledge Bases */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                  <h3 className="font-medium mb-4">Attached Knowledge Bases</h3>
                  {attachedKnowledgeBases.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400 text-sm">No knowledge bases attached to this agent.</p>
                  ) : (
                    <div className="space-y-3">
                      {attachedKnowledgeBases.map(kb => (
                        <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{kb.name}</span>
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                kb.status === 'ready' ? 'bg-green-500/20 text-green-400' :
                                kb.status === 'indexing' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-gray-500/20 text-slate-500 dark:text-slate-400'
                              }`}>
                                {kb.status}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              {kb.indexed_files} files • {kb.indexed_chunks} chunks
                            </div>
                          </div>
                          <button
                            onClick={() => handleDetachKnowledgeBase(kb.id)}
                            className="px-3 py-1.5 bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-medium hover:bg-red-200 dark:hover:bg-red-500/30"
                          >
                            Detach
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Available Knowledge Bases */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                  <h3 className="font-medium mb-4">Available Knowledge Bases</h3>
                  {allKnowledgeBases.filter(kb => !attachedKnowledgeBases.some(akb => akb.id === kb.id)).length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">No additional knowledge bases available.</p>
                      <a
                        href="/knowledge"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                      >
                        Create a knowledge base →
                      </a>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {allKnowledgeBases
                        .filter(kb => !attachedKnowledgeBases.some(akb => akb.id === kb.id))
                        .map(kb => (
                          <div key={kb.id} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/30 rounded-lg">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{kb.name}</span>
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                  kb.status === 'ready' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                                  kb.status === 'indexing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400' :
                                  'bg-gray-100 dark:bg-gray-500/20 text-slate-500 dark:text-slate-400'
                                }`}>
                                  {kb.status}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                {kb.indexed_files} files • {kb.indexed_chunks} chunks
                              </div>
                            </div>
                            <button
                              onClick={() => handleAttachKnowledgeBase(kb.id)}
                              disabled={kb.status !== 'ready'}
                              className="px-3 py-1.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Attach
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* How RAG Works */}
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                  <h3 className="font-medium mb-2">How RAG Works</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm">
                    When this agent receives a message, it will:
                  </p>
                  <ol className="text-sm text-slate-500 dark:text-slate-400 mt-2 space-y-1 list-decimal list-inside">
                    <li>Search attached knowledge bases for relevant content</li>
                    <li>Inject the most relevant chunks into the context</li>
                    <li>Generate a response informed by your documents</li>
                  </ol>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Executions Tab */}
      {activeTab === 'executions' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-8">
            {/* Tab heading */}
            <div>
              <h2 className="text-lg font-medium text-slate-900 dark:text-white">Executions</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                View all production runs from SDK, API, and Portal sessions
              </p>
            </div>

            {/* Sub-tabs for API, SDK, and Portal */}
            <div className="flex gap-4 border-b border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setExecutionsSubTab('api')}
                className={`pb-2 text-sm border-b-2 transition-colors ${
                  executionsSubTab === 'api'
                    ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                }`}
              >
                API Runs
              </button>
              <button
                onClick={() => setExecutionsSubTab('sdk')}
                className={`pb-2 text-sm border-b-2 transition-colors ${
                  executionsSubTab === 'sdk'
                    ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                }`}
              >
                SDK Runs
              </button>
              {/* <button
                onClick={() => setExecutionsSubTab('portal')}
                className={`pb-2 text-sm border-b-2 transition-colors ${
                  executionsSubTab === 'portal'
                    ? 'border-slate-800 dark:border-white text-slate-900 dark:text-white'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white'
                }`}
              >
                Portal Sessions
              </button> */}
            </div>

            {/* API Runs */}
            {executionsSubTab === 'api' && (
              <div>
                {selectedRun ? (
                  /* Run Detail View */
                  <div className="space-y-4">
                    <button
                      onClick={() => setSelectedRun(null)}
                      className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
                    >
                      ← Back to list
                    </button>

                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono text-sm text-slate-900 dark:text-white">{selectedRun.id}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {new Date(selectedRun.created_at).toLocaleString()}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          selectedRun.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                          selectedRun.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                          selectedRun.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                          'bg-slate-200 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400'
                        }`}>
                          {selectedRun.status}
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                        <div className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap text-slate-900 dark:text-white">
                          {selectedRun.prompt}
                        </div>
                      </div>

                      {selectedRun.result && (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Result</label>
                          <div className="text-sm bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-green-700 dark:text-green-300">
                            {selectedRun.result}
                          </div>
                        </div>
                      )}

                      {selectedRun.structured_output && (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Structured Output</label>
                          <pre className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-slate-900 dark:text-white">
                            {JSON.stringify(selectedRun.structured_output, null, 2)}
                          </pre>
                        </div>
                      )}

                      {selectedRun.error && (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Error</label>
                          <div className="text-sm bg-red-500/10 border border-red-500/30 p-3 rounded font-mono whitespace-pre-wrap text-red-700 dark:text-red-300">
                            {selectedRun.error}
                          </div>
                        </div>
                      )}

                      <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div>Source: <span className="text-slate-900 dark:text-white">{selectedRun.source}</span></div>
                        {selectedRun.started_at && (
                          <div>Started: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.started_at).toLocaleString()}</span></div>
                        )}
                        {selectedRun.completed_at && (
                          <div>Completed: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.completed_at).toLocaleString()}</span></div>
                        )}
                        {selectedRun.completed_at && selectedRun.started_at && (
                          <div>Duration: <span className="text-slate-900 dark:text-white">{Math.round((new Date(selectedRun.completed_at).getTime() - new Date(selectedRun.started_at).getTime()) / 1000)}s</span></div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Run List View */
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-medium">API Runs</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          Direct API calls without SDK sessions
                        </p>
                      </div>
                      <button 
                        onClick={loadRuns}
                        className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                      >
                        ↻ Refresh
                      </button>
                    </div>

                    {isLoadingRuns ? (
                      <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading runs...</div>
                    ) : apiRuns.length === 0 ? (
                      <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                        <div className="text-4xl mb-4">📋</div>
                        <div className="text-lg font-medium mb-2">No API runs yet</div>
                        <div className="text-sm text-slate-500 dark:text-slate-400">
                          API runs will appear here when you make direct API calls
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {apiRuns.map((run) => (
                          <button
                            key={run.id}
                            onClick={() => setSelectedRun(run)}
                            className="w-full text-left p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className={`px-2 py-0.5 text-xs rounded ${
                                    run.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' :
                                    run.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' :
                                    run.status === 'processing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                                    'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300'
                                  }`}>
                                    {run.status}
                                  </span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {new Date(run.created_at).toLocaleString()}
                                  </span>
                                </div>
                                <div className="text-sm text-slate-900 dark:text-white truncate mb-2">
                                  {run.prompt}
                                </div>
                                {run.result && (
                                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    Result: {run.result.substring(0, 100)}...
                                  </div>
                                )}
                                {run.error && (
                                  <div className="text-xs text-red-600 dark:text-red-400 truncate">
                                    Error: {run.error}
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {run.completed_at && run.started_at && (
                                  <span>
                                    {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* SDK Runs */}
            {executionsSubTab === 'sdk' && (
              <div>
                {selectedRun ? (
                  /* Run Detail View */
                  <div className="space-y-4">
                    <button
                      onClick={() => setSelectedRun(null)}
                      className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1"
                    >
                      ← Back to list
                    </button>

                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-mono text-sm text-slate-900 dark:text-white">{selectedRun.id}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {new Date(selectedRun.created_at).toLocaleString()}
                          </div>
                          {selectedRun.sdk_session_id && (
                            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              Session: {selectedRun.sdk_session_id}
                            </div>
                          )}
                        </div>
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          selectedRun.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400' :
                          selectedRun.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-400' :
                          selectedRun.status === 'processing' ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                          'bg-slate-200 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400'
                        }`}>
                          {selectedRun.status}
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Prompt</label>
                        <div className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap text-slate-900 dark:text-white">
                          {selectedRun.prompt}
                        </div>
                      </div>

                      {selectedRun.result && (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Result</label>
                          <div className="text-sm bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-green-700 dark:text-green-300">
                            {selectedRun.result}
                          </div>
                        </div>
                      )}

                      {selectedRun.structured_output && (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Structured Output</label>
                          <pre className="text-sm bg-slate-50 dark:bg-slate-800 p-3 rounded font-mono whitespace-pre-wrap max-h-60 overflow-y-auto text-slate-900 dark:text-white">
                            {JSON.stringify(selectedRun.structured_output, null, 2)}
                          </pre>
                        </div>
                      )}

                      {selectedRun.error && (
                        <div>
                          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Error</label>
                          <div className="text-sm bg-red-500/10 border border-red-500/30 p-3 rounded font-mono whitespace-pre-wrap text-red-700 dark:text-red-300">
                            {selectedRun.error}
                          </div>
                        </div>
                      )}

                      <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div>Source: <span className="text-slate-900 dark:text-white">{selectedRun.source}</span></div>
                        {selectedRun.started_at && (
                          <div>Started: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.started_at).toLocaleString()}</span></div>
                        )}
                        {selectedRun.completed_at && (
                          <div>Completed: <span className="text-slate-900 dark:text-white">{new Date(selectedRun.completed_at).toLocaleString()}</span></div>
                        )}
                        {selectedRun.completed_at && selectedRun.started_at && (
                          <div>Duration: <span className="text-slate-900 dark:text-white">{Math.round((new Date(selectedRun.completed_at).getTime() - new Date(selectedRun.started_at).getTime()) / 1000)}s</span></div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Run List View */
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-medium">SDK Runs</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                          SDK session-based executions
                        </p>
                      </div>
                  <button 
                    onClick={loadRuns}
                    className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                  >
                    ↻ Refresh
                  </button>
                </div>

                {isLoadingRuns ? (
                  <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading runs...</div>
                ) : sdkRuns.length === 0 ? (
                  <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                    <div className="text-4xl mb-4">🔗</div>
                    <div className="text-lg font-medium mb-2">No SDK runs yet</div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      SDK runs will appear here when you use the SDK with sessions
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sdkRuns.map((run) => (
                      <button
                        key={run.id}
                        onClick={() => setSelectedRun(run)}
                        className="w-full text-left p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`px-2 py-0.5 text-xs rounded ${
                                run.status === 'completed' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' :
                                run.status === 'failed' ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300' :
                                run.status === 'processing' ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' :
                                'bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300'
                              }`}>
                                {run.status}
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                Session: {run.sdk_session_id?.substring(0, 8)}...
                              </span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {new Date(run.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm text-slate-900 dark:text-white truncate mb-2">
                              {run.prompt}
                            </div>
                            {run.result && (
                              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                Result: {run.result.substring(0, 100)}...
                              </div>
                            )}
                            {run.error && (
                              <div className="text-xs text-red-600 dark:text-red-400 truncate">
                                Error: {run.error}
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {run.completed_at && run.started_at && (
                              <span>
                                {Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                  </>
                )}
              </div>
            )}

            {/* Portal Sessions */}
            {executionsSubTab === 'portal' && (
              <>
                {/* View: User selected - show Portal-like interface */}
                {selectedPortalUser ? (
                  <div className="flex flex-col h-[600px]">
                    {/* Header with back button and user info */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white/5 rounded-t-lg">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => {
                            setSelectedPortalUser(null);
                            setSelectedPortalThread(null);
                            setPortalUserThreads([]);
                            setPortalThreadMessages([]);
                          }}
                          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                        >
                          ← Back to Users
                        </button>
                        <div>
                          <div className="font-medium">{selectedPortalUser.displayName}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded ${
                              selectedPortalUser.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                            }`}>
                              {selectedPortalUser.type}
                            </span>
                            <span>{selectedPortalUser.identifier}</span>
                            <span>•</span>
                            <span>Active {new Date(selectedPortalUser.updatedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      {Object.keys(selectedPortalUser.userContext).length > 0 && (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white">View Context</summary>
                          <pre className="absolute right-4 mt-2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs max-w-md overflow-auto z-10">
                            {JSON.stringify(selectedPortalUser.userContext, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>

                    {/* Portal-like layout: Threads sidebar + Chat area */}
                    <div className="flex flex-1 overflow-hidden border-x border-b border-slate-200 dark:border-slate-700 rounded-b-lg">
                      {/* Threads Sidebar */}
                      <div className="w-64 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-800/20">
                        <div className="p-3 border-b border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-500 dark:text-slate-400">
                          Conversations ({portalUserThreads.length})
                        </div>
                        <div className="flex-1 overflow-y-auto">
                          {isLoadingPortalThreads ? (
                            <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Loading...</div>
                          ) : portalUserThreads.length === 0 ? (
                            <div className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">No conversations</div>
                          ) : (
                            portalUserThreads.map((thread) => (
                              <button
                                key={thread.id}
                                onClick={() => loadPortalThreadMessages(thread)}
                                className={`w-full p-3 text-left border-b border-slate-200 dark:border-slate-700/50 hover:bg-white/5 transition-colors ${
                                  selectedPortalThread?.id === thread.id ? 'bg-white/10 border-l-2 border-l-indigo-500' : ''
                                }`}
                              >
                                <div className="font-medium text-sm truncate">
                                  {thread.title || 'Untitled'}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                  {thread.messageCount} messages
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Chat Area */}
                      <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-900">
                        {!selectedPortalThread ? (
                          <div className="flex-1 flex items-center justify-center text-slate-500 dark:text-slate-400">
                            Select a conversation to view messages
                          </div>
                        ) : (
                          <>
                            {/* Thread Header */}
                            <div className="p-4 border-b border-slate-200 dark:border-slate-700/50">
                              <div className="font-medium">{selectedPortalThread.title || 'Conversation'}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">
                                {selectedPortalThread.messageCount} messages • Started {new Date(selectedPortalThread.createdAt).toLocaleDateString()}
                              </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                              {isLoadingPortalMessages ? (
                                <div className="text-center text-slate-500 dark:text-slate-400">Loading messages...</div>
                              ) : portalThreadMessages.length === 0 ? (
                                <div className="text-center text-slate-500 dark:text-slate-400">No messages in this conversation</div>
                              ) : (
                                portalThreadMessages.map((msg) => (
                                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div
                                      className={`max-w-[80%] p-4 rounded-2xl ${
                                        msg.role === 'user'
                                          ? 'bg-indigo-600 dark:bg-indigo-600 text-white rounded-br-md shadow-sm'
                                          : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-md shadow-sm'
                                      }`}
                                    >
                                      <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                                      <div className={`text-xs mt-2 ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* View: No user selected - show user list */
                  <>
                    {/* Stats Overview */}
                    {portalStats && (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                        <div className="p-4 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-lg text-center">
                          <div className="text-3xl font-bold">{portalStats.totalUsers}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">Total Users</div>
                        </div>
                        <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                          <div className="text-2xl font-bold text-indigo-400">{portalStats.portalUsers}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">Portal</div>
                        </div>
                        <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                          <div className="text-2xl font-bold text-green-700 dark:text-green-400">{portalStats.embedUsers}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">Embed</div>
                        </div>
                        <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                          <div className="text-2xl font-bold">{portalStats.totalThreads}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">Threads</div>
                        </div>
                        <div className="p-4 bg-white/5 border border-slate-200 dark:border-slate-700 rounded-lg text-center">
                          <div className="text-2xl font-bold">{portalStats.totalMessages}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">Messages</div>
                        </div>
                      </div>
                    )}

                    {/* Users List */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-medium">Portal Users</h3>
                        <button 
                          onClick={loadPortalUsers}
                          className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded hover:bg-white/10 transition-colors"
                        >
                          ↻ Refresh
                        </button>
                      </div>

                      {isLoadingPortalUsers ? (
                        <div className="p-8 text-center text-slate-500 dark:text-slate-400">Loading users...</div>
                      ) : portalUsers.length === 0 ? (
                        <div className="p-8 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white/5">
                          <div className="text-4xl mb-4">👤</div>
                          <div className="text-lg font-medium mb-2">No users yet</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400">
                            Users will appear here when they interact with your Portal or Embed chat.
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-3">
                          {portalUsers.map((user) => (
                            <button
                              key={user.id}
                              onClick={() => loadPortalUserThreads(user)}
                              className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-white/5 hover:border-white/20 transition-all text-left group"
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-medium ${
                                  user.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                }`}>
                                  {user.displayName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-medium group-hover:text-slate-900 dark:text-white transition-colors">
                                    {user.displayName}
                                  </div>
                                  <div className="text-sm text-slate-500 dark:text-slate-400">
                                    {user.identifier}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className={`text-xs px-2 py-1 rounded ${
                                  user.type === 'portal' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300' : 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300'
                                }`}>
                                  {user.type}
                                </span>
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                  {new Date(user.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Chat Tab - Messages */}
      {activeTab === 'chat' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-4">
            {(session.status === 'pending' || session.status === 'completed') && allMessages.length === 0 && (
              <div className="text-center py-16">
                <p className="text-slate-500 dark:text-slate-400 mb-6">
                  Start the agent to begin making changes.
                </p>
                <button
                  onClick={handleStartSandbox}
                  disabled={isStartingSandbox}
                  className="bg-slate-800 dark:bg-indigo-600 text-white px-6 py-2.5 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
                >
                  {isStartingSandbox ? 'Starting...' : 'Start Agent'}
                </button>
              </div>
            )}

            {session.status === 'active' && allMessages.length === 0 && (
              <div className="text-center py-16">
                <p className="text-slate-500 dark:text-slate-400">
                  Agent is ready. Describe the changes you want to make.
                </p>
              </div>
            )}

            {allMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded p-4 ${
                  message.role === 'user'
                    ? 'bg-white/5 border border-slate-200 dark:border-slate-700 ml-12'
                    : message.role === 'assistant'
                    ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 mr-12'
                    : 'bg-white dark:bg-slate-800/50 text-sm text-slate-500 dark:text-slate-400'
                }`}
              >
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'System'}
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed font-mono">{message.content}</div>
              </div>
            ))}

            {(isRunningTask || currentTask?.status === 'running') && (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-4 mr-12">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                  Agent
                  {isRunningTask && (
                    <span className="text-xs text-yellow-600 dark:text-yellow-400/70">
                      • {elapsedTime > 0 ? `${elapsedTime}s` : 'starting...'}
                    </span>
                  )}
                </div>
                {streamingOutput.length > 0 ? (
                  <div className="space-y-3">
                    {(() => {
                      const statusLines = streamingOutput.filter(l => l.startsWith('__STATUS__'));
                      const textLines = streamingOutput.filter(l => !l.startsWith('__STATUS__'));
                      const textContent = textLines.join('\n');
                      return (
                        <>
                          {/* Streaming Response Text - shown prominently like Portal */}
                          {textContent && (
                            <div className="prose prose-sm dark:prose-invert max-w-none">
                              <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-200 leading-relaxed">
                                {textContent}
                                <span className="inline-block w-2 h-4 bg-indigo-500 ml-1 animate-pulse" />
                              </div>
                            </div>
                          )}
                          {/* Tool Activity - collapsible panel below */}
                          {statusLines.length > 0 && (
                            <details className="group" open={!textContent}>
                              <summary className="cursor-pointer list-none">
                                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-900/70 transition-colors">
                                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    Tool Activity ({statusLines.length})
                                  </div>
                                  <svg className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </div>
                              </summary>
                              <div className="mt-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700 space-y-1.5 max-h-48 overflow-y-auto">
                                {statusLines.map((line, i) => {
                                  const text = line.replace('__STATUS__', '');
                                  const emoji = text.match(/^[\p{Emoji}]/u)?.[0] || '⚙️';
                                  const content = text.replace(/^[\p{Emoji}\s]+/u, '');
                                  return (
                                    <div key={i} className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                                      <span className="text-sm flex-shrink-0">{emoji}</span>
                                      <span className="truncate">{content}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          )}
                          {/* Show thinking indicator if no text yet */}
                          {!textContent && statusLines.length === 0 && (
                            <div className="flex items-center gap-3">
                              <div className="flex gap-1">
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                              </div>
                              <span className="text-slate-500 dark:text-slate-400 text-sm">Agent is thinking...</span>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-slate-500 dark:text-slate-400 text-sm">Agent is thinking...</span>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Terminal Overlay for Chat */}
      {activeTab === 'chat' && session.status === 'active' && showTerminal && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-6 bg-white dark:bg-slate-800/30">
          <div className="max-w-4xl mx-auto">
            <Terminal sessionId={sessionId!} isVisible={showTerminal} />
          </div>
        </div>
      )}

      {/* Input for Chat */}
      {activeTab === 'chat' && session.status === 'active' && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-6">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleExecutePrompt} className="flex gap-3">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the changes you want to make..."
                disabled={isRunningTask}
                className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:ring-1 focus:ring-white/20 focus:border-white/30 text-sm font-mono disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!prompt.trim() || isRunningTask}
                className="bg-slate-800 dark:bg-indigo-600 text-white px-6 py-2.5 rounded text-sm font-medium hover:bg-slate-900 dark:hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:text-slate-500"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal */}
      <Modal
        isOpen={modal.isOpen}
        onClose={closeModal}
        title={modal.title}
        message={modal.message}
        type={modal.type}
        onConfirm={modal.onConfirm}
      />
    </div>
  );
}
