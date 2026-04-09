import { Bot, Check, Settings } from 'lucide-react';
import type { Agent } from '../types/chat';

interface AgentSelectorProps {
  agents: Agent[];
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onCreateSession: (agentId: string) => void;
}

export function AgentSelector({ agents, selectedAgentId, onSelectAgent, onCreateSession }: AgentSelectorProps) {
  const handleAgentClick = (agent: Agent) => {
    onSelectAgent(agent.id);
    onCreateSession(agent.id);
  };

  if (agents.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No agents available</p>
        <p className="text-sm mt-1">Make sure your agents have API access enabled</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Select an Agent
      </h2>
      
      <div className="space-y-2">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => handleAgentClick(agent)}
            className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
              selectedAgentId === agent.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                selectedAgentId === agent.id ? 'bg-blue-500' : 'bg-gray-400'
              }`}>
                <Bot className="w-5 h-5 text-white" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    {agent.name}
                  </h3>
                  {selectedAgentId === agent.id && (
                    <Check className="w-4 h-4 text-blue-500" />
                  )}
                </div>
                
                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                  <span className="capitalize">{agent.type}</span>
                  <span className="capitalize">{agent.provider}</span>
                  {!agent.apiEnabled && (
                    <span className="text-red-500 font-medium">API Disabled</span>
                  )}
                </div>
                
                {agent.outputSchema && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-green-600 dark:text-green-400">
                    <Settings className="w-3 h-3" />
                    <span>Structured Output Enabled</span>
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
      
      <div className="mt-6 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          <strong>Tip:</strong> Agents with "Structured Output Enabled" will return both 
          raw text and parsed JSON data according to their configured schema.
        </p>
      </div>
    </div>
  );
}