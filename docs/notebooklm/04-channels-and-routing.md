# Nexus Core — Channels, Routing, and Multi-Agent Modes

## Channel System Overview

The channel system is how agents communicate with the outside world. Each project can have multiple channel integrations (WhatsApp numbers, Telegram bots, Slack workspaces) configured with their own credentials. When a message arrives via a webhook, the system routes it to the correct agent based on the project, channel, and contact role.

## Supported Channels

| Channel | Provider | How It Works |
|---------|----------|-------------|
| WhatsApp (WAHA) | `whatsapp-waha` | Self-hosted via WAHA Docker container. QR code pairing. Webhooks for inbound. |
| WhatsApp (Cloud API) | `whatsapp` | Meta's official Business API. Phone number ID + access token. |
| Telegram | `telegram` | Bot API with webhook registration. Bot token from @BotFather. |
| Slack | `slack` | Slack Bot with Events API. Bot token + signing secret. |
| Chatwoot | `chatwoot` | Open-source live chat. Agent bot integration via API. |
| Email | `email` | Via Resend API for outbound. Inbound via webhooks. |
| Dashboard | `dashboard` | WebSocket chat in the dashboard UI. No external service needed. |

## Architecture

```
External Service (WhatsApp/Telegram/Slack)
  ↓ webhook
Channel Webhook Route (/api/v1/webhooks/channels/:provider/:projectId)
  ↓
Channel Adapter (parses provider-specific payload)
  ↓ normalized InboundMessage
Inbound Processor
  ↓
Contact Lookup/Creation → Session Lookup/Creation → Agent Resolution → Mode Resolution
  ↓
Chat Setup → Agent Runner → Response
  ↓
Channel Adapter.send() → External Service → User sees response
```

## Channel Integration (Database)

Each project stores channel configurations in the `ChannelIntegration` table:

```typescript
ChannelIntegration {
  id: string;
  projectId: string;
  provider: string;           // 'whatsapp', 'whatsapp-waha', 'telegram', 'slack', 'chatwoot'
  config: IntegrationConfig;  // Provider-specific config (JSON)
  status: 'active' | 'paused';
}
```

### Provider-Specific Configs

**WhatsApp Cloud API:**
```json
{
  "phoneNumberId": "123456789",
  "accessTokenSecretKey": "META_ACCESS_TOKEN",
  "verifyToken": "my-verify-token"
}
```

**WhatsApp WAHA:**
```json
{
  "baseUrl": "http://localhost:3003",
  "sessionName": "default"
}
```

**Telegram:**
```json
{
  "botTokenSecretKey": "TELEGRAM_BOT_TOKEN"
}
```

**Slack:**
```json
{
  "botTokenSecretKey": "SLACK_BOT_TOKEN",
  "signingSecretKey": "SLACK_SIGNING_SECRET",
  "channels": ["C05ABCDEF"]
}
```

Note: Credential values are stored as **secret key references** (e.g., `"META_ACCESS_TOKEN"`) — not the actual tokens. The `SecretService` resolves them at runtime from the encrypted secrets table.

## Channel Resolver (src/channels/channel-resolver.ts)

The `ChannelResolver` lazily creates channel adapters from DB configuration:

```typescript
interface ChannelResolver {
  resolve(projectId: string, provider: string): Promise<ChannelAdapter>;
  listIntegrations(projectId: string): Promise<ChannelIntegration[]>;
}
```

When a message arrives:
1. Look up the `ChannelIntegration` for this project + provider
2. If an adapter is already cached → return it
3. Otherwise → create a new adapter using the config + SecretService
4. Cache the adapter for future requests

This means credentials are only decrypted when needed, and adapters are reused across requests.

## Channel Adapter Interface

Every channel adapter implements:

```typescript
interface ChannelAdapter {
  provider: string;
  send(params: {
    to: string;
    message: string;
    media?: { url: string; type: string };
  }): Promise<void>;

  parseInbound(payload: unknown): InboundMessage;
}
```

### InboundMessage (Normalized)

