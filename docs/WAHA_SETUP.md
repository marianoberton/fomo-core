# WhatsApp WAHA Setup Guide

WAHA (WhatsApp HTTP API) is the primary WhatsApp integration for Nexus Core. It runs as a Docker container alongside the Nexus app — no separate installation needed.

> For Meta Cloud API (alternative for enterprise/high-volume), see [WHATSAPP_SETUP.md](WHATSAPP_SETUP.md).

---

## What Is WAHA?

WAHA is an open-source Docker image that wraps the WhatsApp Web protocol into a REST API. It allows sending and receiving WhatsApp messages using a standard phone number — by scanning a QR code, just like WhatsApp Web.

**Advantages over Meta Cloud API**:
- No Meta Business Account required
- Works with any existing WhatsApp number immediately
- No approval process
- No per-message fees (only your LLM costs)

**Limitations**:
- Requires the phone to remain linked (WhatsApp Web-style — logs out if phone disconnects for too long)
- Not officially supported by Meta — subject to WhatsApp ToS
- Better suited for single-number, SME-scale use cases

---

## Architecture

```
User → WhatsApp (phone)
           ↓ (WhatsApp Web protocol)
       WAHA container (port 3003 external / 3000 internal)
           ↓ (webhook POST)
       Nexus Core API (port 3002)
           ↓
       InboundProcessor → AgentRunner → Response
           ↓ (POST /api/sendText)
       WAHA → WhatsApp → User
```

---

## Docker Compose Setup

WAHA runs automatically when you do `docker compose up -d`. No extra configuration needed for basic use.

```yaml
# docker-compose.yml (relevant section)
waha:
  image: devlikeapro/waha
  container_name: nexus-waha
  restart: unless-stopped
  ports:
    - "3003:3000"   # Access WAHA directly at localhost:3003
  environment:
    WHATSAPP_DEFAULT_ENGINE: NOWEB   # Use NOWEB engine (no browser needed)
    WAHA_PRINT_QR: "True"            # Print QR to container logs
    WHATSAPP_RESTART_ALL_SESSIONS: "True"
    WAHA_API_KEY: ${WAHA_API_KEY:-nexus}  # Default API key: "nexus"
  volumes:
    - wahadata:/app/.sessions   # Persist session data across restarts
```

The Nexus app is configured to reach WAHA internally:

```yaml
app:
  environment:
    WAHA_DEFAULT_URL: http://waha:3000   # Internal Docker network
    WAHA_API_KEY: ${WAHA_API_KEY:-nexus}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WAHA_DEFAULT_URL` | `http://waha:3000` | Nexus → WAHA communication URL. Auto-set in Docker. Override only if WAHA runs externally. |
| `WAHA_API_KEY` | `nexus` | API key for WAHA authentication. Set the same value in both `app` and `waha` services. |
| `NEXUS_PUBLIC_URL` | (not set) | Your public domain (e.g. `https://nexus.example.com`). When set, webhooks are auto-configured during channel setup. |

---

## Connecting WhatsApp in the Dashboard

### Step 1: Open Integrations

Go to your project → **Integrations** → **Add Channel** → **WhatsApp (WAHA / QR Scan)**.

### Step 2: Session Name (Optional)

Enter a session name, or leave it as the default. The session name identifies this WhatsApp connection within WAHA.

### Step 3: Scan the QR Code

The dashboard fetches a QR code from WAHA and displays it. You have ~60 seconds to scan.

1. Open WhatsApp on your phone
2. Tap the menu (⋮) → **Linked Devices** → **Link a Device**
3. Point the camera at the QR code on the dashboard

### Step 4: Confirm

When the QR turns green ✅, the session is active. Click **Confirm** to save the channel integration.

Nexus Core automatically configures the WAHA webhook to point to the Nexus API. From this point, any message to the linked number goes through the agent.

---

## Webhook Auto-Configuration

If `NEXUS_PUBLIC_URL` is set, Nexus automatically registers the webhook with WAHA during step 4:

```
WAHA webhook URL = {NEXUS_PUBLIC_URL}/api/v1/channels/webhooks/{projectId}/waha
```

If `NEXUS_PUBLIC_URL` is **not** set, you need to manually configure the webhook in WAHA:

```bash
curl -X POST http://localhost:3003/api/sessions/{sessionName}/webhooks \
  -H "X-Api-Key: nexus" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://YOUR_SERVER:3002/api/v1/channels/webhooks/{projectId}/waha",
    "events": ["message"]
  }'
```

Replace `{sessionName}` and `{projectId}` with your values.

---

## Testing

### Check WAHA Health

```bash
# Is WAHA running?
curl http://localhost:3003/api/server/status \
  -H "X-Api-Key: nexus"

# Expected:
# { "status": "running" }
```

### Check Session Status

```bash
curl http://localhost:3003/api/sessions \
  -H "X-Api-Key: nexus"

# Look for your session with "status": "WORKING"
```

### Send a Test Message

```bash
curl -X POST http://localhost:3003/api/sendText \
  -H "X-Api-Key: nexus" \
  -H "Content-Type: application/json" \
  -d '{
    "session": "default",
    "chatId": "5491112345678@c.us",
    "text": "Hello from Nexus!"
  }'
```

Replace `5491112345678` with the destination phone number (country code + number, no `+`).

### Simulate Inbound Message

```bash
curl -X POST http://localhost:3002/api/v1/channels/webhooks/{projectId}/waha \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message",
    "session": "default",
    "payload": {
      "id": "test_msg_123",
      "timestamp": 1700000000,
      "from": "5491112345678@c.us",
      "fromMe": false,
      "to": "5499999999999@c.us",
      "body": "Hola, quiero información sobre sus productos",
      "_data": { "notifyName": "Test User" }
    }
  }'
```

---

## Troubleshooting

### QR Code Not Appearing

1. Check WAHA is running: `docker ps | grep nexus-waha`
2. Check WAHA logs: `docker logs nexus-waha`
3. Check Nexus can reach WAHA: `curl http://localhost:3003/api/server/status -H "X-Api-Key: nexus"`
4. If containers are not on the same Docker network, `WAHA_DEFAULT_URL` may need updating

### QR Code Expired

QR codes expire after ~60 seconds. Refresh the dashboard page to request a new one.

### Session Lost After Phone Restart

WhatsApp sessions persist in the `wahadata` Docker volume. If the session is lost:
1. Check session status: `curl http://localhost:3003/api/sessions -H "X-Api-Key: nexus"`
2. If status is not `WORKING`, go to dashboard → Integrations → WhatsApp → **Reconnect** to scan a new QR code
3. Enable `WHATSAPP_RESTART_ALL_SESSIONS: "True"` (default) to auto-reconnect on WAHA restart

### Agent Not Responding to Messages

1. Check webhook is configured: dashboard → Integrations → WhatsApp → inspect webhook URL
2. Check Nexus logs: `docker logs nexus-app | grep waha`
3. Simulate an inbound message (see above) and check the trace in the dashboard
4. Verify the agent is assigned to the WhatsApp channel in the agent's channel mapping

### "WAHA Unreachable" Error in Dashboard

- Make sure `docker compose up -d` is running
- Check `WAHA_DEFAULT_URL` in your `.env` — in Docker it should be `http://waha:3000`
- For external WAHA, verify the URL is accessible from the Nexus container

---

## WAHA Dashboard (Optional)

WAHA ships with its own web UI at `http://localhost:3003`. You can use it to:
- View active sessions
- See message logs
- Manually send messages for testing

Access requires the `WAHA_API_KEY` (default: `nexus`).

---

## References

- [WAHA Documentation](https://waha.devlike.pro/docs/)
- [WAHA GitHub](https://github.com/devlikeapro/waha)
- [WhatsApp Setup (Meta Cloud API)](WHATSAPP_SETUP.md)
