# Workforce Integration — Master Index

**Generated**: 2026-04-22
**Owner**: Mariano
**Goal**: Connect agent "Fomo WhatsApp" (proyecto Fomo, ya existe en DB de prod) a Chatwoot + convertir el módulo `workforce` de `marketpaper-demo` en la vista cliente definitiva (inbox en vivo, handoff, campañas, traces, performance).

> **Por qué importa**: sin esta pieza, fomo-core es motor invisible y el cliente no percibe valor → se da de baja. Esta es la experiencia que decide si el producto se retiene o se descarga.

---

## Inputs Confirmados

- **Chatwoot**: instancia externa ya corriendo (no se toca docker-compose).
- **Agente "Fomo WhatsApp"**: ya existe en la DB de producción. Track 1 es **ATTACH-only** (nunca create, nunca seed).
- **Seeds destructivos**: el seed previo de FAMA-Sales rompió data. Este plan es **append-only**. Track 1 incluye guard anti-seed-en-prod.
- **Tracks NO afectan a fomo-admin**: son complementarios. fomo-admin = operaciones internas; este plan = experiencia cliente.

---

## Tracks (4 agentes en paralelo)

| Track | Repo | Agente asignado a | Archivo de trabajo | Depende de |
|-------|------|-------------------|---------------------|------------|
| **T1** | fomo-core | Agente Backend A | [004-track1-chatwoot-attach.md](./004-track1-chatwoot-attach.md) | — |
| **T2** | fomo-core | Agente Backend B | [005-track2-live-events-scoping.md](./005-track2-live-events-scoping.md) | — |
| **T3** | marketpaper-demo | Agente Frontend A | [006-track3-workforce-live-inbox.md](./006-track3-workforce-live-inbox.md) | T2 (fallback polling) |
| **T4** | marketpaper-demo + fomo-core | Agente Full-stack | [007-track4-workforce-campaigns-analytics.md](./007-track4-workforce-campaigns-analytics.md) | — |

**Orden de merge recomendado**: T1 → T2 → T4 → T3. T3 puede desarrollar contra polling mientras T2 está en review.

---

## Archivos Compartidos (sincronizar entre tracks)

| Archivo | Tracks que lo tocan | Estrategia |
|---------|---------------------|------------|
| `src/api/index.ts` | T1 + T2 | Cada track agrega un `app.register(...)` — conflicto trivial de merge |
| `lib/fomo-api.ts` (marketpaper) | T3 + T4 | Append-only al final del archivo |
| `prisma/schema.prisma` | Solo T4 agrega `CampaignTemplate` | T4 es dueño del schema en este plan |
| `src/api/routes/campaigns.ts` | T2 (progress event) + T4 (dry-run) | Coordinar: T4 mergea primero en campaigns.ts; T2 rebase |
| `src/channels/handoff.ts` | T2 (emit event) solamente | T3 consume vía WS, no toca el archivo |

Si un track necesita tocar algo fuera de su lista, avisar al resto antes de abrir PR.

---

## Reglas Globales

- **No AI frameworks en backend** (LangChain, AutoGen, CrewAI prohibidos — ver CLAUDE.md).
- **No `any`** — usar `unknown` + type guards.
- **Zod schemas** en todo input externo (API, WS messages, tool inputs).
- **`pino` logger** con `component` context, nunca `console.log`.
- **JSDoc** en exports de backend.
- **No seed re-runs en prod** — Track 1 agrega guard (`ALLOW_PROD_SEED` env var).
- **Pre-push checklist obligatorio** en fomo-core: `pnpm build && timeout 10 node dist/main.js 2>&1 | head -50` (ver CLAUDE.md).
- **Branch strategy**: cada track en `feat/tX-<slug>`.
- **Commit conventions**: seguir el estilo del repo (verificar `git log --oneline -20`).

---

## Verificación End-to-End (post-merge de los 4)

1. **Chatwoot → Fomo WhatsApp** (T1): WhatsApp al inbox de Chatwoot → agente responde en <10s → ningún otro proyecto cambió en DB.
2. **Live inbox** (T2+T3): mensaje entrante aparece en `/workspace/workforce/conversations` en <2s sin refresh.
3. **Handoff** (T3): tomar control → escribir como operador → devolver al bot.
4. **Channel config UI** (T3): wizard crea integración nueva end-to-end con health check verde.
5. **Campaigns v2** (T4): crear → dry-run (10 previews + costo) → ejecutar → progreso live via WS.
6. **Traces drill-down** (T4): filtro por agente + rango → detalle trace con tool calls.
7. **Analytics** (T4): comparar 2 agentes side-by-side con breakdown por canal.
8. **API scoping** (T2): API key project-scoped bloquea acceso cross-project (403).

---

## Out of Scope (futuras iteraciones)

- Multi-tenant client subscoping dentro de un proyecto (requiere expandir modelo `Client` + scope en API keys).
- Knowledge base UI en workforce (hoy placeholder).
- Agent builder visual desde workforce (hoy solo dashboard interno).
- Scheduling rules (pausar agente off-hours).
- Redis pub/sub para event bus (hoy in-process).
- WebSocket nativo en Next.js (hoy SSE como proxy).