```typescript
interface InboundMessage {
  externalId: string;        // Message ID from the external service
  channel: string;           // 'whatsapp', 'telegram', etc.
  from: {
    phone?: string;
    telegramId?: string;
    slackId?: string;
    name?: string;
  };
  text: string;
  media?: {
    url: string;
    type: 'image' | 'audio' | 'document' | 'video';
    filename?: string;
  };
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

## Inbound Processor (src/channels/inbound-processor.ts)

The main entry point for all inbound messages. Handles the full lifecycle:

```typescript
interface InboundProcessor {
  process(message: InboundMessage, projectId: string): Promise<void>;
}
```

### Processing Steps

1. **Contact Resolution:**
   - Look up contact by phone/telegramId/slackId + projectId
   - If not found → create new contact with available info
   - If found → update last seen timestamp

2. **Session Resolution:**
   - Look for an active session for this contact
   - If found → reuse it
   - If not found → create new session, assign agent

3. **Agent Resolution:**
   - Which agent should handle this message?
   - Based on project config, channel, contact role, previous session history
   - If the session already has an assigned agent → use that agent
   - If new session → use the project's default agent for this channel

4. **Mode Resolution:**
   - Determine which operating mode the agent should use
   - Based on channel + contact role (see Mode Resolution below)
   - Apply mode-specific prompt overrides and tool restrictions

5. **Execution:**
   - Call `prepareChatRun` (chat setup)
   - Run the agent loop
   - Send the response back via the channel adapter

6. **Error Handling:**
   - If the agent fails → send a fallback message via the channel
   - Log the error with full context

## Agent Operating Modes

Each agent has an `operatingMode` that defines its role:

```typescript
type AgentOperatingMode =
  | 'customer-facing'  // Responds to end customers via channels
  | 'internal'         // Background worker (scheduled tasks, data processing)
  | 'copilot'          // Assists the Fomo team via dashboard chat
  | 'manager';         // Orchestrates other agents via delegate-to-agent tool
