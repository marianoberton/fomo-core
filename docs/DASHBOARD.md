# Nexus Dashboard — User Guide

The Nexus Dashboard is the **internal control panel** for the Fomo team. It is where you create and configure client projects, manage agents, monitor conversations, and handle approvals.

> **Who uses it**: Only the Fomo team. Clients do not have access (yet).
> **URL**: `http://localhost:3000` (development) or your deployment domain.
> **Backend**: Calls the Nexus Core API at port 3002.

---

## Getting Started

### Login

The dashboard uses API key authentication. On the login page, enter the API key configured in your Nexus Core `.env` file. There is no user management — one key per team.

---

## Projects

### Projects List (`/projects`)

Shows all client projects. Each project is an isolated environment with its own agents, channels, budgets, and data.

**Create a project**: Click "New Project". Enter a name and optional description. The project is created immediately with no agents or channels — you add those next.

### Project Overview (`/projects/[projectId]`)

The project home page shows:
- Active agents and their statuses
- Connected channels
- Recent activity (last conversations, last traces)
- Quick links to sub-sections

---

## Agents

### Agent List (`/projects/[projectId]/agents`)

Lists all agents in the project. Each agent card shows:
- Agent name and description
- Operating mode (customer-facing / internal / copilot)
- LLM provider and model
- Active/paused status

### Create Agent (`/projects/[projectId]/agents/new`)

Step-by-step agent creation form:

1. **Name & Description** — Internal name (e.g. "ventas"), displayed description
2. **Operating Mode**:
   - `customer-facing` — talks to end customers via messaging channels
   - `internal` — background worker (scheduled tasks, data processing)
   - `copilot` — assists the Fomo team via the dashboard chat interface
3. **LLM Provider** — Pick provider (Anthropic / OpenAI / Google / Ollama) and model
4. **Tool Allowlist** — Select which tools this agent can use. Tools not in this list cannot be called, even if the LLM tries.
5. **Channel Mapping** — Assign which project channels this agent handles (only for customer-facing agents)
6. **Budget** — Daily USD budget limit for this agent's LLM usage

### Agent Detail (`/projects/[projectId]/agents/[agentId]`)

Full agent configuration page with tabs:

**Config tab**
- Change provider/model
- Edit tool allowlist
- Set max turns per conversation
- Set operating mode
- Assign MCP servers

**Prompt Layers tab**
See and edit the three prompt layers:
- **Identity**: who the agent is, personality, role
- **Instructions**: business rules, what to do
- **Safety**: hard constraints, what NOT to do

Each layer is versioned. To change a layer:
1. Click "Edit" on the layer
2. Write the new content
3. Click "Activate" — this saves a new version and deactivates the old one
4. The old version remains — click "Rollback" to reactivate it

**Channels tab**
Shows which channels this agent is mapped to. Change the mapping here.

**MCP Servers tab**
Shows configured MCP server instances for this agent.

### Test Chat (`/projects/[projectId]/agents/[agentId]/chat`)

Send test messages directly to the agent from the browser. The chat interface:
- Shows the full agent response with streaming
- Shows tool calls in real time (which tool was called, with what input, and the result)
- Shows token usage per turn
- Creates a real session (appears in the Inbox and Traces)

**Use this to verify**: that a newly configured agent works before pointing a real channel to it.

### Agent Logs / Traces (`/projects/[projectId]/agents/[agentId]/logs`)

Filtered view of execution traces for this specific agent.

---

## Integrations (Channels)

### Integrations Page (`/projects/[projectId]/integrations`)

Shows all connected channels for the project. Each channel card shows:
- Channel type (WhatsApp, Telegram, Slack, etc.) with logo
- Connection status (connected / disconnected / pending)
- Webhook URL
- Actions: test, disconnect, view details

### Adding a Channel (Wizard Flow)

Click "Add Channel" and pick a channel type. The wizard guides you through setup — no raw forms.

#### WhatsApp via WAHA (QR scan)

Best for: clients who want to use their existing WhatsApp number. No Meta Business approval needed.

1. Pick "WhatsApp" → "WAHA (QR Scan)"
2. (Optional) Enter a session name — defaults to the project ID
3. The dashboard shows a live QR code from WAHA
4. Open WhatsApp on your phone → **Linked Devices** → **Link a Device** → scan the QR
5. QR turns green ✅ — channel is now connected
6. Click "Confirm" to save the integration

WAHA is bundled in Docker Compose and runs automatically. You do not need to install anything.

#### WhatsApp via Meta Cloud API

Best for: high-volume or business-critical deployments. Requires Meta Business Account approval.

1. Pick "WhatsApp" → "Meta Cloud API"
2. Enter:
   - **Access Token** — from Meta for Developers app
   - **Phone Number ID** — from WhatsApp Business settings
   - **Webhook Verify Token** — a secret string you choose
