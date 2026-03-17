FROM node:22-alpine

# Instalar OpenClaw CLI globalmente
RUN npm install -g openclaw

# Variables de entorno del cliente (se inyectan al crear el container)
ENV OPENCLAW_CLIENT_ID=''
ENV OPENCLAW_GATEWAY_PORT=''
ENV TELEGRAM_BOT_TOKEN=''
ENV WAHA_URL=''
ENV WAHA_API_KEY=''
ENV ANTHROPIC_API_KEY=''
ENV OPENROUTER_API_KEY=''

WORKDIR /workspace

# Copiar templates base (se sobreescriben con los del cliente)
COPY templates/base/ /workspace/

COPY templates/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY templates/docker/healthcheck.js /healthcheck.js

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node /healthcheck.js

EXPOSE 18789

ENTRYPOINT ["/entrypoint.sh"]
