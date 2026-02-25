# Quickstart — From Zero to Running Agent

Get a full Nexus Core stack running and a WhatsApp-connected agent responding to messages in under 10 minutes.

---

## Prerequisites

- Docker + Docker Compose installed
- An OpenAI or Anthropic API key
- A phone with WhatsApp installed (for the QR scan)
- `git` and `pnpm` installed (for seeding the database)

---

## Step 1: Clone the Repository

```bash
git clone --recurse-submodules https://github.com/your-org/fomo-core.git
cd fomo-core
```

The `--recurse-submodules` flag clones the dashboard too.

---

## Step 2: Configure Environment

Copy the example env file:

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```env
# LLM provider (at least one required)
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...  # Optional

# Public URL for webhook auto-configuration (optional but recommended)
# NEXUS_PUBLIC_URL=https://your-domain.com

# Everything else has working defaults for local development
```

The database, Redis, and WAHA all use auto-configured defaults in Docker Compose.

---

## Step 3: Start the Stack

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port 5433
- **Redis** on port 6380
- **Nexus Core API** on port 3002
- **WAHA** (WhatsApp gateway) on port 3003

Wait ~15 seconds for services to become healthy. Check status:

```bash
docker compose ps
```

All four services should show `healthy` or `running`.

---

## Step 4: Seed Demo Data

```bash
pnpm install
pnpm db:seed
```

This creates 5 demo projects with pre-configured agents. You can skip this and create projects manually, but seeding is faster for getting started.

---

## Step 5: Start the Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Step 6: Create a Project and Agent (or use demo data)

If you ran `db:seed`, you already have demo projects. Pick "Demo" from the projects list.

**Or create from scratch:**

1. Dashboard → **Projects** → **New Project**
2. Name it anything (e.g. "Test Project")
3. Go to the project → **Agents** → **New Agent**
4. Enter:
   - Name: `demo`
   - Mode: `customer-facing`
   - Provider: `openai`, Model: `gpt-4o-mini`
   - Tool allowlist: at minimum, `date-time` and `knowledge-search`
5. Go to **Prompts** → edit the **Identity** layer:
   ```
   You are a helpful assistant. Answer questions clearly and concisely.
   ```
6. Save and activate

---

## Step 7: Connect WhatsApp

1. Dashboard → your project → **Integrations** → **Add Channel** → **WhatsApp (WAHA / QR Scan)**
2. Leave session name as default
3. The dashboard shows a QR code
4. On your phone: WhatsApp → **Linked Devices** → **Link a Device** → scan the QR
5. QR turns green ✅ — click **Confirm**

The agent is now connected to your WhatsApp number.

---

## Step 8: Test It

### Option A: Test Chat (recommended first)

Dashboard → your project → **Agents** → your agent → **Test Chat**

Type a message. The agent responds. You can see tool calls and token usage in real time.

### Option B: Send a WhatsApp Message

Send a message to the linked WhatsApp number from another phone. The agent should respond within a few seconds.

### Option C: Check the Inbox

Dashboard → **Inbox** — you'll see the conversation appear in real time.

---

## What to Try Next

1. **Check costs**: Dashboard → **Costs** — see how much each interaction cost
2. **Read a trace**: Dashboard → **Traces** → click any trace to see the full execution timeline
3. **Edit the Instructions prompt**: give the agent specific business rules and see how behavior changes
4. **Add a tool**: edit the agent → add `web-search` to the allowlist → tell the agent in Instructions that it can search the web
5. **Connect Telegram**: Dashboard → Integrations → Add Channel → Telegram (see [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md))
6. **Add knowledge**: Dashboard → Knowledge → add a few entries → ask the agent a question it should know

---

## Useful Commands

```bash
# Check API health
curl http://localhost:3002/health

# Check WAHA status
curl http://localhost:3003/api/server/status -H "X-Api-Key: nexus"

# View Nexus logs
docker logs nexus-app -f

# View WAHA logs (shows QR code in text)
docker logs nexus-waha -f

# Restart everything
docker compose restart

# Stop everything
docker compose down

# Stop and delete all data (destructive!)
docker compose down -v
```

---

## Troubleshooting

### Dashboard Can't Connect to API

- Check API is running: `curl http://localhost:3002/health`
- Check dashboard `.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:3002`
- Windows: use `HOST=::` in `.env` (not `0.0.0.0`) — the API should already handle this

### No QR Code on Dashboard

- Check WAHA is running: `docker ps | grep nexus-waha`
- Check WAHA logs: `docker logs nexus-waha`
- Check API can reach WAHA: `curl http://localhost:3002/health` and check `waha` in the response

### Agent Not Responding on WhatsApp

1. Dashboard → Integrations → WhatsApp → verify status is "Connected"
2. Dashboard → Traces → check if a trace was created for your message
3. If no trace: the webhook is not reaching Nexus. Check WAHA webhook configuration.
4. If trace exists but response missing: check agent configuration (model, tool allowlist, prompt layers)

### "Insufficient budget" Error

The project or agent daily budget is exhausted. Dashboard → Costs → view current spend. Increase the budget in agent settings or wait until midnight (UTC) for the reset.

---

## Next Steps

- [DASHBOARD.md](DASHBOARD.md) — full dashboard guide
- [WAHA_SETUP.md](WAHA_SETUP.md) — detailed WAHA documentation
- [TELEGRAM_SETUP.md](TELEGRAM_SETUP.md) — connect Telegram
- [DEPLOYMENT.md](../DEPLOYMENT.md) — deploy to a VPS
- [PLATFORM-OVERVIEW.md](PLATFORM-OVERVIEW.md) — full platform capabilities reference
