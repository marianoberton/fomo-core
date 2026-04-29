-- ════════════════════════════════════════════════════════════════════
-- Research Module — partial unique indexes
-- ════════════════════════════════════════════════════════════════════
--
-- These indexes are NOT expressible in Prisma DSL — they enforce the
-- invariant "at most one active session per (target_id | phone_id)"
-- using a partial unique index over the active-status enum values.
--
-- HOW TO APPLY:
--   1. Run:  pnpm db:migrate -- --name add_research_module --create-only
--      This generates prisma/migrations/<timestamp>_add_research_module/migration.sql
--      with the auto-derived DDL but WITHOUT these partial indexes.
--   2. Open that migration.sql, paste the two CREATE INDEX statements
--      below at the very end, before any blank line.
--   3. Run:  pnpm db:migrate     (applies the edited migration)
--   4. Run:  pnpm db:generate    (regenerates @prisma/client types)
--
-- VERIFICATION:
--   psql ... -c "\d+ research_sessions" should list both indexes.
--
-- ────────────────────────────────────────────────────────────────────

-- A target can have at most one session in flight (queued / running /
-- waiting_response). Prevents duplicate probes against the same target.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_research_sessions_one_active_per_target"
  ON "research_sessions" ("target_id")
  WHERE "status" IN ('queued', 'running', 'waiting_response');

-- A phone can have at most one session in flight at a time.
-- Prevents WAHA conflicts (two sends to different chats from same SIM).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_research_sessions_one_active_per_phone"
  ON "research_sessions" ("phone_id")
  WHERE "status" IN ('queued', 'running', 'waiting_response');
