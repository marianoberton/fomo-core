# Track 1 — Chatwoot ATTACH for Fomo WhatsApp + Safety Guards

**Repo**: `c:\Users\Mariano\Documents\fomo-core`
**Branch**: `feat/t1-chatwoot-attach`
**Deliverable**: agente "Fomo WhatsApp" del proyecto Fomo recibe mensajes de Chatwoot y responde, sin tocar otros proyectos del VPS. Safety guard que bloquea seeds destructivos en producción.

---

## Context

- La instancia de Chatwoot es **externa** (ya corriendo, no bundleada en docker-compose).
- El agente "Fomo WhatsApp" **ya existe en DB de producción**. Este track nunca crea, solo attachea.
- Un seed previo de FAMA-Sales rompió data en el VPS. Necesitamos un guard en `prisma/seed.ts` para que esto no vuelva a pasar.
- El adapter de Chatwoot ya está completo ([src/channels/adapters/chatwoot.ts](../src/channels/adapters/chatwoot.ts)) — este track solo expone el flujo ATTACH y asegura que las credenciales se guarden en `SecretService` por proyecto (hoy hay fallback a env vars globales que queremos deprecar sin romper instancias corriendo).

---

## Files to Read First

1. [src/channels/adapters/chatwoot.ts](../src/channels/adapters/chatwoot.ts) — adapter completo (agent_bot + handoff + resume).
2. [src/channels/channel-resolver.ts](../src/channels/channel-resolver.ts) especialmente el fallback a env vars ~línea 153.
3. [src/api/routes/chatwoot-webhook.ts](../src/api/routes/chatwoot-webhook.ts) — inbound flow (HMAC → agente → outbound).
4. [src/api/routes/integrations.ts](../src/api/routes/integrations.ts) — patrón de secret storage a replicar.
5. [prisma/schema.prisma](../prisma/schema.prisma) — `ChannelIntegration` (unique `[projectId, provider]`) y `Agent.channelConfig`.
6. [prisma/seed.ts](../prisma/seed.ts) — identificar `create()` sin guard.
7. [src/secrets/secret-service.ts](../src/secrets/secret-service.ts) — API para guardar secretos cifrados por proyecto.

---

## Scope & Files to Touch

### A. Script one-shot (SSH-friendly)

**Nuevo**: `scripts/attach-chatwoot.ts`

- Parsea flags: `--project-id`, `--agent-id`, `--chatwoot-base-url`, `--chatwoot-account-id`, `--chatwoot-inbox-id`, `--chatwoot-agent-bot-id`, `--api-token-env-var`, `--webhook-secret-env-var`, `--dry-run`.
- Valida que el proyecto y el agente existen en DB (no crea, no borra).
- Con `--dry-run`: imprime el plan y sale 0.
- Sin `--dry-run`:
  1. Upsert `ChannelIntegration` con `{ projectId, provider: 'chatwoot' }` unique key. Config: `{ baseUrl, accountId, inboxId, agentBotId, apiTokenSecretKey, webhookSecretKey }`.
  2. Guarda en `SecretService` (por proyecto) `CHATWOOT_API_TOKEN` y `CHATWOOT_WEBHOOK_SECRET` leyendo los valores de las env vars que le pasó el operador.
  3. Update `Agent.channelConfig.channels` del agente objetivo: agrega `'chatwoot'` si no está. Append-only, no remueve otros canales.
  4. Health check: `GET ${baseUrl}/api/v1/accounts/${accountId}` con `api_access_token` → espera 200.
  5. Log final con resumen: projectId, agentId, integrationId, health status.
- Errores de cada paso se loggean con `component: 'attach-chatwoot'` y causan exit code != 0.

**Salida esperada en `--dry-run`**:
```
[attach-chatwoot] DRY RUN
- Project: <id> "Fomo"
- Agent: <id> "Fomo WhatsApp" (current channels: ['whatsapp'])
- Would upsert ChannelIntegration (projectId, provider='chatwoot')
- Would add 'chatwoot' to Agent.channelConfig.channels
- Would store secrets CHATWOOT_API_TOKEN_FOMO, CHATWOOT_WEBHOOK_SECRET_FOMO
- Health check: SKIPPED (dry-run)
OK
```

