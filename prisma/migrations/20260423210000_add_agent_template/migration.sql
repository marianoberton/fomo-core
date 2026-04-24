-- Migration: add AgentTemplate (global catalog of agent archetypes)
-- Track C — C1 (schema block)
-- Plan: .claude/plans/track-c-design-approved.md
--
-- Notes:
-- - The "AgentType" enum was created in Track A (20260423000000). Reused as-is.
-- - Table is global (no project_id); Fomo publishes official templates and any
--   project can materialize them via POST /projects/:id/agents/from-template.
-- - No backfill needed: brand-new table with no preexisting rows.

-- CreateTable
CREATE TABLE "agent_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "AgentType" NOT NULL,
    "icon" TEXT,
    "tags" TEXT[],
    "is_official" BOOLEAN NOT NULL DEFAULT true,
    "prompt_config" JSONB NOT NULL,
    "suggested_tools" TEXT[],
    "suggested_llm" JSONB,
    "suggested_modes" JSONB,
    "suggested_channels" TEXT[],
    "suggested_mcps" JSONB,
    "suggested_skill_slugs" TEXT[],
    "metadata" JSONB,
    "max_turns" INTEGER NOT NULL DEFAULT 10,
    "max_tokens_per_turn" INTEGER NOT NULL DEFAULT 4000,
    "budget_per_day_usd" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_templates_slug_key" ON "agent_templates"("slug");

-- CreateIndex
CREATE INDEX "agent_templates_type_idx" ON "agent_templates"("type");

-- CreateIndex
CREATE INDEX "agent_templates_is_official_idx" ON "agent_templates"("is_official");
