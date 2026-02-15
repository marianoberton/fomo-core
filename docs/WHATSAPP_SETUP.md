# WhatsApp Integration Setup

## Overview

Nexus Core integrates with WhatsApp Cloud API to receive and send messages. The integration supports:

- ✅ Text messages (receive & send)
- ✅ Image messages (receive)
- ⚠️ Other media types (not yet implemented)

## Architecture

```
WhatsApp Cloud API
    ↓
Webhook (POST /api/v1/webhooks/whatsapp)
    ↓
WhatsAppAdapter.parseInbound()
    ↓
InboundProcessor.process()
    ├─ Create/find Contact
    ├─ Create/find Session
    ├─ runAgent() → Execute agent loop
    └─ Send response via WhatsAppAdapter.send()
```

## Prerequisites

1. **WhatsApp Business Account**
   - Sign up at https://business.facebook.com/
   - Create a WhatsApp Business App in Meta for Developers

2. **Required Credentials**
   - `WHATSAPP_ACCESS_TOKEN` - Permanent access token from Meta
   - `WHATSAPP_PHONE_NUMBER_ID` - Phone number ID from WhatsApp Business
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN` - Custom token for webhook verification (you choose this)

3. **OpenAI API Key** (for agent processing)
   - `OPENAI_API_KEY` - Used as the LLM provider

## Environment Configuration

Add to `.env`:

```bash
# WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_custom_verify_token_here

# OpenAI (used by agent)
OPENAI_API_KEY=sk-...

# Default project for inbound messages
DEFAULT_PROJECT_ID=default
```

## Webhook Setup

### 1. Get Your Webhook URL

Your webhook endpoint will be:
```
https://your-domain.com/api/v1/webhooks/whatsapp
```

### 2. Configure in Meta for Developers

1. Go to your WhatsApp Business App
2. Navigate to **WhatsApp** → **Configuration**
3. Click **Edit** next to Webhook
4. Enter:
   - **Callback URL**: `https://your-domain.com/api/v1/webhooks/whatsapp`
   - **Verify Token**: Same value as `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in .env
5. Click **Verify and Save**

### 3. Subscribe to Webhook Fields

Subscribe to:
- ✅ `messages` - Required for receiving messages
- ⚠️ `message_status` - Optional, for delivery status

## Testing

### Unit Tests

```bash
# Test WhatsApp adapter
pnpm test src/channels/adapters/whatsapp.test.ts

# Test end-to-end flow
pnpm test src/channels/whatsapp-e2e.test.ts
```

### Manual Testing with cURL

#### Test Webhook Verification (GET)

```bash
curl "http://localhost:3000/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=your_custom_verify_token_here&hub.challenge=test_challenge"

# Expected: "test_challenge"
```

#### Test Incoming Text Message (POST)

```bash
curl -X POST http://localhost:3000/api/v1/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "entry-id",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "+1234567890",
            "phone_number_id": "test-phone-id"
          },
          "contacts": [{
            "profile": { "name": "Test User" },
            "wa_id": "5491132766709"
          }],
          "messages": [{
            "from": "5491132766709",
            "id": "msg_123",
            "timestamp": "1633036800",
            "type": "text",
            "text": { "body": "Hello, agent!" }
          }]
        },
        "field": "messages"
      }]
    }]
  }'

# Expected: { "ok": true }
```

#### Test Incoming Image Message (POST)

```bash
curl -X POST http://localhost:3000/api/v1/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "entry-id",
      "changes": [{
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {
            "display_phone_number": "+1234567890",
            "phone_number_id": "test-phone-id"
          },
          "contacts": [{
            "profile": { "name": "Image Sender" },
            "wa_id": "5491132766710"
          }],
          "messages": [{
            "from": "5491132766710",
            "id": "msg_456",
            "timestamp": "1633036900",
            "type": "image",
            "image": {
              "id": "media_abc123",
              "mime_type": "image/jpeg",
              "caption": "What is this?"
            }
          }]
        },
        "field": "messages"
      }]
    }]
  }'

# Expected: { "ok": true }
```

### Check Health

```bash
curl http://localhost:3000/api/v1/webhooks/health

# Expected:
# {
#   "channels": ["whatsapp"],
#   "health": { "whatsapp": true },
#   "timestamp": "..."
# }
```

## Message Flow

### Receiving Messages

1. **WhatsApp sends webhook** → POST /api/v1/webhooks/whatsapp
2. **Parse payload** → `WhatsAppAdapter.parseInbound()`
3. **Process message**:
   - Find or create Contact by phone number
   - Find or create Session for the Contact
   - Run agent with message content
   - Get agent response
4. **Send response** → `WhatsAppAdapter.send()`

### Sending Messages

Messages are sent via the channel router:

```typescript
await channelRouter.send({
  channel: 'whatsapp',
  recipientIdentifier: '5491132766709', // Phone number
  content: 'Hello from Nexus!',
  replyToChannelMessageId: 'msg_123', // Optional
});
```

## Supported Message Types

### Receive (Inbound)

| Type | Status | Notes |
|------|--------|-------|
| Text | ✅ | Fully supported |
| Image | ✅ | Stores media ID, caption as content |
| Audio | ⚠️ | Not yet implemented |
| Video | ⚠️ | Not yet implemented |
| Document | ⚠️ | Not yet implemented |
| Sticker | ⚠️ | Not yet implemented |
| Location | ⚠️ | Not yet implemented |

### Send (Outbound)

| Type | Status | Notes |
|------|--------|-------|
| Text | ✅ | Fully supported |
| Image | ⚠️ | Not yet implemented |
| Template | ⚠️ | Not yet implemented |

## Troubleshooting

### Webhook Not Receiving Messages

1. **Check webhook is registered**:
   ```bash
   curl http://localhost:3000/api/v1/webhooks/health
   ```

2. **Verify environment variables**:
   ```bash
   echo $WHATSAPP_ACCESS_TOKEN
   echo $WHATSAPP_PHONE_NUMBER_ID
   ```

3. **Check logs**:
   ```bash
   pnpm dev | grep whatsapp
   ```

### Messages Not Being Processed

1. **Check if contact was created**:
   - Look for log: `Created new contact`
   
2. **Check if session was created**:
   - Look for log: `Created new session`

3. **Check agent execution**:
   - Look for log: `runAgent completed`

### Agent Not Responding

1. **Verify OpenAI API key**:
   ```bash
   echo $OPENAI_API_KEY
   ```

2. **Check agent configuration**:
   - Ensure DEFAULT_PROJECT_ID exists in database
   - Check project has a valid provider config

## Next Steps

- [ ] Implement image download and vision API integration
- [ ] Support for audio messages (transcription via Whisper)
- [ ] Support for video messages
- [ ] Support for document messages
- [ ] Template message support for notifications
- [ ] Media upload for outbound images
- [ ] Message status tracking (delivered, read)
- [ ] Rate limiting per contact

## References

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [WhatsApp Webhook Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
- [Message Types Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
