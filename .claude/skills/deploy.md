Safe deploy procedure for Nexus Core to production (Dokploy + VPS via `hostinger-fomo`).

## Context

- SSH alias: `hostinger-fomo`
- Container: `compose-generate-multi-byte-system-fqoeno-app-1`
- Branch `main` auto-deploys via Dokploy on every push (~2-3 min)
- Base image `node:22-alpine` — no `curl`, use `wget`

## Steps

### 1. Pre-push build check

```bash
pnpm build
```

If there are errors, stop and fix them first. A silent success (exit 0) is required.

```bash
timeout 10 node dist/main.js 2>&1 | head -50
```

Verify the output contains `Server listening on 0.0.0.0:3002` and does NOT contain `ReferenceError`, `TypeError`, or uncaught exceptions. If it does, stop and diagnose before pushing.

### 2. Verify only the intended files changed

```bash
git status
git diff
```

If there are unexpected changes, investigate before committing. Stage only the files that are part of this change.

### 3. Commit and push

```bash
git add <specific files>
git commit -m "type(scope): description"
git push origin main
```

### 4. Confirm deploy applied (~2-3 min wait)

```bash
ssh hostinger-fomo "docker ps --format '{{.Names}}\t{{.Status}}' | grep fqoeno"
```

- ✅ `Up X seconds` or `Up X minutes` (< 3 min) = fresh deploy
- ❌ `Up X hours` = deploy didn't apply → check Dokploy UI for the `compose-generate-multi-byte-system-fqoeno` app

If the deploy didn't apply:
```bash
ssh hostinger-fomo "docker logs --tail 20 compose-generate-multi-byte-system-fqoeno-app-1 2>&1"
```

### 5. Smoke test the changed endpoint

Run a targeted test via `wget` inside the container against `http://127.0.0.1:3002`. Use `--header` flags for auth and any special headers. Use `127.0.0.1` not `localhost` (IPv6 resolves first).

Example — HTTP endpoint:
```bash
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 \
  wget -S --header="Authorization: Bearer $NEXUS_API_KEY" \
  http://127.0.0.1:3002/api/v1/health 2>&1 | head -5'
```

Example — WebSocket:
```bash
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 sh -c \
  "wget -S --header=\"Upgrade: websocket\" --header=\"Connection: Upgrade\" \
   --header=\"Sec-WebSocket-Version: 13\" --header=\"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\" \
   \"http://127.0.0.1:3002/api/v1/ws?projectId=test\" 2>&1 | head -5"'
# Expect: HTTP/1.1 101 Switching Protocols
```

Report the final result: what was deployed, the smoke test output, and whether it passed.
