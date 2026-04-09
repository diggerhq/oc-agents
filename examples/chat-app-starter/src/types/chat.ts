export interface ChatMessage {
  id: string;
  type: 'user' | 'agent' | 'system';
  content: string;
  timestamp: Date;
  agentId?: string;
  agentName?: string;
  status?: 'sending' | 'sent' | 'error';
  taskId?: string;
  structuredOutput?: any;
}

export interface ChatSession {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Agent {
  id: string;
  name: string;
  type: string;
  provider: string;
  apiEnabled: boolean;
  outputSchema?: object;
}

export interface ChatConfig {
  apiKey: string;
  baseUrl: string;
  selectedAgentId?: string;
  autoSave: boolean;
  streamingEnabled: boolean;
}