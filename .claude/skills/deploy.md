Safe deploy procedure for Nexus Core to production (Dokploy + VPS via `hostinger-fomo`).

## Context

- SSH alias: `hostinger-fomo`
- Container: `compose-generate-multi-byte-system-fqoeno-app-1`
- Backend branch `main` auto-deploys via Dokploy on every push (~2-3 min)
- **Dashboard is a separate app in Dokploy with MANUAL deploy** — not auto. See section at the end.
- Base image `node:22-alpine` — no `curl`, use `wget`

## Steps (backend)

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
- ❌ `Up X hours` = deploy didn't apply — check Dokploy UI

### 5. Check logs for migration + startup

```bash
ssh hostinger-fomo "docker logs --since 5m compose-generate-multi-byte-system-fqoeno-app-1 2>&1 | grep -iE 'migration|listening|error|fatal'"
```

Must see:
- `All migrations have been successfully applied` (if any migration ran)
- `Server listening on 0.0.0.0:3002`
- No `ERROR` / `FATAL` / `PrismaClient` errors

### 6. Smoke test the endpoint that changed

```bash
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 wget -qO- --header="Authorization: Bearer $NEXUS_API_KEY" "http://127.0.0.1:3002/api/v1/<path-you-changed>"'
```

## Dashboard deploy (manual)

The dashboard (`fomo-core-dashboard` repo, `dashboard/` submodule in this repo) has **manual deploy** in Dokploy. Auto-deploy is disabled on purpose.

### Flow when dashboard changes

1. **Commit inside the submodule**:
   ```bash
   cd dashboard
   git add .
   git commit -m "type(scope): description"
   git push origin main     # pushes to fomo-core-dashboard repo
   cd ..
   ```

2. **Update the submodule pointer in the main repo**:
   ```bash
   git add dashboard
   git commit -m "chore: update dashboard submodule"
   git push origin main     # pushes pointer to fomo-core repo (does NOT trigger backend redeploy since no src/ changed)
   ```

3. **Trigger dashboard deploy manually in Dokploy**:
   - Log into Dokploy UI.
   - Navigate to the dashboard application (separate from backend).
   - Click **Deploy** manually.
   - Wait ~2 min for the build to complete.

4. **Verify**:
   - Open `https://fomo-core-dashboard.fomo.com.ar` in a browser.
   - Do a hard refresh (`Ctrl+Shift+R`) — Next.js caches aggressively.
   - Confirm the change is visible.

### If the dashboard appears unchanged after deploy

In order of likelihood:
1. **Browser cache** — hard refresh again. Most common cause.
2. **Deploy didn't actually run** — check Dokploy UI for latest build time.
3. **Pushed to wrong branch** — the dashboard app deploys from `main` of `fomo-core-dashboard`. If you pushed to a feature branch, Dokploy won't trigger.
4. **Build failed** — check Dokploy UI for build logs.

## Rollback

### Backend rollback

```bash
# Revert the last commit on main
git revert HEAD
git push origin main
# Wait ~3 min, verify container restarted with new commit
```

Or hard reset (riskier, only if safe):

```bash
git reset --hard <previous-good-commit>
git push origin main --force
```

Then **verify the rollback deployed** using Step 4 above.

### Dashboard rollback

Same as above but operating inside `dashboard/` submodule, and **remember to trigger Dokploy deploy manually** after the push.