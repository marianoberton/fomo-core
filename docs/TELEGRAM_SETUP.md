# Telegram Integration Setup

Nexus Core integrates with Telegram via the Telegram Bot API. Setup takes under 5 minutes.

---

## Overview

```
User → Telegram message
           ↓ (Bot API webhook)
       Nexus Core API → InboundProcessor → AgentRunner → Response
           ↓ (sendMessage API call)
       Telegram → User
```

**What's supported**:
- ✅ Text messages (receive & send)
- ✅ Markdown formatting in outbound messages
- ✅ Reply-to-message threading
- ✅ Group chats (bot must be added to the group)
- ✅ Direct messages
- ✅ Photo attachments (received, caption used as text)
- ✅ Document attachments (received, filename noted)
- ⚠️ Voice messages — not yet transcribed
- ⚠️ Outbound media — not yet implemented

---

## Step 1: Create a Telegram Bot

1. Open Telegram → search for `@BotFather`
2. Send `/newbot`
3. Enter a display name (e.g. "Nexus Agent")
4. Enter a username ending in `bot` (e.g. `nexus_ferreteria_bot`)
5. BotFather sends you a **bot token**: `123456789:AAF...`
6. Save this token — you'll need it in the next step

**Optional but recommended**: use `/setprivacy` to disable privacy mode so the bot can read group messages:
```
/setprivacy → disable
```

---

## Step 2: Add the Channel in the Dashboard

1. Go to your project → **Integrations** → **Add Channel** → **Telegram**
2. Paste the bot token from BotFather
3. Click **Connect**

If `NEXUS_PUBLIC_URL` is configured, the webhook is registered automatically. If not, see Step 3 below.

The channel appears as connected ✅ in the Integrations page.

---

## Step 3: Configure Webhook (if not auto-configured)

If `NEXUS_PUBLIC_URL` is **not** set, you need to manually register the webhook:

First, get your webhook URL from the dashboard (shown after connecting). It looks like:
```
https://your-domain.com/api/v1/channels/webhooks/{projectId}/telegram
```

Then register it with Telegram:
```bash
curl "https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url={WEBHOOK_URL}"

# Expected:
# { "ok": true, "result": true, "description": "Webhook was set" }
```

### Verify Webhook

```bash
curl "https://api.telegram.org/bot{BOT_TOKEN}/getWebhookInfo"

# Look for:
# { "url": "https://your-domain.com/...", "pending_update_count": 0, "max_connections": 40 }
```

---

## Testing

### Verify Bot is Alive

```bash
curl "https://api.telegram.org/bot{BOT_TOKEN}/getMe"

# Expected:
# { "ok": true, "result": { "id": 123456789, "username": "nexus_ferreteria_bot", ... } }
```

### Send a Test Message to Bot

Open Telegram → find your bot by username → send a message. You should see:
1. A webhook POST hit your Nexus server
2. The agent processes the message
3. The agent responds in the same chat

### Simulate Inbound Message

```bash
curl -X POST http://localhost:3002/api/v1/channels/webhooks/{projectId}/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "message_id": 1,
      "date": 1700000000,
      "text": "Hola, tengo una consulta",
      "chat": {
        "id": 123456789,
        "type": "private",
        "first_name": "Test",
        "last_name": "User"
      },
      "from": {
        "id": 123456789,
        "first_name": "Test",
        "last_name": "User",
        "username": "testuser"
      }
    }
  }'
```

---

## Environment Configuration

Telegram credentials are stored **per project** in the database via SecretService — no `.env` entries needed. The dashboard wizard handles credential storage.

The only global env var that affects Telegram setup is:

```env
# Auto-configures webhook during channel setup
NEXUS_PUBLIC_URL=https://your-domain.com
```

---

## Adding Bot to a Group

To handle messages in a Telegram group:

1. Add the bot to the group (search by bot username)
2. Send a message mentioning the bot: `@nexus_ferreteria_bot hola`
3. The bot receives the message if privacy mode is disabled (see Step 1)

Note: in groups, all messages are received — including those not mentioning the bot (if privacy mode is disabled). Add filtering logic to the agent's Instructions prompt if needed.

---

## Message Flow

### Receiving

1. User sends message to bot
2. Telegram delivers it to Nexus webhook: `POST /api/v1/channels/webhooks/{projectId}/telegram`
3. `TelegramAdapter.parseInbound()` extracts content, sender ID, and chat ID
4. `InboundProcessor` finds/creates the Contact by Telegram user ID
5. `AgentRunner` processes the message
6. Response sent via `TelegramAdapter.send()`

### Sending (Outbound/Proactive)

Agents can send messages proactively via the `send-channel-message` tool:

```
Tool: send-channel-message
Input: {
  "channel": "telegram",
  "recipientIdentifier": "123456789",  // Telegram chat ID or user ID
  "content": "¡Buenos días! Recordatorio de su cita de mañana."
}
```

---

## Troubleshooting

### Bot Not Responding

1. Verify webhook is set: `curl "https://api.telegram.org/bot{TOKEN}/getWebhookInfo"`
2. Check Nexus logs: `docker logs nexus-app | grep telegram`
3. Check the integration is connected: dashboard → Integrations → Telegram card
4. Check agent is mapped to the Telegram channel

### Webhook Returns 404

- The `projectId` in the webhook URL must match an actual project ID in the database
- Verify with: `curl http://localhost:3002/api/v1/projects`

### Messages Duplicated

Telegram retries webhook delivery if your server doesn't respond within 60 seconds. Nexus Core handles this automatically — the webhook returns `200 OK` immediately and processes the message asynchronously.

### Bot Can't Read Group Messages

Enable privacy mode off via BotFather:
```
/setprivacy → Select your bot → Disable
```
Then restart the bot session.

---

## References

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Webhook Guide](https://core.telegram.org/bots/webhooks)
- [BotFather](https://t.me/BotFather)
