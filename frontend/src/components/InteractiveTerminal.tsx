import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

interface InteractiveTerminalProps {
  sessionId: string;
  isVisible: boolean;
}

export default function InteractiveTerminal({ sessionId, isVisible }: InteractiveTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');

  useEffect(() => {
    if (!terminalRef.current || !isVisible) return;

    // Create terminal instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        black: '#000000',
        red: '#cd0000',
        green: '#00cd00',
        yellow: '#cdcd00',
        blue: '#0000ee',
        magenta: '#cd00cd',
        cyan: '#00cdcd',
        white: '#e5e5e5',
        brightBlack: '#7f7f7f',
        brightRed: '#ff0000',
        brightGreen: '#00ff00',
        brightYellow: '#ffff00',
        brightBlue: '#5c5cff',
        brightMagenta: '#ff00ff',
        brightCyan: '#00ffff',
        brightWhite: '#ffffff',
      },
      scrollback: 10000,
      allowTransparency: false,
    });

    // Add addons
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    // Open terminal
    term.open(terminalRef.current);
    fitAddon.fit();

    // Store refs
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Display welcome message
    term.writeln('\x1b[1;32mConnecting to sandbox terminal...\x1b[0m');

    // Connect to PTY WebSocket
    // In development, connect directly to backend (bypass Vite proxy issues)
    const isDev = window.location.port === '5173';
    const wsHost = isDev ? 'localhost:3000' : window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${wsHost}/pty?sessionId=${sessionId}`;

    setConnectionStatus('connecting');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[PTY] WebSocket connected');
      setConnectionStatus('connected');
      term.writeln('\x1b[1;32mConnected! You can now type commands.\x1b[0m');
      term.writeln('');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'data') {
          // Write PTY output to terminal
          term.write(msg.data);
        } else if (msg.type === 'error') {
          term.writeln(`\x1b[1;31mError: ${msg.message}\x1b[0m`);
        } else if (msg.type === 'ready') {
          console.log('[PTY] Terminal ready');
        }
      } catch (error) {
        console.error('[PTY] Error parsing message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[PTY] WebSocket error:', error);
      setConnectionStatus('error');
      term.writeln('\x1b[1;31mConnection error\x1b[0m');
    };

    ws.onclose = () => {
      console.log('[PTY] WebSocket closed');
      setConnectionStatus('disconnected');
      term.writeln('');
      term.writeln('\x1b[1;33mConnection closed\x1b[0m');
    };

    // Handle terminal input
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle terminal resize
    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }));
      }
    };

    // Resize on window resize
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      term.dispose();
    };
  }, [sessionId, isVisible]);

  // Re-fit terminal when visibility changes
  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 10);
    }
  }, [isVisible]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'connecting':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`}></div>
          <span className="text-sm text-gray-300">{getStatusText()}</span>
        </div>
        <div className="text-xs text-gray-500">Interactive Terminal</div>
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 p-2 overflow-hidden"
        style={{ height: '100%' }}
      />
    </div>
  );
}
