#!/bin/sh
set -e

echo "[entrypoint] Starting OpenClaw client container..."
echo "[entrypoint] CLIENT_ID=${OPENCLAW_CLIENT_ID}"

# --- 1. Render SOUL.md and USER.md from templates ---
if [ -f /workspace/SOUL.md.template ]; then
  envsubst < /workspace/SOUL.md.template > /workspace/SOUL.md
  echo "[entrypoint] SOUL.md rendered"
fi

if [ -f /workspace/USER.md.template ]; then
  envsubst < /workspace/USER.md.template > /workspace/USER.md
  echo "[entrypoint] USER.md rendered"
fi

# --- 2. Build openclaw.json with client config ---
# Determine which channels are active based on env vars
CHANNELS_JSON="[]"
HAS_TELEGRAM=""
HAS_WHATSAPP=""

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  HAS_TELEGRAM="true"
fi

if [ -n "$WAHA_URL" ] && [ -n "$WAHA_API_KEY" ]; then
  HAS_WHATSAPP="true"
fi

# Build channels array
if [ "$HAS_TELEGRAM" = "true" ] && [ "$HAS_WHATSAPP" = "true" ]; then
  CHANNELS_JSON='[{"type":"telegram","token":"'"$TELEGRAM_BOT_TOKEN"'"},{"type":"whatsapp","wahaUrl":"'"$WAHA_URL"'","wahaApiKey":"'"$WAHA_API_KEY"'"}]'
elif [ "$HAS_TELEGRAM" = "true" ]; then
  CHANNELS_JSON='[{"type":"telegram","token":"'"$TELEGRAM_BOT_TOKEN"'"}]'
elif [ "$HAS_WHATSAPP" = "true" ]; then
  CHANNELS_JSON='[{"type":"whatsapp","wahaUrl":"'"$WAHA_URL"'","wahaApiKey":"'"$WAHA_API_KEY"'"}]'
fi

# Determine LLM provider
LLM_PROVIDER="{}"
if [ -n "$ANTHROPIC_API_KEY" ]; then
  LLM_PROVIDER='{"provider":"anthropic","apiKey":"'"$ANTHROPIC_API_KEY"'"}'
elif [ -n "$OPENROUTER_API_KEY" ]; then
  LLM_PROVIDER='{"provider":"openrouter","apiKey":"'"$OPENROUTER_API_KEY"'"}'
fi

GATEWAY_PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

cat > /workspace/openclaw.json <<EOF
{
  "clientId": "${OPENCLAW_CLIENT_ID}",
  "gateway": {
    "port": ${GATEWAY_PORT},
    "host": "0.0.0.0"
  },
  "channels": ${CHANNELS_JSON},
  "llm": ${LLM_PROVIDER},
  "soul": "/workspace/SOUL.md",
  "user": "/workspace/USER.md"
}
EOF

echo "[entrypoint] openclaw.json created"
echo "[entrypoint] Channels: telegram=${HAS_TELEGRAM:-false} whatsapp=${HAS_WHATSAPP:-false}"

# --- 3. Start openclaw gateway ---
echo "[entrypoint] Starting openclaw gateway on port ${GATEWAY_PORT}..."
exec openclaw gateway --config /workspace/openclaw.json --port "${GATEWAY_PORT}"
