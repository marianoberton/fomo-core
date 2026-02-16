# Slack Integration Setup

## Overview

Nexus Core integrates with the Slack Web API to receive and send messages. The integration supports:

- ✅ Text messages (receive & send)
- ✅ Thread replies
- ✅ Markdown formatting (mrkdwn)
- ✅ URL verification challenge
- ⚠️ Slash commands (not yet implemented)
- ⚠️ Interactive components (not yet implemented)

## Architecture

```
Slack Events API
    ↓
Webhook (POST /api/v1/webhooks/slack)
    ↓
SlackAdapter.parseInbound()
    ↓
InboundProcessor.process()
    ├─ Create/find Contact
    ├─ Create/find Session
    ├─ runAgent() → Execute agent loop
    └─ Send response via SlackAdapter.send()
```

## Prerequisites

1. **Slack Workspace**
   - Admin access to create apps

2. **Slack App** (created in https://api.slack.com/apps)
   - Bot Token Scopes configured
   - Event Subscriptions enabled

3. **Required Credentials**
   - `SLACK_BOT_TOKEN` - Bot user OAuth token (`xoxb-...`)
   - `SLACK_SIGNING_SECRET` - Signing secret for webhook verification (optional, recommended)

## Step-by-Step Setup

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Enter app name (e.g., "Nexus Agent") and select your workspace
4. Click **Create App**

### 2. Configure Bot Token Scopes

Navigate to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**:

| Scope | Purpose |
|-------|---------|
| `chat:write` | Send messages |
| `channels:history` | Read messages in public channels |
| `groups:history` | Read messages in private channels |
| `im:history` | Read direct messages |
| `mpim:history` | Read group direct messages |
| `users:read` | Resolve user names |

### 3. Install App to Workspace

1. Navigate to **OAuth & Permissions**
2. Click **Install to Workspace**
3. Review permissions and click **Allow**
4. Copy the **Bot User OAuth Token** (`xoxb-...`)

### 4. Configure Event Subscriptions

1. Navigate to **Event Subscriptions**
2. Toggle **Enable Events** → **On**
3. Enter your **Request URL**:
   ```
   https://your-domain.com/api/v1/webhooks/slack
   ```
   Slack will send a `url_verification` challenge — Nexus Core handles this automatically.

4. Under **Subscribe to bot events**, add:
   - `message.channels` — Messages in public channels
   - `message.groups` — Messages in private channels
   - `message.im` — Direct messages
   - `message.mpim` — Group direct messages

5. Click **Save Changes**

### 5. Invite Bot to Channels

In Slack, invite the bot to channels where it should respond:
```
/invite @NexusAgent
```

## Environment Configuration

Add to `.env`:

```bash
# Slack Bot Token (from OAuth & Permissions page)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here

# Slack Signing Secret (from Basic Information page — optional but recommended)
SLACK_SIGNING_SECRET=your-signing-secret-here
```

## Agent Configuration

In your project config or `prisma/seed.ts`:

```typescript
{
  channels: [
    {
      type: 'slack',
      enabled: true,
      botTokenEnvVar: 'SLACK_BOT_TOKEN',
      webhookSecretEnvVar: 'SLACK_SIGNING_SECRET',
    },
  ],
}
```

## Testing

### Unit Tests

```bash
# Test Slack adapter
pnpm test src/channels/adapters/slack.test.ts
```

### Manual Testing with cURL

#### Test URL Verification (POST)

Slack sends this when you configure event subscriptions:

```bash
curl -X POST http://localhost:3002/api/v1/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url_verification",
    "challenge": "test_challenge_token_123"
  }'

# Expected: "test_challenge_token_123"
```

#### Test Incoming Message (POST)

```bash
curl -X POST http://localhost:3002/api/v1/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "event_callback",
    "team_id": "T12345",
    "api_app_id": "A12345",
    "event": {
      "type": "message",
      "channel": "C12345",
      "user": "U67890",
      "text": "Hello, agent!",
      "ts": "1234567890.123456",
      "event_ts": "1234567890.123456"
    },
    "event_id": "Ev12345",
    "event_time": 1234567890
  }'

# Expected: { "ok": true }
```

#### Test Thread Reply (POST)

```bash
curl -X POST http://localhost:3002/api/v1/webhooks/slack \
  -H "Content-Type: application/json" \
  -d '{
    "type": "event_callback",
    "team_id": "T12345",
    "event": {
      "type": "message",
      "channel": "C12345",
      "user": "U67890",
      "text": "This is a thread reply",
      "ts": "1234567890.999999",
      "thread_ts": "1234567890.000001",
      "event_ts": "1234567890.999999"
    }
  }'

# Expected: { "ok": true }
```

### Check Health

```bash
curl http://localhost:3002/api/v1/webhooks/health

# Expected:
# {
#   "channels": ["slack"],
#   "health": { "slack": true },
#   "timestamp": "..."
# }
```

## Message Flow

### Receiving Messages

1. **Slack sends event** → POST /api/v1/webhooks/slack
2. **Parse payload** → `SlackAdapter.parseInbound()`
3. **Process message**:
   - Find or create Contact by Slack user ID
   - Find or create Session for the Contact
   - Run agent with message content
   - Get agent response
4. **Send response** → `SlackAdapter.send()`

### Sending Messages

Messages are sent via the channel router:

```typescript
await channelRouter.send({
  channel: 'slack',
  recipientIdentifier: 'C12345', // Channel ID
  content: 'Hello from Nexus!',
  replyToChannelMessageId: '1234567890.000001', // Optional: reply in thread
  options: { parseMode: 'markdown' }, // Optional: enable mrkdwn
});
```

## Supported Features

### Receive (Inbound)

| Feature | Status | Notes |
|---------|--------|-------|
| Text messages | ✅ | Public/private channels, DMs |
| Thread messages | ✅ | `thread_ts` preserved |
| Bot message filtering | ✅ | Skips messages without user field |
| URL verification | ✅ | Automatic challenge response |
| Slash commands | ⚠️ | Not yet implemented |
| Interactive messages | ⚠️ | Buttons, menus — not yet |
| File uploads | ⚠️ | Not yet implemented |

### Send (Outbound)

| Feature | Status | Notes |
|---------|--------|-------|
| Text messages | ✅ | To any channel/DM |
| Thread replies | ✅ | Via `thread_ts` |
| Markdown (mrkdwn) | ✅ | Slack's own markdown format |
| File uploads | ⚠️ | Not yet implemented |
| Block Kit messages | ⚠️ | Rich UI — not yet implemented |

## Troubleshooting

### Bot Not Responding

1. **Check bot is in the channel**:
   - Use `/invite @YourBotName` in the channel

2. **Verify bot token**:
   ```bash
   curl -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     https://slack.com/api/auth.test
   ```
   Expected: `{ "ok": true, "user": "...", "team": "..." }`

3. **Check event subscriptions**:
   - Go to Slack App → Event Subscriptions
   - Verify Request URL shows a green checkmark
   - Verify `message.*` events are subscribed

### Webhook Verification Failing

1. **Check server is accessible**:
   ```bash
   curl https://your-domain.com/api/v1/webhooks/slack
   ```

2. **Check logs for challenge**:
   ```bash
   pnpm dev | grep slack
   ```

3. **Verify URL is HTTPS** — Slack requires HTTPS for event subscriptions

### Messages Not Being Sent

1. **Check bot token scopes**:
   - Ensure `chat:write` scope is added
   - Reinstall app after adding new scopes

2. **Check channel ID format**:
   - Public channels: `C...`
   - Private channels: `G...`
   - Direct messages: `D...`
   - Multi-party DMs: `G...`

3. **Check API response**:
   ```bash
   curl -X POST https://slack.com/api/chat.postMessage \
     -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"channel":"C12345","text":"Test"}'
   ```

### Duplicate Messages

- Slack may retry events if your server doesn't respond within 3 seconds
- Use `event_id` for deduplication
- Consider using the WebhookQueue for async processing

## Security

### Signing Secret Verification (Recommended)

Slack signs every request with your app's signing secret. To verify:

1. Copy **Signing Secret** from **Basic Information** page
2. Set `SLACK_SIGNING_SECRET` in `.env`
3. The webhook route should verify the `x-slack-signature` header

### Bot Token Security

- Never commit `xoxb-` tokens to source control
- Use environment variables only
- Rotate tokens periodically via **OAuth & Permissions** → **Reinstall App**

## References

- [Slack API Documentation](https://api.slack.com/docs)
- [Slack Events API](https://api.slack.com/events-api)
- [Slack Web API — chat.postMessage](https://api.slack.com/methods/chat.postMessage)
- [Slack Bot Token Scopes](https://api.slack.com/scopes)
- [Slack Request Verification](https://api.slack.com/authentication/verifying-requests-from-slack)
