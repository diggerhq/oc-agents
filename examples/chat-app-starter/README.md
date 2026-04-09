# Oshu Chat Interface

A custom chat interface built on the Oshu SDK - now integrated directly into the main Oshu repository!

## ✨ Features

- **Real-time Chat**: Connect to Oshu agents and chat in real-time
- **Agent Selection**: Choose from available agents with API access
- **Streaming Support**: Real-time streaming responses with live updates
- **Structured Output**: View both raw responses and structured JSON data
- **Modern UI**: Clean, responsive interface with dark mode support
- **Graceful Restarts**: Automatic sandbox recovery (no more "sandbox not running" errors!)

## 🚀 Quick Start

### Option 1: Easy Install (Recommended)
```bash
cd examples/chat-app-starter
./install.sh
npm run dev
```

### Option 2: Manual Setup
```bash
cd examples/chat-app-starter
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

## ⚙️ Configuration

The app includes a built-in settings panel (click the gear icon):

- **API Key**: Your Oshu API key (default: `flt_GkBRHUPABVyy2bbkk-0KHxI73Z8cByN2`)
- **Base URL**: Your Oshu backend URL (default: `http://localhost:3000`)
- **Streaming**: Enable/disable real-time streaming responses

Settings are automatically saved to localStorage.

## 💬 Usage

1. **Auto-Connect**: The app automatically connects to your Oshu backend
2. **Select Agent**: Choose an API-enabled agent from the sidebar
3. **Start Chatting**: Type your message and press Enter or click Send
4. **Watch Magic**: See real-time streaming responses with structured output

## 🔧 What's Fixed

This version addresses the key issues from the previous standalone version:

### ✅ Message Display Issue
- **Problem**: Messages weren't showing up in the chat
- **Fix**: Proper state management and React re-rendering for real-time updates

### ✅ SDK Integration
- **Problem**: Complex npm linking and package management
- **Fix**: Direct file reference to the TypeScript SDK in the same repo

### ✅ Graceful Error Handling
- **Problem**: "Sandbox not running" errors breaking the chat
- **Fix**: Automatic sandbox restart and retry logic in the backend

## 🏗️ Architecture

```
chat-app-starter/
├── src/
│   ├── components/
│   │   ├── ChatInterface.tsx    # Main chat UI with streaming
│   │   └── AgentSelector.tsx    # Agent selection sidebar
│   ├── hooks/
│   │   └── useOshuChat.ts      # Core chat logic & SDK integration
│   ├── types/
│   │   └── chat.ts             # TypeScript definitions
│   └── App.tsx                 # Main application
├── install.sh                  # Easy setup script
└── package.json               # Direct SDK reference
```

## 🔌 SDK Integration Example

```typescript
import { Oshu } from '@opencomputer/agents-sdk';

const oshu = new Oshu({
  apiKey: 'flt_your_api_key',
  baseUrl: 'http://localhost:3000'
});

// Connect and send streaming messages
await oshu.connect();

// Option 1: Streaming with real-time updates
const task = await oshu.agents.submit(agentId, { 
  prompt: 'Hello!',
  timeout: 300 
});

task.on('stdout', (data) => {
  console.log('Streaming:', data);
});

const result = await task.result();
console.log('Final result:', result.result);
console.log('Structured output:', result.output);

// Option 2: Simple blocking call
const result = await oshu.agents.run(agentId, { 
  prompt: 'Hello!' 
});
```

## 🎨 Customization

All components are modular and easily customizable:

- **Styling**: Tailwind CSS classes throughout
- **Themes**: Built-in dark mode support
- **Components**: Modular React components
- **State**: Clean separation of concerns with custom hooks

## 🐛 Troubleshooting

**Chat not connecting?**
- Check that the Oshu backend is running on `localhost:3000`
- Verify your API key in Settings
- Check browser console for detailed error messages

**Messages not showing?**
- This has been fixed! The state management now properly updates the UI

**Sandbox errors?**
- These are now handled gracefully with automatic restarts

## 📦 Dependencies

- **React 18** with TypeScript
- **Vite** for fast development
- **Tailwind CSS** for styling
- **@opencomputer/agents-sdk** (local file reference)
- **Lucide React** for icons