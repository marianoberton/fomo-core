# WhatsApp Integration Setup

Nexus Core supports two WhatsApp integration modes. Choose based on your use case.

| Mode | Best For | Requires |
|------|----------|----------|
| **WAHA (QR scan)** | SME clients, existing numbers, fast setup | Docker Compose (bundled) |
| **Meta Cloud API** | Enterprise, high volume, official support | Meta Business Account + approval |

---

## Option A: WhatsApp via WAHA (Recommended for most clients)

WAHA is bundled in Docker Compose and starts automatically with `docker compose up -d`.

**Setup**: Dashboard → Project → Integrations → Add Channel → WhatsApp (WAHA / QR Scan)

See the full guide: [WAHA_SETUP.md](WAHA_SETUP.md)

---

## Option B: WhatsApp via Meta Cloud API

Use this for enterprise deployments that need official Meta support, high message volumes, or WhatsApp template messages.

### Prerequisites

1. **Meta Business Account** — [business.facebook.com](https://business.facebook.com)
2. **WhatsApp Business App** — created in Meta for Developers
3. **Required credentials**:
   - Access Token (permanent token from Meta)
   - Phone Number ID (from WhatsApp Business settings)
   - Webhook Verify Token (a secret string you choose)

### Step 1: Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**
2. Choose **Business** app type
3. Add the **WhatsApp** product to your app
4. Go to **WhatsApp** → **Getting Started** and note your:
   - **Phone Number ID**
   - **Access Token** (generate a permanent one via System Users)

### Step 2: Add the Channel in the Dashboard

1. Dashboard → Project → **Integrations** → **Add Channel** → **WhatsApp (Meta Cloud API)**
2. Enter:
   - **Access Token** — permanent token from Meta
   - **Phone Number ID** — from WhatsApp Business settings
   - **Webhook Verify Token** — any secret string you choose (e.g. `nexus_verify_abc123`)
3. Click **Connect**
4. The dashboard shows you a webhook URL:
   ```
   https://your-domain.com/api/v1/channels/webhooks/{projectId}/whatsapp
   ```

### Step 3: Configure Webhook in Meta

1. Go to your WhatsApp App → **WhatsApp** → **Configuration**
2. Click **Edit** next to Webhook
3. Enter:
   - **Callback URL**: the webhook URL from Step 2
   - **Verify Token**: the same token you entered in Step 2
4. Click **Verify and Save** — Meta will call your URL to verify it

### Step 4: Subscribe to Webhook Fields

In Meta's webhook settings, subscribe to:
- ✅ `messages` — required (receive incoming messages)
- ⚠️ `message_status` — optional (delivery receipts)

---

## Testing (Meta Cloud API)

### Test Webhook Verification (GET)

```bash
curl "https://your-domain.com/api/v1/channels/webhooks/{projectId}/whatsapp?\
hub.mode=subscribe&hub.verify_token=nexus_verify_abc123&hub.challenge=test123"

# Expected: test123
```

### Test Incoming Message (POST)

```bash
curl -X POST https://your-domain.com/api/v1/channels/webhooks/{projectId}/whatsapp \
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
          "contacts": [{"profile": {"name": "Test User"}, "wa_id": "5491112345678"}],
          "messages": [{
            "from": "5491112345678",
            "id": "msg_123",
            "timestamp": "1700000000",
            "type": "text",
            "text": {"body": "Hola, ¿tienen stock de tornillos 6x50?"}
          }]
        },
        "field": "messages"
      }]
    }]
  }'

# Expected: { "ok": true }
```

---

## Message Support

### Receive (Inbound)

| Type | WAHA | Meta Cloud API |
|------|------|----------------|
| Text | ✅ | ✅ |
| Image | ✅ (caption as text) | ✅ |
| Audio | ⚠️ Not transcribed | ⚠️ Not transcribed |
| Video | ⚠️ Not processed | ⚠️ Not processed |
| Document | ⚠️ Not processed | ⚠️ Not processed |

### Send (Outbound)

| Type | WAHA | Meta Cloud API |
|------|------|----------------|
| Text | ✅ | ✅ |
| Image | ⚠️ Not implemented | ⚠️ Not implemented |
| Template | ⚠️ N/A | ⚠️ Not implemented |

---

## Architecture

### WAHA flow
```
User → WhatsApp (phone)
    → WAHA container (WhatsApp Web protocol)
    → POST /api/v1/channels/webhooks/{projectId}/waha
    → InboundProcessor → AgentRunner
    → WAHA → User
```

### Meta Cloud API flow
```
User → WhatsApp → Meta servers
    → POST /api/v1/channels/webhooks/{projectId}/whatsapp
    → InboundProcessor → AgentRunner
    → Meta Graph API (/{phoneNumberId}/messages) → User
```

---

## Troubleshooting

### WAHA Issues

See [WAHA_SETUP.md — Troubleshooting](WAHA_SETUP.md#troubleshooting).

### Meta API: Webhook Verification Fails

- Ensure your `NEXUS_PUBLIC_URL` is publicly accessible (not localhost)
- The verify token entered in the dashboard must exactly match what Meta sends
- Check server logs: `docker logs nexus-app | grep whatsapp`

### Meta API: Messages Not Delivered

- Verify phone number is associated with a WhatsApp Business account in Meta
- Check that the access token has not expired (use a permanent System User token)
- Test sending via Meta's testing tool in the developer dashboard

### Agent Not Responding

1. Dashboard → Integrations — verify channel status is "Connected"
2. Dashboard → Traces — check if a trace was created for the message
3. If no trace: webhook is not reaching Nexus (check URL and network)
4. If trace exists but no response: check agent is assigned to the WhatsApp channel

---

## References

- [WAHA_SETUP.md](WAHA_SETUP.md) — Detailed WAHA guide
- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Meta Webhook Reference](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks)
