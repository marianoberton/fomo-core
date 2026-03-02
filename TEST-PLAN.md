# Test Plan — Pre-Commit

## Ya ejecutado (automático)

| Check | Resultado |
|-------|-----------|
| `pnpm typecheck` | ✅ 0 errores |
| `npx vitest run src` | ✅ 1490 passed, 5 failed (pre-existentes), 2 skipped |
| store-memory.test.ts (18 tests) | ✅ NUEVO — schema + dryRun + execute |
| delegate-to-agent.test.ts (14 tests) | ✅ |
| list-project-agents.test.ts (7 tests) | ✅ |
| hubspot-crm-server.test.ts (40 tests) | ✅ incl. 11 search-deals |
| skill-service.test.ts (14 tests) | ✅ |
| agent-registry.test.ts (9 tests) | ✅ |
| mode-resolver.test.ts (13 tests) | ✅ |
| agent-channel-router.test.ts (11 tests) | ✅ |
| inbound-processor.test.ts (10 tests) | ✅ |
| task-executor.test.ts | ✅ |

### 5 fallos pre-existentes (no relacionados)

- `chat.test.ts` — validación 400 body
- `knowledge.test.ts` — validación 400 category
- `scheduled-tasks.test.ts` — validación 400 approvedBy
- `whatsapp-waha.test.ts` — mock headers mismatch
- `send-email.test.ts` — formato de error Resend

---

## Testing manual (requiere Docker + servicios)

### 1. Migración + Seed

```bash
pnpm db:migrate
pnpm db:seed
```

Verificar en la salida del seed:
- [ ] 6 proyectos listados (último: Market Paper)
- [ ] 5 agentes creados
- [ ] 18 prompt layers
- [ ] Scheduled task de Market Paper

### 2. Prisma Studio

```bash
pnpm db:studio
```

Verificar:
- [ ] **Project** "Market Paper" existe con config correcta (GPT-4o-mini, memory decay 60 días)
- [ ] **Agent** "Reactivadora Market Paper" tiene 13 tools en `toolAllowlist`
- [ ] **PromptLayer** — 3 layers para Market Paper: identity, instructions, safety
- [ ] **ScheduledTask** — cron `0 9 * * 1-5`, status `proposed`, message "Ejecutar campaña de reactivación"
- [ ] **SkillTemplate** — 10 templates seeded
- [ ] **Contact.tags** — campo existe como `String[]`

### 3. Server arranca

```bash
pnpm dev
```

- [ ] Server arranca sin crash en puerto 3002
- [ ] No errores de import ni runtime en logs

### 4. Integration tests

```bash
pnpm test:integration
```

- [ ] Todos pasan contra DB + Redis reales

### 5. API Smoke Tests (con server corriendo)

```bash
# Skills API
curl http://[::]:3002/api/v1/skill-templates | jq '.length'
# Esperar: 10

# Agents API — listar agentes de Market Paper
curl http://[::]:3002/api/v1/projects/<MARKET_PAPER_ID>/agents | jq '.[].name'
# Esperar: "Reactivadora Market Paper"

# Scheduled Tasks
curl http://[::]:3002/api/v1/scheduled-tasks | jq '.[].name'
# Esperar: incluye "Reactivación diaria — Market Paper"
```

### 6. HubSpot MCP (requiere HUBSPOT_ACCESS_TOKEN)

Solo cuando el cliente provea el token:

- [ ] Setear `HUBSPOT_ACCESS_TOKEN` en secrets del proyecto
- [ ] Trigger manual de scheduled task desde dashboard
- [ ] Verificar que `search-deals` devuelve deals en `Seguimiento -14`
- [ ] Verificar que `add-deal-note` crea nota en HubSpot real
- [ ] Verificar que `create-deal-task` crea tarea asignada a la vendedora

### 7. WhatsApp E2E (requiere WAHA)

Solo cuando WAHA esté configurado:

- [ ] WAHA corriendo y conectado al número outbound
- [ ] Channel integration configurada en el proyecto
- [ ] Trigger campaña → verificar que llegan 3 mensajes de prueba
- [ ] Responder desde WhatsApp del lead → verificar que agente responde con contexto
- [ ] Simular interés → verificar handoff (escalate-to-human + tarea HubSpot)
- [ ] Simular "no me interesa" → verificar update stage a Cierre perdido

---

## Comando rápido (re-validar todo antes de commit)

```bash
pnpm typecheck && npx vitest run src
```