3. Click "Connect"
4. Copy the webhook URL shown → paste it into Meta's developer portal under WhatsApp → Webhook Configuration
5. Meta verifies the URL automatically
6. Subscribe to `messages` field in Meta's webhook settings
7. Click "Confirm" to save

#### Telegram

1. Open Telegram → search for `@BotFather` → `/newbot`
2. Follow the prompts to name your bot and get a bot token (`123456:ABC-DEF...`)
3. In the dashboard: pick "Telegram"
4. Paste the bot token
5. If `NEXUS_PUBLIC_URL` is set, the webhook is registered automatically
6. If not: copy the webhook URL shown and manually call:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WEBHOOK_URL>
   ```
7. Click "Confirm"

#### Slack

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch
2. Configure OAuth scopes: `chat:write`, `channels:history`, `im:history`
3. Install to workspace → copy the Bot User OAuth Token (`xoxb-...`)
4. In the dashboard: pick "Slack"
5. Paste the bot token
6. (Optional) Paste the Signing Secret for webhook verification
7. Click "Connect" → copy the webhook URL shown
8. In Slack App → Event Subscriptions → paste the webhook URL
9. Subscribe to `message.channels`, `message.im` events
10. Click "Confirm"

---

## Inbox

### Inbox Page (`/projects/[projectId]/inbox`)

WhatsApp Web-style conversation view. Shows all active conversations across all channels in real time.

**Layout**: contact list on the left, conversation on the right.

**Contact list** shows:
- Contact name (or phone number if no name)
- Channel icon (WhatsApp, Telegram, Slack)
- Last message preview
- Time of last message
- Unread indicator

**Conversation view** shows:
- Full message history
- Agent responses (labeled "Agent")
- Tool calls (shown as cards: tool name + inputs + result)
- Timestamps

**Real-time**: new messages appear instantly via WebSocket — no need to refresh.

---

## Approvals

Approvals appear when an agent tries to call a tool that is marked `requiresApproval: true` (typically `escalate-to-human` or high-risk tools). The agent pauses and waits.

### Project Approvals (`/projects/[projectId]/approvals`)

Shows pending approvals for this project.

### Global Approvals (`/approvals`)

Shows pending approvals across all projects.

### Reviewing an Approval

Each approval card shows:
- **Which agent** is waiting
- **Which tool** was called
- **The agent's reasoning** — why it's asking
- **The input** — what the agent wants to do
- **Conversation context** — relevant messages leading up to this

Actions:
- **Approve** — enter a response or decision, click Approve. The agent receives your text and continues.
- **Reject** — enter a reason, click Reject. The agent receives the rejection and can handle it (e.g. apologize to the customer, offer an alternative).

---

## Costs

### Costs Page (`/projects/[projectId]/costs`)

Shows LLM usage and spend:

- **Today's spend** vs **daily budget** (progress bar)
- **This month's spend** vs **monthly budget**
- **Per-agent breakdown**: bar chart of spend per agent
- **Daily history**: line chart of spend per day for the last 30 days
- **Usage table**: each LLM call with timestamp, model, tokens (input/output), cost

---

## Execution Traces

### Traces Page (`/projects/[projectId]/traces`)

Full execution history for the project. Each trace represents one complete agent run (from receiving a message to sending the response).

**Trace list** shows:
- Timestamp
- Agent name
- Session (contact name/ID)
- Duration (ms)
- Total tokens
- Status (completed / error / timeout)

### Trace Detail

Click a trace to open the timeline:

```
[12:34:01.001] ← User message: "What's the price of a 10mm drill?"
[12:34:01.050]   BuildPrompt (identity v3, instructions v7, safety v2)
[12:34:01.120]   LLM call → GPT-4o-mini (312 tokens in)
[12:34:01.890]   ← LLM response: tool_call: catalog_search({"query": "10mm drill"})
[12:34:01.900]   Tool: catalog_search → 3 results returned
[12:34:01.950]   LLM call → GPT-4o-mini (580 tokens in)
[12:34:02.400]   ← LLM response: "A 10mm black oxide drill bit costs $2.50..."
[12:34:02.410]   Send via WhatsApp → OK
[12:34:02.420] Trace completed. 892 tokens, $0.00089
```

Use traces to debug why an agent responded incorrectly or to verify that tools are being called as expected.

---

## Prompt Layers

### Prompts Page (`/projects/[projectId]/prompts`)

Manage the three system prompt layers for each agent:

- **Identity**: who the agent is
- **Instructions**: what to do
- **Safety**: what NOT to do

### Editing a Layer

1. Click the layer you want to edit
2. The current active content is shown in the editor
3. Make changes
4. Click "Save & Activate" — this creates a new version and activates it immediately
5. The previous version is preserved

### Viewing Version History

Each layer shows a version history list. Each version shows:
- Version number
- Activation date
- Change reason (if entered)
- Who activated it

### Rollback

Click "Activate" on any past version to roll back. The current version is deactivated automatically.

---

## Knowledge Base

### Knowledge Page (`/projects/[projectId]/knowledge`)

Manage entries in the project's knowledge base. Agents use the `knowledge-search` tool to search this.

**Add entry**: Paste text, or upload a document. Embeddings are generated automatically.

**Use cases**: product manuals, FAQ, company policies, pricing guidelines, scripts.

---

## Files

### Files Page (`/projects/[projectId]/files`)

Upload and manage files that agents can read via the `read-file` tool.

- Supported formats: PDF (text extracted), plain text
- Files are project-scoped
- Each file gets an ID — share the filename or ID with the agent via Instructions prompt

---

## Scheduled Tasks

### Tasks Page (`/projects/[projectId]/tasks`)

View and manage scheduled tasks for the project.

**Task states**:
- `proposed` — agent requested this task; **requires your approval** before it runs
- `active` — running on schedule
- `paused` — temporarily disabled
- `cancelled` — permanently stopped

**Approve a proposed task**: Click "Approve" on a `proposed` task. Choose to activate it immediately or on next schedule.

**Create a task**: Click "New Task". Enter name, description, cron expression (e.g. `0 9 * * 1` for every Monday 9am), and which agent to run.

---

## Webhooks

### Webhooks Page (`/projects/[projectId]/webhooks`)

Create inbound webhook endpoints that trigger agents.

### Creating a Webhook

1. Click "New Webhook"
2. Enter:
   - **Name**: descriptive name (e.g. "New CRM Lead")
   - **Trigger Prompt**: Mustache template for the message sent to the agent
     ```
     New lead received from {{source}}: {{name}} ({{email}}).
     Phone: {{phone}}. Company: {{company}}.
     ```
   - **Secret** (optional): HMAC secret for payload verification
   - **IP Allowlist** (optional): restrict to specific source IPs
3. Click "Create" → you get a unique webhook URL:
   ```
   https://your-domain.com/api/v1/webhooks/{webhookId}
   ```
4. Paste this URL into your CRM, form tool, or external service

When the webhook fires with a JSON payload, the fields are injected into the Mustache template and the result is sent to the assigned agent as a task.

---

## Secrets

### Secrets Page (`/projects/[projectId]/secrets`)

Store encrypted credentials for use by tools and channels.

- **Add secret**: enter a key name (e.g. `SENDGRID_API_KEY`) and value. The value is encrypted and stored — it is **never shown again** after creation.
- **Delete secret**: removes the encrypted record.
- Secrets are injected at runtime by the tool executor. The LLM never sees secret values.

---

## MCP Servers

### MCP Servers Page (`/projects/[projectId]/mcp-servers`)

Connect external tools to the project via MCP (Model Context Protocol).

**Add an MCP server**:
1. Click "Add Server"
2. Enter:
   - **Name**: internal identifier (e.g. `google-calendar`)
   - **Transport**: `SSE` (for production HTTP services) or `stdio` (for subprocess, dev only)
   - **URL** (SSE) or **Command + Args** (stdio)
   - **Environment variables** if needed
3. Click "Connect" — Nexus Core connects to the server and discovers all its tools
4. The tools appear in the agent's tool allowlist as `mcp:serverName:toolName`

See [MCP_GUIDE.md](MCP_GUIDE.md) for detailed examples.

---

## Contacts

### Contacts Page (`/projects/[projectId]/contacts`)

Lists all contacts (end users) for this project. Contacts are created automatically when a new user sends a message via any channel.

**Contact record** shows:
- Name (resolved from channel)
- Channel identifiers (phone number, Telegram ID, Slack user ID)
- Language
- First seen / last seen
- Link to their conversation sessions

---

## Sessions

### Sessions (via Inbox or Traces)

Sessions are conversation threads. Each contact has one ongoing session per project (or per agent, depending on routing). Session history is preserved and available to the agent's memory system.

---

## Tips for the Fomo Team

1. **Always test a new agent in Test Chat before pointing a live channel to it.** It creates a real trace and session, so you can see exactly how it behaves.

2. **Use the Safety layer for non-negotiable rules.** Things that must never happen (share competitor prices, promise unrealistic delivery dates) belong in Safety, not Instructions. They are harder to override.

3. **Keep the Identity layer focused on personality.** Long instructions don't belong there — put them in Instructions. Identity should answer: "Who am I and how do I speak?"

4. **Review traces when something goes wrong.** The trace shows exactly which prompt was active, which tools were called, and what the LLM said at each step. You'll find the problem faster than reading logs.

5. **Approve proposed tasks carefully.** When an agent proposes a scheduled task, it's making a judgment call. Review the cron expression and the task description before activating.

6. **Secrets are one-way.** Once you save a secret, you can't read it back. Keep a copy of credentials in your password manager before pasting them into the dashboard.