```

## Agent Modes (Dual-Mode Support)

Beyond the operating mode, agents can have multiple **modes** that customize their behavior per channel:

```typescript
interface AgentMode {
  name: string;              // e.g., 'public', 'internal', 'owner'
  label?: string;            // UI label (e.g., 'Clientes', 'Dueño')
  promptOverrides?: {        // Override base prompts for this mode
    identity?: string;
    instructions?: string;
    safety?: string;
  };
  toolAllowlist?: string[];  // Override base tool list for this mode
  mcpServerNames?: string[]; // MCP servers active in this mode
  channelMapping: string[];  // Which channels trigger this mode
}
```

### Channel Mapping Syntax

The `channelMapping` array uses a flexible syntax:

- `"whatsapp"` — All WhatsApp messages trigger this mode
- `"telegram"` — All Telegram messages trigger this mode
- `"dashboard"` — Dashboard chat messages trigger this mode
- `"whatsapp:owner"` — WhatsApp messages from contacts with role="owner"
- `"telegram:admin"` — Telegram messages from contacts with role="admin"
- `"slack:C05ABCDEF"` — Messages from a specific Slack channel

### Mode Resolution (src/agents/mode-resolver.ts)

When a message arrives, the mode resolver determines which mode to use:

```typescript
function resolveMode(
  agent: AgentConfig,
  channel: string,
  contactRole?: string
): AgentMode | null {
  // 1. If no modes defined → return null (use base config)
  if (agent.modes.length === 0) return null;

  // 2. Try to find a mode that matches channel:role (most specific)
  for (const mode of agent.modes) {
    if (contactRole && mode.channelMapping.includes(`${channel}:${contactRole}`)) {
      return mode;
    }
  }

  // 3. Try to find a mode that matches just the channel
  for (const mode of agent.modes) {
    if (mode.channelMapping.includes(channel)) {
      return mode;
    }
  }

  // 4. No matching mode → return null (use base config)
  return null;
}
```

### Example: Customer Support Agent with Dual Mode

A customer support agent configured with two modes:

```json
{
  "name": "Support Agent",
  "operatingMode": "customer-facing",
  "modes": [
    {
      "name": "clients",
      "label": "Clientes",
      "channelMapping": ["whatsapp", "telegram"],
      "promptOverrides": {
        "instructions": "Respond to customer inquiries. Be helpful and friendly."
      }
    },
    {
      "name": "owner",
      "label": "Dueño",
      "channelMapping": ["whatsapp:owner", "dashboard"],
      "promptOverrides": {
        "instructions": "You are speaking with the business owner. Share internal metrics, stats, and data freely."
      },
      "toolAllowlist": ["query-sessions", "get-operations-summary", "send-email"]
    }
  ]
}
```

When a regular customer sends a WhatsApp message → "clients" mode activates (friendly, limited info).
When the owner sends a WhatsApp message → "owner" mode activates (full data access, more tools).

### Dashboard UI for Mode Configuration

The dashboard's agent creation page presents modes as "Canales" (Channels):

1. **Channel selection grid:** Visual cards for WhatsApp, Telegram, Slack, Dashboard Chat
2. **Dual audience toggle:** "¿Este agente habla con clientes y con vos?" — enables separate owner mode
3. **Per-channel customization:** Tabs for each selected channel with:
   - Audience selector (Todos / Solo el dueño / Solo admins)
   - Per-channel instruction overrides
   - Per-channel tool overrides

The UI generates the `modes[]` array from these visual selections — users never see the raw mode JSON.

## Proactive Messaging (src/channels/proactive.ts)

Agents can send messages proactively (not in response to a user message). This is used for:
- Follow-up messages after a conversation
- Scheduled campaign messages
- Notifications and alerts

```typescript
interface ProactiveMessenger {
  send(params: {
    projectId: string;
    channel: string;
    to: string;       // phone number, telegram ID, etc.
    message: string;
  }): Promise<void>;
}
```

Proactive messages are queued in BullMQ (not sent synchronously) to handle rate limits and retries.

## Webhook System (src/webhooks/)

### Channel Webhooks

Dynamic webhook routes for each channel + project:

```
POST /api/v1/webhooks/channels/whatsapp/:projectId    → WAHA/Meta webhook
POST /api/v1/webhooks/channels/telegram/:projectId    → Telegram Bot API webhook
POST /api/v1/webhooks/channels/slack/:projectId       → Slack Events API webhook
POST /api/v1/webhooks/channels/chatwoot/:projectId    → Chatwoot agent bot webhook
```

Each route:
1. Validates the webhook signature (HMAC for Slack, verify token for Meta)
2. Passes the raw payload to the channel adapter's `parseInbound()` method
3. Feeds the normalized `InboundMessage` to the `InboundProcessor`

### Custom Webhooks

Projects can create custom inbound webhooks for integrations beyond standard channels:

```typescript
Webhook {
  id, projectId, agentId,
  name: string,                 // Human-readable name
  triggerPrompt: string,        // Template: "New order received: {{payload.orderNumber}}"
  secretEnvVar?: string,        // For HMAC validation
  allowedIps: string[],         // IP allowlist
  status: 'active' | 'paused'
}
```

When a custom webhook fires:
1. Validate HMAC signature (if configured)
2. Check IP allowlist (if configured)
3. Interpolate payload data into the trigger prompt using Mustache-style `{{placeholder}}` syntax
4. Feed the interpolated prompt as a user message to the assigned agent

## Contact System (src/contacts/)

Contacts link sessions to real users across channels:

```typescript
Contact {
  id, projectId,
  name, displayName,
  phone?, email?, telegramId?, slackId?,
  role?: 'customer' | 'staff' | 'owner',
  tags: string[],                // e.g., ['vip', 'wholesale', 'prospect']
  timezone?, language: 'es',
  metadata?: object
}
```

### Contact Resolution

When a message arrives, the system identifies the contact by matching against:
- Phone number (for WhatsApp)
- Telegram ID (for Telegram)
- Slack ID (for Slack)
- Email (for email)

Each identifier is unique per project: `@@unique([projectId, phone])`, `@@unique([projectId, telegramId])`, etc.

### Contact Role

The `role` field is critical for mode resolution:
- `'owner'` → triggers owner-specific modes (full data access)
- `'staff'` → triggers staff modes (internal tools)
- `'customer'` or null → triggers customer-facing modes (limited access)

This is how the same agent can behave differently when the business owner sends a WhatsApp message vs. when a customer does.

## Handoff System (src/channels/handoff.ts)

When an agent calls the `escalate-to-human` tool:

1. The session status is set to `'escalated'`
2. An `ApprovalRequest` is created (type: escalation)
3. The Telegram HITL notifier sends a message to the Fomo team's Telegram group
4. The agent responds with a fallback message ("Un humano se va a comunicar con vos")
5. A human can take over the conversation via the dashboard or directly via the channel

## Channel Setup via Dashboard

The dashboard provides a wizard for setting up channels:

1. **Select provider** — WhatsApp WAHA, WhatsApp Cloud API, Telegram, Slack, Chatwoot
2. **Enter credentials** — Based on provider:
   - WAHA: Base URL of the WAHA container
   - Cloud API: Phone Number ID + Access Token
   - Telegram: Bot Token (from @BotFather)
   - Slack: Bot Token + Signing Secret
   - Chatwoot: Base URL + API Token
3. **Test connection** — Verify credentials work
4. **Assign to agents** — Which agents should use this channel

Credentials are encrypted via `SecretService` (AES-256-GCM) and stored in the `secrets` table. The channel integration stores only the secret key references.
