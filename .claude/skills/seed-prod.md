Manually seed catalog data (AgentTemplates, SkillTemplates, MCPTemplates) into production Postgres.

## When to use this skill

`prisma migrate deploy` applies schema migrations but **does not run seeds**. Also, `pnpm db:seed` in production is gated by `ALLOW_PROD_SEED=1` because `seed.ts` `main()` seeds demo data that would clobber real client data.

Use this skill when you need to add catalog/reference data to prod:
- New official `AgentTemplate` entries
- New `SkillTemplate` entries
- New `MCPTemplate` entries
- Any read-only lookup table populated by seed scripts

**Do NOT use this skill for**:
- User/client data (projects, agents, contacts, campaigns) — those go through the API.
- Schema changes — those are Prisma migrations.
- Bulk imports of client records — use dedicated bulk-import endpoints.

## Procedure

### 1. Add the entry to `prisma/seed.ts`

Ensure the seed function (e.g., `seedAgentTemplates()`) contains the new entry. This keeps dev environments and future resets in sync with prod.

### 2. Generate idempotent SQL

Create a file `/tmp/seed-<catalog>.sql` with:

- `BEGIN;` at top, `COMMIT;` at bottom — atomicity
- One `INSERT INTO <table> (...) VALUES (...)` per entry
- `ON CONFLICT (<unique_column>) DO NOTHING` on every INSERT — idempotency
- `gen_random_uuid()::text` for `id` fields (if using cuid/uuid primary keys)
- Dollar-quoting `$json$...$json$::jsonb` for JSON columns — avoids quote escaping hell
- `ARRAY[...]::text[]` for string arrays
- Optional sanity-check `SELECT` at the end (after `COMMIT`)

**Template example** (AgentTemplate):

```sql
-- Seed <catalog-name> in production
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run.
-- Source of truth: prisma/seed.ts `seed<Catalog>()`.

BEGIN;

INSERT INTO agent_templates (
  id, slug, name, description, type, icon, tags, is_official,
  prompt_config, suggested_tools, suggested_llm, suggested_modes,
  suggested_channels, suggested_skill_slugs, metadata,
  max_turns, max_tokens_per_turn, budget_per_day_usd, version
) VALUES (
  gen_random_uuid()::text,
  'my-new-template',
  'My New Template',
  'Description here.',
  'conversational',
  'IconName',
  ARRAY['tag1','tag2']::text[],
  true,
  $json${
    "identity": "...",
    "instructions": "1. Step one\n2. Step two",
    "safety": "- Never do X\n- Always do Y"
  }$json$::jsonb,
  ARRAY['tool-1','tool-2']::text[],
  $json${"provider":"openai","model":"gpt-4o-mini","temperature":0.4}$json$::jsonb,
  $json$[]$json$::jsonb,
  ARRAY['whatsapp']::text[],
  ARRAY[]::text[],
  $json${"archetype":"my-archetype"}$json$::jsonb,
  10, 4000, 10.0, 1
) ON CONFLICT (slug) DO NOTHING;

COMMIT;

-- Sanity check
SELECT slug, type, is_official FROM agent_templates ORDER BY slug;
```

### 3. Transfer and execute

```bash
# Verify current state (count before)
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-postgres-1 psql -U nexus -d nexus_core -c "SELECT COUNT(*) FROM <table>;"'

# Copy to VPS
scp "C:\tmp\seed-<catalog>.sql" hostinger-fomo:/tmp/seed-<catalog>.sql

# Copy into postgres container
ssh hostinger-fomo "docker cp /tmp/seed-<catalog>.sql compose-generate-multi-byte-system-fqoeno-postgres-1:/tmp/seed-<catalog>.sql"

# Execute
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-postgres-1 psql -U nexus -d nexus_core -f /tmp/seed-<catalog>.sql'

# Verify count after
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-postgres-1 psql -U nexus -d nexus_core -c "SELECT COUNT(*) FROM <table>;"'

# Cleanup
ssh hostinger-fomo "docker exec compose-generate-multi-byte-system-fqoeno-postgres-1 rm /tmp/seed-<catalog>.sql"
ssh hostinger-fomo "rm /tmp/seed-<catalog>.sql"
```

### 4. Smoke test via API

```bash
# For AgentTemplates
ssh hostinger-fomo 'docker exec compose-generate-multi-byte-system-fqoeno-app-1 wget -qO- --header="Authorization: Bearer $NEXUS_API_KEY" "http://127.0.0.1:3002/api/v1/agent-templates"'
```

Confirm the new entry appears with correct shape.

## Credentials cheat sheet

- Postgres container: `compose-generate-multi-byte-system-fqoeno-postgres-1`
- DB user: `nexus`
- DB name: `nexus_core`
- App container: `compose-generate-multi-byte-system-fqoeno-app-1`

## Safety rules

- **Always `BEGIN; ... COMMIT;`** — partial inserts are disasters to clean up.
- **Always `ON CONFLICT DO NOTHING`** — makes re-running safe.
- **Never `INSERT ... ON CONFLICT DO UPDATE`** on templates — if an existing template needs change, create a new version (bump `version` field) rather than mutating. Existing agents derived from the old version should keep working.
- **Never seed user/client data this way** — use the regular API.
- **Before running: verify count before** (usually 0 or baseline) and **after** (expected number).

## After seeding

- **Do NOT delete the SQL file locally** (`C:\tmp\seed-<catalog>.sql`) immediately — keep it until the next deploy cycle in case you need to re-run or reference what was inserted.
- **Document which templates were added and when** in `docs/prod-seeds.md` (create if not exists) with date + slug list.
- **If the catalog changes often enough**, consider adding a `prisma/seed-templates-only.ts` script that bypasses `assertSafeToSeed()` and calls only the individual seed functions. Then the flow becomes `tsx prisma/seed-templates-only.ts` inside the container, skipping the manual SQL step.

## Rollback

If a seeded entry is wrong:

```sql
DELETE FROM <table> WHERE slug = '<slug>';
```

But only if no agents/entities reference it yet (for AgentTemplates, check `agents.metadata.createdFromTemplate`). If already referenced, create a new version instead.