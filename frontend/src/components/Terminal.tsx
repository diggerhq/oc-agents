import { useEffect, useRef, useState, useCallback } from 'react';

interface TerminalLine {
  type: 'stdout' | 'stderr' | 'start' | 'end' | 'info';
  content: string;
  timestamp: number;
}

interface TerminalProps {
  sessionId: string;
  isVisible: boolean;
}

export function Terminal({ sessionId, isVisible }: TerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [connected, setConnected] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const processEvent = useCallback((data: { type: string; data?: string; command?: string; exitCode?: number; elapsed?: string; timestamp: number }) => {
    if (data.type === 'connected') {
      setConnected(true);
      setLines(prev => [...prev, {
        type: 'info',
        content: '● Connected to sandbox terminal',
        timestamp: Date.now(),
      }]);
    } else if (data.type === 'heartbeat') {
      // Silent heartbeat - just keep connection alive
    } else if (data.type === 'start') {
      setLines(prev => [...prev, {
        type: 'info',
        content: `▶ Running command...`,
        timestamp: data.timestamp,
      }]);
    } else if (data.type === 'stdout' && data.data) {
      const newLines = data.data.split('\n').filter((l: string) => l);
      setLines(prev => [...prev, ...newLines.map((content: string) => ({
        type: 'stdout' as const,
        content,
        timestamp: data.timestamp,
      }))]);
    } else if (data.type === 'stderr' && data.data) {
      const newLines = data.data.split('\n').filter((l: string) => l);
      setLines(prev => [...prev, ...newLines.map((content: string) => ({
        type: 'stderr' as const,
        content,
        timestamp: data.timestamp,
      }))]);
    } else if (data.type === 'end') {
      setLines(prev => [...prev, {
        type: 'info',
        content: `■ Command finished (exit: ${data.exitCode}, took: ${data.elapsed}s)`,
        timestamp: data.timestamp,
      }]);
    }
  }, []);

  useEffect(() => {
    if (!isVisible || !sessionId) return;

    const controller = new AbortController();
    abortRef.current = controller;

    // Use fetch with streaming for better CORS support
    const connectSSE = async () => {
      try {
        // Use the Vite proxy (relative URL)
        const response = await fetch(`/api/agent/sessions/${sessionId}/terminal`, {
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Accept': 'text/event-stream',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        setConnected(true);
        setLines(prev => [...prev, {
          type: 'info',
          content: '● Connected to sandbox terminal',
          timestamp: Date.now(),
        }]);

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) return;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                processEvent(data);
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setConnected(false);
          setLines(prev => [...prev, {
            type: 'stderr',
            content: '● Disconnected from terminal',
            timestamp: Date.now(),
          }]);
        }
      }
    };

    connectSSE();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [sessionId, isVisible, processEvent]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  if (!isVisible) return null;

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div className="bg-white/5 px-3 py-2 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white/70">Terminal</span>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
        <button
          onClick={() => setLines([])}
          className="text-xs text-white/50 hover:text-white font-mono"
        >
          clear
        </button>
      </div>
      <div
        ref={terminalRef}
        className="bg-black p-3 h-64 overflow-y-auto font-mono text-xs"
      >
        {lines.length === 0 ? (
          <div className="text-white/30">Waiting for agent output...</div>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-all ${
                line.type === 'stderr' ? 'text-red-400' :
                line.type === 'info' ? 'text-blue-400' :
                'text-green-400'
              }`}
            >
              {line.content}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

