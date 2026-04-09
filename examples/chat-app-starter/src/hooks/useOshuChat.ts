import { useState, useEffect, useCallback, useRef } from 'react';
import { Oshu } from '@opencomputer/agents-sdk';
import type { ChatMessage, ChatSession, Agent, ChatConfig } from '../types/chat';

export function useOshuChat(config: ChatConfig) {
  const [oshu, setOshu] = useState<Oshu | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const oshuRef = useRef<Oshu | null>(null);

  // Initialize Oshu client
  useEffect(() => {
    if (!config.apiKey) return;

    const client = new Oshu({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'http://localhost:3000'
    });

    setOshu(client);
    oshuRef.current = client;

    return () => {
      if (oshuRef.current) {
        oshuRef.current.disconnect();
      }
    };
  }, [config.apiKey, config.baseUrl]);

  // Connect to Oshu
  const connect = useCallback(async () => {
    if (!oshu || connected || connecting) return;

    setConnecting(true);
    setError(null);

    try {
      await oshu.connect();
      setConnected(true);
      
      // Load agents
      const agentsList = await oshu.agents.list();
      setAgents(agentsList);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }, [oshu, connected, connecting]);

  // Disconnect from Oshu
  const disconnect = useCallback(async () => {
    if (!oshu || !connected) return;

    try {
      await oshu.disconnect();
      setConnected(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  }, [oshu, connected]);

  // Send message to agent
  const sendMessage = useCallback(async (content: string, agentId?: string): Promise<ChatMessage | null> => {
    if (!oshu || !connected) {
      setError('Not connected to Oshu');
      return null;
    }

    setIsLoading(true);
    setError(null);

    const targetAgentId = agentId || config.selectedAgentId;
    if (!targetAgentId) {
      setError('No agent selected');
      return null;
    }

    const agent = agents.find(a => a.id === targetAgentId);
    if (!agent) {
      setError('Agent not found');
      return null;
    }

    // Create user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      type: 'user',
      content,
      timestamp: new Date(),
      status: 'sent'
    };

    // Create agent message (initially sending)
    const agentMessage: ChatMessage = {
      id: `agent-${Date.now()}`,
      type: 'agent',
      content: '',
      timestamp: new Date(),
      agentId: targetAgentId,
      agentName: agent.name,
      status: 'sending'
    };

    // Update current session with user message and initial agent message
    if (currentSession) {
      const updatedSession = {
        ...currentSession,
        messages: [...currentSession.messages, userMessage, agentMessage],
        updatedAt: new Date()
      };
      setCurrentSession(updatedSession);
      
      // Also update sessions list
      setSessions(prev => prev.map(s => 
        s.id === currentSession.id ? updatedSession : s
      ));
    }

    try {
      if (config.streamingEnabled) {
        // Use streaming approach
        const task = await oshu.agents.submit(targetAgentId, {
          prompt: content,
          timeout: 300 // 5 minutes
        });

        agentMessage.taskId = task.id;
        let fullContent = '';

        // Listen for streaming updates
        task.on('stdout', (data: string) => {
          fullContent += data;
          agentMessage.content = fullContent;
          agentMessage.status = 'sending';
          
          // Update the session with streaming content
          setCurrentSession(prev => {
            if (!prev) return prev;
            
            const updatedMessages = prev.messages.map(msg => 
              msg.id === agentMessage.id ? { ...agentMessage } : msg
            );
            
            const updatedSession = {
              ...prev,
              messages: updatedMessages,
              updatedAt: new Date()
            };
            
            // Also update sessions list
            setSessions(sessions => sessions.map(s => 
              s.id === prev.id ? updatedSession : s
            ));
            
            return updatedSession;
          });
        });

        task.on('status', (status: string) => {
          if (status === 'completed' || status === 'failed') {
            agentMessage.status = status === 'completed' ? 'sent' : 'error';
            
            // Update session with final status
            setCurrentSession(prev => {
              if (!prev) return prev;
              
              const updatedMessages = prev.messages.map(msg => 
                msg.id === agentMessage.id ? { ...agentMessage } : msg
              );
              
              const updatedSession = {
                ...prev,
                messages: updatedMessages,
                updatedAt: new Date()
              };
              
              setSessions(sessions => sessions.map(s => 
                s.id === prev.id ? updatedSession : s
              ));
              
              return updatedSession;
            });
          }
        });

        // Wait for completion
        const result = await task.result();
        agentMessage.content = result.result || fullContent;
        agentMessage.structuredOutput = result.output;
        agentMessage.status = 'sent';
        
        // Final update with complete result
        setCurrentSession(prev => {
          if (!prev) return prev;
          
          const updatedMessages = prev.messages.map(msg => 
            msg.id === agentMessage.id ? { ...agentMessage } : msg
          );
          
          const updatedSession = {
            ...prev,
            messages: updatedMessages,
            updatedAt: new Date()
          };
          
          setSessions(sessions => sessions.map(s => 
            s.id === prev.id ? updatedSession : s
          ));
          
          return updatedSession;
        });

      } else {
        // Use simple run approach
        const result = await oshu.agents.run(targetAgentId, {
          prompt: content,
          timeout: 300
        });

        agentMessage.content = result.result || 'No response';
        agentMessage.structuredOutput = result.output;
        agentMessage.status = 'sent';
        
        // Update session with final result
        setCurrentSession(prev => {
          if (!prev) return prev;
          
          const updatedMessages = prev.messages.map(msg => 
            msg.id === agentMessage.id ? { ...agentMessage } : msg
          );
          
          const updatedSession = {
            ...prev,
            messages: updatedMessages,
            updatedAt: new Date()
          };
          
          setSessions(sessions => sessions.map(s => 
            s.id === prev.id ? updatedSession : s
          ));
          
          return updatedSession;
        });
      }

      return agentMessage;

    } catch (err) {
      agentMessage.content = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
      agentMessage.status = 'error';
      setError(err instanceof Error ? err.message : 'Failed to send message');
      
      // Update session with error
      setCurrentSession(prev => {
        if (!prev) return prev;
        
        const updatedMessages = prev.messages.map(msg => 
          msg.id === agentMessage.id ? { ...agentMessage } : msg
        );
        
        const updatedSession = {
          ...prev,
          messages: updatedMessages,
          updatedAt: new Date()
        };
        
        setSessions(sessions => sessions.map(s => 
          s.id === prev.id ? updatedSession : s
        ));
        
        return updatedSession;
      });
      
      return agentMessage;
    } finally {
      setIsLoading(false);
    }
  }, [oshu, connected, config.selectedAgentId, config.streamingEnabled, agents, currentSession]);

  // Create new session
  const createSession = useCallback((agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: `Chat with ${agent.name}`,
      agentId,
      agentName: agent.name,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    setCurrentSession(newSession);
    setSessions(prev => [newSession, ...prev]);
  }, [agents]);

  // Load session
  const loadSession = useCallback((sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setCurrentSession(session);
    }
  }, [sessions]);

  // Auto-connect on mount
  useEffect(() => {
    if (oshu && !connected && !connecting) {
      connect();
    }
  }, [oshu, connected, connecting, connect]);

  return {
    // State
    connected,
    connecting,
    agents,
    currentSession,
    sessions,
    error,
    isLoading,
    
    // Actions
    connect,
    disconnect,
    sendMessage,
    createSession,
    loadSession,
    
    // Utilities
    clearError: () => setError(null)
  };
}