### B. Endpoints admin (master-key-only)

**Nuevo**: `src/api/routes/admin-chatwoot.ts`

- `POST /api/v1/admin/chatwoot/attach`
  Body: `{ projectId, agentId, baseUrl, accountId, inboxId, agentBotId, apiToken, webhookSecret }`
  Misma lógica que el script pero recibe los secretos en el body (https), nunca los loggea.
  Response: `{ integrationId, health: 'ok' | 'unreachable', channelConfigUpdated: true }`
- `GET /api/v1/admin/chatwoot/health/:projectId`
  Response: `{ integrationId, lastInboundAt, lastOutboundAt, chatwootReachable, webhookSecretConfigured }`
- `POST /api/v1/admin/chatwoot/detach/:projectId`
  Borra el `ChannelIntegration` + remueve `'chatwoot'` de `Agent.channelConfig` de **todos** los agentes del proyecto. Idempotente (si no existe, 204).
- Todos los endpoints usan `requireMasterKey` (o el nombre del middleware equivalente en `src/api/auth-middleware.ts` — verificar).

**Modificar**: `src/api/index.ts` para registrar el nuevo router bajo `/api/v1/admin/chatwoot`.

### C. SecretService integration

**Nuevo**: `src/secrets/chatwoot-secrets.ts`

- Helper `storeChatwootSecrets(projectId, apiToken, webhookSecret)` → usa `SecretService.set`.
- Helper `getChatwootApiToken(projectId)` y `getChatwootWebhookSecret(projectId)` → usa `SecretService.get`.

**Modificar**: `src/channels/channel-resolver.ts` (~línea 153) — cambiar el flujo para Chatwoot:
```
if (integration.config.apiTokenSecretKey) {
  apiToken = await secretService.get(projectId, integration.config.apiTokenSecretKey);
} else {
  // Legacy fallback: env var global. Warn para migrar.
  apiToken = process.env[integration.config.apiTokenEnvVar];
  logger.warn('Chatwoot using legacy env var fallback', { component: 'channel-resolver', projectId });
}
```

**Modificar**: `src/api/routes/chatwoot-webhook.ts` — igual, leer el `webhookSecret` desde `SecretService` si está disponible, sino fallback a env var con warning.

### D. Anti-destructive seed guard

**Modificar**: `prisma/seed.ts` al tope:
```ts
if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
  throw new Error(
    'Production seed blocked. Set ALLOW_PROD_SEED=1 explicitly if you really mean it.'
  );
}
```

Revisar todos los `prisma.*.create()` sin `where`/`upsert` previo y refactorizar los más peligrosos a `upsert({ where: { uniqueKey } })` — específicamente:
- `prisma.project.create` → `upsert` por `name` si existe uniqueness, sino skip con warning.
- `prisma.agent.create` → `upsert` por `(projectId, name)`.
- `prisma.promptLayer.create` → append-only OK (son versionados).

**No agregar deletes a seed.ts bajo ninguna circunstancia.**

---

## Tests

### Unit

- `src/secrets/chatwoot-secrets.test.ts` — set/get round-trip con mock SecretService.

### Integration

**Nuevo**: `src/api/routes/admin-chatwoot.test.ts`
- `attach` crea ChannelIntegration + update agent channelConfig + guarda secrets.
- `attach` idempotente — correr 2 veces no duplica ni corrompe.
- `attach` con agente inexistente → 404.
- `attach` con proyecto inexistente → 404.
- `detach` remueve integration + limpia channelConfig + idempotente.
- `health` retorna 200 con integration existente y timestamps.
- Sin master key → 403.

### E2E Mock

**Nuevo**: `scripts/attach-chatwoot.test.ts` (o integrarlo en integration)
- Ejecutar el script con DB mockeada (test Prisma) + Chatwoot API mockeada (nock) → todos los pasos OK.

### Regression

- Correr suite completa: `pnpm test` → ningún test existente se rompe.
- `pnpm build && pnpm typecheck && pnpm lint` → 0 errores.

