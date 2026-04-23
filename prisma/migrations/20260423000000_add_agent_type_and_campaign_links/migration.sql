-- Migration: add AgentType enum + drop operatingMode + Campaign/CampaignSend agent links
-- Track A — A1 (D5: drop operatingMode in same migration, no deprecated period)
-- Plan: docs/plans/plan-de-ejecucion.md

-- ════════════════════════════════════════════════════════════════════════════
-- Part 1 — AgentType enum + backfill from operating_mode + drop operating_mode
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 Create the enum
CREATE TYPE "AgentType" AS ENUM ('conversational', 'process', 'backoffice');

-- 1.2 Add the column nullable so we can backfill
ALTER TABLE "agents" ADD COLUMN "type" "AgentType";

-- 1.3 Backfill — priority to primary trigger role
--     (intentionally NOT reclassifying agents that have BOTH a channel and a
--      scheduled_task; keep them in their primary type. See plan riesgo #1)

-- 1.3a customer-facing → conversational (inbound is the primary trigger)
UPDATE "agents" SET "type" = 'conversational'
  WHERE "operating_mode" = 'customer-facing';

-- 1.3b internal / copilot / manager / admin → backoffice (UI/owner driven)
UPDATE "agents" SET "type" = 'backoffice'
  WHERE "operating_mode" IN ('internal', 'copilot', 'manager', 'admin');

-- 1.3c process — only for pure-batch agents that have NO operating_mode set
--      AND only exist via scheduled_tasks references.
--      Current prod has zero such agents; this clause is for future-proof.
UPDATE "agents" SET "type" = 'process'
  WHERE "type" IS NULL
    AND "id" IN (
      SELECT DISTINCT (task_payload->>'agentId')::text
      FROM "scheduled_tasks"
      WHERE task_payload ? 'agentId'
    );

-- 1.3d Safety net — anything still NULL gets conversational
UPDATE "agents" SET "type" = 'conversational' WHERE "type" IS NULL;

-- 1.4 Lockdown
ALTER TABLE "agents" ALTER COLUMN "type" SET NOT NULL;
ALTER TABLE "agents" ALTER COLUMN "type" SET DEFAULT 'conversational';

-- 1.5 Index
CREATE INDEX "agents_project_id_type_idx" ON "agents"("project_id", "type");

-- 1.6 Drop the old column (D5: no deprecation period)
ALTER TABLE "agents" DROP COLUMN "operating_mode";

-- ════════════════════════════════════════════════════════════════════════════
-- Part 2 — Campaign.agentId + scheduledTaskId + audienceSource + audienceCache
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 Add new columns nullable for backfill
ALTER TABLE "campaigns" ADD COLUMN "agent_id" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "scheduled_task_id" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "audience_source" JSONB;
ALTER TABLE "campaigns" ADD COLUMN "audience_cache" JSONB;

-- 2.2 Backfill campaign.agent_id with the first active agent of the same project.
--     If a project has campaigns but zero active agents, this UPDATE leaves the
--     row NULL and the NOT NULL ALTER below will fail loudly — exactly the
--     "alert" the user asked for.
UPDATE "campaigns" c
SET "agent_id" = (
  SELECT a."id"
  FROM "agents" a
  WHERE a."project_id" = c."project_id"
    AND a."status" = 'active'
  ORDER BY a."created_at" ASC
  LIMIT 1
)
WHERE c."agent_id" IS NULL;

-- 2.3 Lockdown agent_id
ALTER TABLE "campaigns" ALTER COLUMN "agent_id" SET NOT NULL;

-- 2.4 Foreign keys
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_scheduled_task_id_fkey"
  FOREIGN KEY ("scheduled_task_id") REFERENCES "scheduled_tasks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2.5 Indexes
CREATE UNIQUE INDEX "campaigns_scheduled_task_id_key" ON "campaigns"("scheduled_task_id");
CREATE INDEX "campaigns_agent_id_idx" ON "campaigns"("agent_id");

-- ════════════════════════════════════════════════════════════════════════════
-- Part 3 — CampaignSend.agentId
-- ════════════════════════════════════════════════════════════════════════════

-- 3.1 Add column nullable
ALTER TABLE "campaign_sends" ADD COLUMN "agent_id" TEXT;

-- 3.2 Backfill from the parent campaign (which now has an agentId)
UPDATE "campaign_sends" cs
SET "agent_id" = c."agent_id"
FROM "campaigns" c
WHERE cs."campaign_id" = c."id"
  AND cs."agent_id" IS NULL;

-- 3.3 Lockdown
ALTER TABLE "campaign_sends" ALTER COLUMN "agent_id" SET NOT NULL;

-- 3.4 Foreign key
ALTER TABLE "campaign_sends"
  ADD CONSTRAINT "campaign_sends_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3.5 Index
CREATE INDEX "campaign_sends_agent_id_idx" ON "campaign_sends"("agent_id");
