# E2B Templates for Agent Orchestrator

This builds custom E2B sandbox templates with the AI coding tools pre-installed.

## Setup

```bash
cd e2b-templates
npm install
```

Create a `.env` file with your E2B API key:
```
E2B_API_KEY=your-e2b-api-key
```

## Build Templates

Build all templates:
```bash
npm run build
```

Build a specific template:
```bash
npm run build:claude-code
npm run build:aider
npm run build:opencode
```

## Templates

| Template | Alias | Description |
|----------|-------|-------------|
| claude-code | claude-code-agent | Claude Code CLI (Anthropic) |
| aider | aider-agent | Aider AI pair programming |
| opencode | opencode-agent | OpenCode open-source agent |

## After Building

Add the template aliases to your `backend/.env`:

```env
E2B_TEMPLATE_CLAUDE_CODE=claude-code-agent
E2B_TEMPLATE_AIDER=aider-agent
E2B_TEMPLATE_OPENCODE=opencode-agent
```