---

## VPS Runbook (post-merge)

```bash
# 1. Deploy (push to main → Dokploy auto-deploy en ~2-3 min)
git push origin main

# 2. Verificar deploy
ssh hostinger-fomo "docker ps --format '{{.Names}}\t{{.Status}}' | grep fqoeno"
# ✅ "Up X seconds/minutes"

# 3. Dry run del attach (necesitás IDs reales: project y agent)
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 \
  node dist/scripts/attach-chatwoot.js \
  --dry-run \
  --project-id <FOMO_PROJECT_ID> \
  --agent-id <FOMO_WHATSAPP_AGENT_ID> \
  --chatwoot-base-url https://chatwoot.fomo.tld \
  --chatwoot-account-id 1 \
  --chatwoot-inbox-id 2 \
  --chatwoot-agent-bot-id 3 \
  --api-token-env-var CHATWOOT_API_TOKEN_FOMO \
  --webhook-secret-env-var CHATWOOT_WEBHOOK_SECRET_FOMO'

# 4. Revisar que el plan impreso es correcto. Si OK, ejecutar sin --dry-run.

# 5. Configurar webhook en Chatwoot UI:
#    Settings → Integrations → Webhooks → Add
#    URL: https://api.fomo.tld/webhooks/chatwoot
#    Secret: el mismo que guardaste en CHATWOOT_WEBHOOK_SECRET_FOMO
#    Events: conversation_created, message_created, conversation_status_changed

# 6. Test: enviar mensaje a un número de WhatsApp que esté conectado al inbox de Chatwoot.
#    Logs esperados:
ssh hostinger-fomo "docker logs --since 2m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep chatwoot"

# 7. Regression: verificar que otros proyectos no se tocaron
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 \
  wget -qO- --header="Authorization: Bearer $NEXUS_API_KEY" \
  http://127.0.0.1:3002/api/v1/projects 2>&1 | head -50'
```

---

## Verificación

- [ ] `pnpm build && pnpm typecheck && pnpm lint` verdes.
- [ ] `pnpm test` verde incluyendo nuevos tests.
- [ ] Dry-run en local funciona contra DB de desarrollo.
- [ ] Deploy en VPS con deploy fresh verificado (container "Up X seconds").
- [ ] Attach real en VPS completado.
- [ ] Webhook configurado en Chatwoot.
- [ ] Mensaje E2E: WhatsApp al inbox Chatwoot → agente responde en <10s.
- [ ] Handoff: si agente incluye `[HANDOFF]` en response, se desasigna el bot en Chatwoot.
- [ ] Regression: `SELECT id, name FROM projects WHERE updated_at > <merge-time> AND id != '<FOMO>'` → 0 filas.

---

## Rules

- **Prohibido** correr `pnpm db:seed` en el VPS. Dokploy no lo corre — mantener así.
- **Prohibido** `prisma migrate reset` en prod.
- **Prohibido** cambios de schema destructivos (drop columns/tables en migration sin `@map` preview).
- No tocar `Agent.channelConfig` de agentes que NO sean Fomo WhatsApp.
- Logs nunca imprimen valores de API tokens ni webhook secrets — solo los keys.
- El fallback a env vars globales se mantiene con warning log por 2 semanas; plan separado para removerlo.

---

## Out of Scope

- Crear nuevos agentes o proyectos (ATTACH-only).
- Migrar todos los agentes de Chatwoot a SecretService automáticamente (solo Fomo WhatsApp; resto se migran manualmente con el mismo script/endpoint).
- Chatwoot bundled en docker-compose.
- UI de Chatwoot setup en el dashboard interno (eso es parte de T3 channel wizard).

---

## Coordination with Other Tracks

- **T2** también toca `src/api/index.ts` (registro de `ws-project`). Orden de merge T1 → T2 resuelve conflicto trivial.
- **T3** implementa wizard de canales en marketpaper; cuando T1 está listo, T3 puede incluir Chatwoot en el wizard reusando los endpoints de integrations existentes (no los admin-chatwoot de T1).
- **T4** no toca nada de lo de T1.
