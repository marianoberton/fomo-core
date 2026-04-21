Diagnose a production issue on Nexus Core (VPS via `hostinger-fomo`).

## Context

- SSH alias: `hostinger-fomo`
- Container: `compose-generate-multi-byte-system-fqoeno-app-1`
- API listens on `http://127.0.0.1:3002` inside the container
- Base image `node:22-alpine` — no `curl`, use `wget`
- Logs are structured JSON (pino) — use `grep` to filter by field

## Startup

The user will describe the symptom. Begin by:
1. Checking container status
2. Reading recent logs
3. Running a targeted test against the failing endpoint

---

## Step 1 — Container status

```bash
ssh hostinger-fomo "docker ps --format '{{.Names}}\t{{.Status}}' | grep fqoeno"
```

- `Up X seconds/minutes` (< 5 min) = recently restarted — check if that was intentional
- `Up X hours` = stable, not recently deployed
- Not in list = container crashed — run `docker ps -a | grep fqoeno` then check logs

---

## Step 2 — Recent logs

```bash
# Last 30 lines
ssh hostinger-fomo "docker logs --tail 30 compose-generate-multi-byte-system-fqoeno-app-1 2>&1"

# Last N minutes
ssh hostinger-fomo "docker logs --since 5m compose-generate-multi-byte-system-fqoeno-app-1 2>&1"

# Filter by component
ssh hostinger-fomo "docker logs --since 10m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep '\"component\":\"auth-middleware\"'"

# Filter errors/warnings
ssh hostinger-fomo "docker logs --since 10m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep '\"level\":5'"
# level 50 = error, level 40 = warn, level 30 = info
```

---

## Step 3 — Test the failing endpoint

### HTTP endpoint
```bash
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 \
  wget -S --header="Authorization: Bearer $NEXUS_API_KEY" \
  "http://127.0.0.1:3002/api/v1/<path>" 2>&1 | head -10'
```

### WebSocket endpoint
```bash
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 sh -c \
  "wget -S --header=\"Upgrade: websocket\" --header=\"Connection: Upgrade\" \
   --header=\"Sec-WebSocket-Version: 13\" --header=\"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\" \
   \"http://127.0.0.1:3002/api/v1/ws?projectId=test\" 2>&1 | head -5"'
```

---

## Diagnosis table

| HTTP status | No log emitted | Likely cause |
|-------------|---------------|--------------|
| 401 | ✅ (no "Rejected" log) | A `preHandler` or `onRequest` hook applied globally — check if any route fn calls `fastify.addHook()` without `fastify.register()` encapsulation |
| 401 | ❌ (log says "Rejected") | `auth-middleware.ts` exemption pattern doesn't match the actual URL path |
| 403 | — | `requireProjectAccess` or `requireScope` blocking |
| 404 | — | Route not registered, or wrong prefix |
| 500 | — | Unhandled exception — check logs for stack trace |
| 101 (WS) | — | Success — handshake complete |

## Fastify hook scope rule

If 401/403 appears without the right log, suspect a **scoping bug**: a route file calling `fastify.addHook('preHandler', hook)` while being called directly (not via `fastify.register()`), which makes the hook apply to the entire parent scope.

Fix: wrap the offending function in `registerRoutes`:
```typescript
// Before (hook bleeds into all /api/v1 routes):
adminRoutes(fastify, deps);

// After (hook scoped to admin routes only):
await fastify.register(async (f: FastifyInstance) => { adminRoutes(f, deps); });
```

---

## Adding temporary diagnostic logs

If the root cause isn't clear from existing logs, add `logger.info('[DEBUG] ...')` at the entry point of the suspected hook, then:

1. `pnpm build && timeout 10 node dist/main.js 2>&1 | head -50` — confirm no crash
2. `git add <file> && git commit -m "debug: temporary logs" && git push origin main`
3. Wait ~2-3 min for deploy
4. Re-run the failing request
5. `ssh hostinger-fomo "docker logs --since 2m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep DEBUG"`
6. After diagnosis, remove ALL debug logs and push a clean fix commit

Never leave debug logs in production.
