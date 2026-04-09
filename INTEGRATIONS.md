# Integrations Guide

Connect external services to summon and trigger your agents from anywhere.

---

## Table of Contents

1. [Overview](#overview)
2. [Slack](#slack-integration)
3. [Discord](#discord-integration)
4. [Microsoft Teams](#microsoft-teams-integration)
5. [Linear](#linear-integration)
6. [Jira](#jira-integration)
7. [Zapier / Make.com / n8n](#zapier--makecom--n8n)
8. [API Reference](#api-reference)

---

## Overview

Integrations allow you to trigger agents from external platforms. Each integration provides:

- **Webhook URL**: A unique endpoint for the platform to call
- **Event processing**: Automatic task creation when events occur
- **Response handling**: Platform-appropriate responses and notifications

### How It Works

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│    Slack     │ ──── │    Jeff      │ ──── │    Agent     │
│   /agent     │      │  Webhook     │      │   Task       │
│   command    │      │  Endpoint    │      │   Queue      │
└──────────────┘      └──────────────┘      └──────────────┘
        │                     │                     │
        └─── User types ──────┴── Task created ─────┴── Agent executes
            /agent fix bug        & queued              the task
```

---

## Slack Integration

### Features
- **Slash Commands**: `/agent <task>` to summon agents
- **@mentions**: Mention the bot in any channel
- **Channel Responses**: Results posted back to the channel

### Setup Instructions

#### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name your app (e.g., "Jeff Agent") and select your workspace
4. Click **Create App**

#### 2. Add a Slash Command

1. In your app settings, go to **Slash Commands**
2. Click **Create New Command**
3. Configure the command:
   - **Command**: `/agent` (or your preferred name)
   - **Request URL**: `https://your-domain.com/api/integrations/slack/webhook/{your-webhook-secret}`
   - **Short Description**: "Summon an AI agent"
   - **Usage Hint**: "[task description]"
4. Click **Save**

#### 3. Install the App

1. Go to **Install App** in the sidebar
2. Click **Install to Workspace**
3. Authorize the permissions

#### 4. Configure in Jeff

1. Go to **Integrations** in Jeff
2. Click **Add Integration** → **Slack**
3. Name your integration and select a default agent
4. Copy the webhook URL and update your Slack app's Request URL

### Optional: Enable @Mentions

To allow users to @mention your bot:

1. Go to **Event Subscriptions** in your Slack app
2. Enable events and set the Request URL to:
   ```
   https://your-domain.com/api/integrations/slack/events/{your-webhook-secret}
   ```
3. Subscribe to the `app_mention` bot event
4. Reinstall the app

### Usage Examples

```
/agent Fix the login button CSS bug

/agent Review the latest PR and suggest improvements

/agent Generate unit tests for the UserService class
```

### Response Format

When a task is queued, Slack users will see:

```
🤖 Task queued! Working on: "Fix the login button CSS bug"
Task ID: abc123-def456
Triggered by @username
```

---

## Discord Integration

### Features
- **Slash Commands**: `/agent task:<description>`
- **Rich Embeds**: Beautiful response cards
- **Server-wide Access**: Use in any channel

### Setup Instructions

#### 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it and click **Create**

#### 2. Create a Bot

1. Go to the **Bot** section
2. Click **Add Bot**
3. Copy the **Token** (you'll need this)
4. Under **Privileged Gateway Intents**, enable **Message Content Intent** if needed

#### 3. Configure Interactions Endpoint

1. Go to **General Information**
2. Set **Interactions Endpoint URL** to:
   ```
   https://your-domain.com/api/integrations/discord/webhook/{your-webhook-secret}
   ```

#### 4. Register Slash Commands

Use the Discord API to register your slash command:

```bash
curl -X POST "https://discord.com/api/v10/applications/{APPLICATION_ID}/commands" \
  -H "Authorization: Bot {BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "agent",
    "description": "Summon an AI agent",
    "options": [{
      "name": "task",
      "description": "What should the agent do?",
      "type": 3,
      "required": true
    }]
  }'
```

#### 5. Invite the Bot

Generate an invite URL:
```
https://discord.com/api/oauth2/authorize?client_id={APPLICATION_ID}&permissions=2147483648&scope=bot%20applications.commands
```

#### 6. Configure in Jeff

1. Go to **Integrations** → **Add Integration** → **Discord**
2. Enter your Application ID and Public Key
3. Select a default agent
4. Save the integration

### Usage

In any Discord channel:
```
/agent task:Analyze the performance of our API endpoints
```

### Response

```
┌─────────────────────────────────────┐
│ 🤖 Task Queued                      │
│ "Analyze the performance..."        │
├─────────────────────────────────────┤
│ Task ID: abc123-def456              │
│ Triggered by: username              │
└─────────────────────────────────────┘
```

---

## Microsoft Teams Integration

### Features
- **Outgoing Webhooks**: Trigger agents with @mentions
- **Adaptive Cards**: Rich response formatting
- **Channel Integration**: Works in any Teams channel

### Setup Instructions

#### Option 1: Outgoing Webhook (Simplest)

1. In Microsoft Teams, go to your team
2. Click **⋯** next to the team name → **Manage team**
3. Go to the **Apps** tab → **Create an outgoing webhook**
4. Configure:
   - **Name**: Jeff Agent
   - **Callback URL**: `https://your-domain.com/api/integrations/teams/webhook/{your-webhook-secret}`
5. Copy the **Security token** for verification (optional)

#### Option 2: Azure Bot Service (Advanced)

For more features, create a bot via Azure Bot Service:

1. Create a Bot Channels Registration in Azure
2. Configure the messaging endpoint
3. Connect the Teams channel
4. Use the Bot Framework SDK for advanced interactions

### Configure in Jeff

1. Go to **Integrations** → **Add Integration** → **Teams**
2. Name your integration
3. Select a default agent
4. Optionally add the Security Token for signature verification

### Usage

In a Teams channel, mention the webhook:

```
@JeffAgent Please review the latest commit and check for security issues
```

### Response

Teams will display an Adaptive Card:

```
┌─────────────────────────────────────┐
│ 🤖 Task Queued                      │
│                                     │
│ Working on: "Please review the      │
│ latest commit and check for         │
│ security issues"                    │
│                                     │
│ Task ID: abc123-def456              │
└─────────────────────────────────────┘
```

---

## Linear Integration

### Features
- **Issue Triggers**: Automatically process new issues
- **Label Filtering**: Only trigger on specific labels
- **Custom Prompts**: Template-based issue processing
- **Event Types**: Create, update, remove events

### Setup Instructions

#### 1. Create Webhook in Linear

1. Go to Linear **Settings** → **API** → **Webhooks**
2. Click **New webhook**
3. Configure:
   - **Label**: Jeff Integration
   - **URL**: `https://your-domain.com/api/integrations/linear/webhook/{your-webhook-secret}`
   - **Events**: Select relevant events (e.g., Issues)

#### 2. Configure in Jeff

1. Go to **Integrations** → **Add Integration** → **Linear**
2. Configure:
   - **Name**: Linear Issue Processor
   - **Default Agent**: Select your code/task agent
   - **Trigger on**: `create`, `update`, etc.
   - **Filter by labels**: e.g., `agent-task`, `auto-fix`
   - **Prompt template**: Customize how issues are sent to agents

### Prompt Template Variables

Use these variables in your prompt template:

| Variable | Description |
|----------|-------------|
| `{{title}}` | Issue title |
| `{{description}}` | Issue description |
| `{{labels}}` | Comma-separated labels |
| `{{priority}}` | Priority level |
| `{{state}}` | Current state |
| `{{url}}` | Link to the issue |
| `{{identifier}}` | Issue identifier (e.g., ENG-123) |

### Example Prompt Template

```
You are a code agent. A new Linear issue has been created:

Issue: {{identifier}} - {{title}}
Priority: {{priority}}
Labels: {{labels}}

Description:
{{description}}

Please analyze this issue and:
1. Identify the root cause if it's a bug
2. Propose a solution
3. Implement the fix if straightforward

Issue URL: {{url}}
```

### Workflow Example

1. Team creates issue: "Fix: Login button not working on Safari"
2. Issue is labeled with `agent-task`
3. Linear sends webhook to Jeff
4. Jeff queues task for your code agent
5. Agent analyzes and potentially fixes the issue

---

## Jira Integration

### Features
- **Issue Triggers**: Process Jira issues automatically
- **Project Filtering**: Limit to specific projects
- **Issue Type Filtering**: Only process certain issue types
- **JQL Support**: Advanced filtering via Jira Query Language
- **Custom Prompts**: Template-based processing

### Setup Instructions

#### 1. Create Webhook in Jira

1. Go to **Jira Settings** → **System** → **Webhooks**
2. Click **Create a webhook**
3. Configure:
   - **Name**: Jeff Integration
   - **URL**: `https://your-domain.com/api/integrations/jira/webhook/{your-webhook-secret}`
   - **Events**: 
     - Issue: created, updated, deleted
   - **JQL Filter** (optional): `project = DEV AND labels = agent-task`

#### 2. Configure in Jeff

1. Go to **Integrations** → **Add Integration** → **Jira**
2. Configure:
   - **Name**: Jira Issue Processor
   - **Default Agent**: Select your agent
   - **Trigger on**: `jira:issue_created`, `jira:issue_updated`
   - **Filter by projects**: `DEV`, `PROD`
   - **Filter by issue types**: `Bug`, `Task`
   - **Prompt template**: Customize the prompt

### Prompt Template Variables

| Variable | Description |
|----------|-------------|
| `{{key}}` | Issue key (e.g., DEV-123) |
| `{{summary}}` | Issue summary/title |
| `{{description}}` | Full description |
| `{{type}}` | Issue type (Bug, Task, etc.) |
| `{{priority}}` | Priority level |
| `{{status}}` | Current status |
| `{{project}}` | Project name |
| `{{project_key}}` | Project key |
| `{{assignee}}` | Assignee name |
| `{{reporter}}` | Reporter name |
| `{{labels}}` | Comma-separated labels |
| `{{url}}` | Link to the issue |

### Example Prompt Template

```
Jira Issue {{key}} needs attention:

Type: {{type}}
Priority: {{priority}}
Status: {{status}}

Summary: {{summary}}

Description:
{{description}}

Project: {{project}}
Assignee: {{assignee}}
Reporter: {{reporter}}

Please analyze this issue and provide:
1. Initial assessment
2. Potential solutions
3. Estimated complexity

{{url}}
```

### Event Types

| Event | Description |
|-------|-------------|
| `jira:issue_created` | New issue created |
| `jira:issue_updated` | Issue modified |
| `jira:issue_deleted` | Issue deleted |

---

## Zapier / Make.com / n8n

These automation platforms can connect to Jeff using the existing **Webhook** system.

### Trigger Jeff Agent (Zapier → Jeff)

1. In Jeff, go to **Settings** → **Events** → **Webhooks**
2. Create a new webhook targeting your agent
3. In Zapier/Make/n8n, use the webhook URL as a destination
4. Send a POST request with:
   ```json
   {
     "prompt": "Your task description here"
   }
   ```

### Receive Results (Jeff → Zapier)

1. Configure your agent with a `webhook_url` in its settings
2. When tasks complete, Jeff will POST results to your webhook
3. In Zapier/Make/n8n, create a Webhook trigger to receive results

### Example Zapier Zap

```
Trigger: New email in Gmail with label "agent-task"
    ↓
Action: POST to Jeff webhook
    - URL: https://jeff.fly.dev/api/webhooks/trigger/{secret}
    - Body: { "prompt": "Process this email: {{email_body}}" }
    ↓
(Jeff processes the task)
    ↓
Webhook from Jeff: Task completed
    ↓
Action: Send Slack message with results
```

---

## API Reference

### List Integrations

```http
GET /api/integrations
Authorization: Bearer {session}
```

**Response:**
```json
{
  "integrations": [
    {
      "id": "abc123",
      "platform": "slack",
      "name": "My Slack Integration",
      "webhook_url": "https://jeff.fly.dev/api/integrations/slack/webhook/xyz789",
      "is_active": 1,
      "default_agent_id": "agent-123",
      "last_used_at": "2026-01-13T10:00:00Z",
      "created_at": "2026-01-10T08:00:00Z"
    }
  ]
}
```

### Create Integration

```http
POST /api/integrations
Authorization: Bearer {session}
Content-Type: application/json

{
  "platform": "slack",
  "name": "Production Slack",
  "config": {
    "post_results": true
  },
  "default_agent_id": "agent-123"
}
```

### Update Integration

```http
PATCH /api/integrations/{id}
Authorization: Bearer {session}
Content-Type: application/json

{
  "name": "Updated Name",
  "is_active": false,
  "config": { "post_results": false }
}
```

### Delete Integration

```http
DELETE /api/integrations/{id}
Authorization: Bearer {session}
```

### Test Integration

```http
POST /api/integrations/{id}/test
Authorization: Bearer {session}
```

Creates a test task to verify the integration is working.

### Regenerate Webhook Secret

```http
POST /api/integrations/{id}/regenerate-secret
Authorization: Bearer {session}
```

**Response:**
```json
{
  "webhook_secret": "new_secret_here",
  "webhook_url": "https://jeff.fly.dev/api/integrations/slack/webhook/new_secret_here"
}
```

### Get Platform Setup Info

```http
GET /api/integrations/setup/{platform}
Authorization: Bearer {session}
```

Returns setup instructions and configuration fields for a platform.

---

## Security Best Practices

### 1. Webhook Secrets
- Each integration has a unique webhook secret
- Never share your webhook URLs publicly
- Regenerate secrets if compromised

### 2. Signature Verification
For Slack and Teams, enable signature verification:
- Slack: Verify `x-slack-signature` header
- Teams: Use the Security Token for HMAC verification

### 3. IP Allowlisting
Consider restricting webhook endpoints to platform IPs:
- [Slack IP Ranges](https://api.slack.com/docs/egress-firewalls)
- [Discord IP Ranges](https://discord.com/developers/docs/topics/gateway)

### 4. Agent Permissions
- Use dedicated agents for external integrations
- Configure appropriate `allowed_tools` restrictions
- Monitor task queue for unusual activity

---

## Troubleshooting

### Integration Not Triggering

1. Check that the integration is **Active** in Jeff
2. Verify the webhook URL is correctly configured in the external platform
3. Check the **Event Log** in Jeff for received events
4. Ensure a default agent is configured

### Tasks Not Processing

1. Verify the agent is API-enabled (`api_enabled: true`)
2. Check the agent's status is not `failed`
3. Review the task queue for pending tasks
4. Check server logs for errors

### Slack Timeout Errors

Slack requires responses within 3 seconds. If you see timeout errors:
1. Jeff should respond immediately with a queued message
2. Ensure your server isn't overloaded
3. Check network latency to your deployment

### Discord Interaction Failed

1. Verify the Public Key in your integration config
2. Ensure the Interactions Endpoint URL is correct
3. Check that slash commands are registered

---

*Last updated: January 2026*
