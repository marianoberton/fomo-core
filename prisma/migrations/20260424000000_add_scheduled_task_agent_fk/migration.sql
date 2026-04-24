-- Migration: add ScheduledTask.agentId FK
-- Track D — A5
--
-- Backfill reads both taskPayload.metadata.agentId (prod convention) and
-- taskPayload.agentId (seed convention). After backfill, rows whose backfilled
-- agent_id points to a non-existent agent are reset to NULL so the FK can be
-- added without failure.

-- 1. Add nullable column + index
ALTER TABLE "scheduled_tasks" ADD COLUMN "agent_id" TEXT;
CREATE INDEX "scheduled_tasks_agent_id_idx" ON "scheduled_tasks"("agent_id");

-- 2. Backfill from JSON paths used historically
UPDATE "scheduled_tasks"
SET "agent_id" = COALESCE(
  "task_payload"->'metadata'->>'agentId',
  "task_payload"->>'agentId'
)
WHERE "agent_id" IS NULL
  AND (
    "task_payload"->'metadata'->>'agentId' IS NOT NULL
    OR "task_payload"->>'agentId' IS NOT NULL
  );

-- 3. Safety cleanup — null out any backfilled id that doesn't exist in agents
--    (prevents FK constraint creation from failing on orphaned references)
UPDATE "scheduled_tasks"
SET "agent_id" = NULL
WHERE "agent_id" IS NOT NULL
  AND "agent_id" NOT IN (SELECT "id" FROM "agents");

-- 4. Add FK constraint (SET NULL on agent delete — task survives, becomes orphan)
ALTER TABLE "scheduled_tasks"
  ADD CONSTRAINT "scheduled_tasks_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
