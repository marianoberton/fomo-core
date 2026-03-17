FROM node:22-slim

LABEL maintainer="fomo-devops"
LABEL com.fomo.component="openclaw-client"

WORKDIR /app

# Install openclaw CLI
RUN npm install -g @openclaw/cli@latest

# Create data and config directories
RUN mkdir -p /app/config /app/data /app/templates

# Copy configuration templates
COPY config/ /app/config/
COPY SOUL.md /app/templates/SOUL.md
COPY USER.md /app/templates/USER.md

# Copy entrypoint and healthcheck
COPY docker/entrypoint.sh /app/entrypoint.sh
COPY docker/healthcheck.js /app/healthcheck.js

RUN chmod +x /app/entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node /app/healthcheck.js

ENTRYPOINT ["/app/entrypoint.sh"]
