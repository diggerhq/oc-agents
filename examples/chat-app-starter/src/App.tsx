import { useState } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { AgentSelector } from './components/AgentSelector';
import { useOshuChat } from './hooks/useOshuChat';
import { Settings, MessageSquare } from 'lucide-react';

function App() {
  const [apiKey, setApiKey] = useState(
    localStorage.getItem('oshu_api_key') || 'flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2'
  );
  const [baseUrl, setBaseUrl] = useState(
    localStorage.getItem('oshu_base_url') || 'http://localhost:3000'
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [showSettings, setShowSettings] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(true);

  const {
    connected,
    connecting,
    agents,
    currentSession,
    error,
    isLoading,
    sendMessage,
    createSession,
    clearError
  } = useOshuChat({
    apiKey,
    baseUrl,
    selectedAgentId,
    autoSave: true,
    streamingEnabled
  });

  const handleSaveSettings = () => {
    localStorage.setItem('oshu_api_key', apiKey);
    localStorage.setItem('oshu_base_url', baseUrl);
    setShowSettings(false);
    // Note: You'll need to refresh to apply new settings
    window.location.reload();
  };

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="h-screen bg-gray-100 dark:bg-gray-900 flex">
      {/* Sidebar */}
      <div className="w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <MessageSquare className="w-6 h-6" />
              Oshu Chat
            </h1>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
          
          <div className="mt-2 flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : connecting ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-gray-600 dark:text-gray-400">
              {connecting ? 'Connecting...' : connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
            <h3 className="font-medium text-gray-900 dark:text-white mb-3">Settings</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded 
                           bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="flt_..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Base URL
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded 
                           bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="http://localhost:3000"
                />
              </div>
              
              <div>
                <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={streamingEnabled}
                    onChange={(e) => setStreamingEnabled(e.target.checked)}
                    className="rounded"
                  />
                  Enable streaming responses
                </label>
              </div>
              
              <button
                onClick={handleSaveSettings}
                className="w-full px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
              >
                Save & Reload
              </button>
            </div>
          </div>
        )}

        {/* Agent Selector */}
        <div className="flex-1 overflow-y-auto">
          {connected ? (
            <AgentSelector
              agents={agents.filter(a => a.apiEnabled)}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              onCreateSession={createSession}
            />
          ) : (
            <div className="p-4 text-center text-gray-500">
              <p>Connect to see available agents</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {currentSession ? (
          <ChatInterface
            messages={currentSession.messages}
            onSendMessage={(content) => {
              if (selectedAgentId) {
                sendMessage(content, selectedAgentId);
              }
            }}
            isConnected={connected}
            isLoading={isLoading}
            agentName={selectedAgent?.name}
            error={error}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-semibold mb-2">Welcome to Oshu Chat</h2>
              <p>Select an agent from the sidebar to start chatting</p>
              {error && (
                <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                  <button
                    onClick={clearError}
                    className="mt-2 text-xs text-red-500 hover:text-red-700 underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;