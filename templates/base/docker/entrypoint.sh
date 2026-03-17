#!/bin/sh
set -e

echo "[entrypoint] Starting OpenClaw client container..."
echo "[entrypoint] CLIENT_ID=${CLIENT_ID}"
echo "[entrypoint] INSTANCE_NAME=${INSTANCE_NAME}"

# Substitute template variables in config files
for file in /app/config/*.yml /app/config/*.yaml; do
  [ -f "$file" ] || continue
  sed -i \
    -e "s|{{client_id}}|${CLIENT_ID}|g" \
    -e "s|{{instance_name}}|${INSTANCE_NAME}|g" \
    -e "s|{{company_name}}|${SOUL_COMPANY_NAME}|g" \
    -e "s|{{company_vertical}}|${SOUL_COMPANY_VERTICAL}|g" \
    -e "s|{{manager_name}}|${MANAGER_NAME:-Manager}|g" \
    -e "s|{{owner_name}}|${OWNER_NAME}|g" \
    -e "s|{{channels}}|${CHANNELS}|g" \
    -e "s|{{health_check_port}}|${HEALTH_CHECK_PORT:-8080}|g" \
    "$file"
done

# Substitute template variables in markdown files
for file in /app/templates/*.md; do
  [ -f "$file" ] || continue
  sed -i \
    -e "s|{{company_name}}|${SOUL_COMPANY_NAME}|g" \
    -e "s|{{company_vertical}}|${SOUL_COMPANY_VERTICAL}|g" \
    -e "s|{{manager_name}}|${MANAGER_NAME:-Manager}|g" \
    -e "s|{{owner_name}}|${OWNER_NAME}|g" \
    "$file"
done

# Copy rendered templates to working directory
cp /app/templates/*.md /app/ 2>/dev/null || true

echo "[entrypoint] Configuration rendered. Starting openclaw..."

exec openclaw start \
  --config /app/config/openclaw.config.yml \
  --port "${HEALTH_CHECK_PORT:-8080}"
