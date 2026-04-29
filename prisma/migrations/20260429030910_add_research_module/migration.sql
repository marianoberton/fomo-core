-- CreateEnum
CREATE TYPE "ResearchPhoneStatus" AS ENUM ('pending', 'active', 'disconnected', 'banned', 'quarantined');

-- CreateEnum
CREATE TYPE "TargetStatus" AS ENUM ('pending', 'active', 'completed', 'paused', 'failed', 'banned');

-- CreateEnum
CREATE TYPE "TargetSourceType" AS ENUM ('url', 'screenshot', 'referral', 'other');

-- CreateEnum
CREATE TYPE "ProbeLevel" AS ENUM ('L1_SURFACE', 'L2_CAPABILITIES', 'L3_ARCHITECTURE', 'L4_ADVERSARIAL', 'L5_LONGITUDINAL');

-- CreateEnum
CREATE TYPE "ResearchSessionStatus" AS ENUM ('queued', 'running', 'waiting_response', 'paused', 'completed', 'failed', 'aborted');

-- CreateEnum
CREATE TYPE "TurnDirection" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('pending', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "PatternStatus" AS ENUM ('pending', 'approved', 'rejected', 'superseded');

-- DropForeignKey
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_project_id_fkey";

-- AlterTable
ALTER TABLE "agent_templates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "campaign_replies" (
    "id" TEXT NOT NULL,
    "campaign_send_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "replied_at" TIMESTAMP(3) NOT NULL,
    "message_count" INTEGER NOT NULL DEFAULT 1,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "conversion_note" TEXT,

    CONSTRAINT "campaign_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "monthly_budget_usd" DOUBLE PRECISION,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_verticals" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "scoring_rubric" JSONB NOT NULL,
    "analysis_instructions" TEXT NOT NULL,
    "min_cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "active_hours_start" INTEGER NOT NULL DEFAULT 9,
    "active_hours_end" INTEGER NOT NULL DEFAULT 21,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_verticals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_phones" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "waha_session" TEXT NOT NULL,
    "phone_number" TEXT,
    "status" "ResearchPhoneStatus" NOT NULL DEFAULT 'pending',
    "identity_name" TEXT,
    "identity_avatar" TEXT,
    "identity_bio" TEXT,
    "notes" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "banned_at" TIMESTAMP(3),
    "ban_reason" TEXT,
    "total_sessions" INTEGER NOT NULL DEFAULT 0,
    "total_turns_today" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_targets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone_number" TEXT NOT NULL,
    "vertical_slug" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'AR',
    "source_type" "TargetSourceType" NOT NULL,
    "source_value" TEXT NOT NULL,
    "notes" TEXT,
    "status" "TargetStatus" NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT[],
    "opted_out_at" TIMESTAMP(3),
    "opted_out_reason" TEXT,
    "dsar_deleted_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "probe_scripts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vertical_slug" TEXT NOT NULL,
    "level" "ProbeLevel" NOT NULL,
    "objective" TEXT NOT NULL,
    "estimated_minutes" INTEGER NOT NULL,
    "turns" JSONB NOT NULL,
    "wait_min_ms" INTEGER NOT NULL DEFAULT 3000,
    "wait_max_ms" INTEGER NOT NULL DEFAULT 8000,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "probe_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_sessions" (
    "id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "phone_id" TEXT NOT NULL,
    "script_id" TEXT NOT NULL,
    "status" "ResearchSessionStatus" NOT NULL DEFAULT 'queued',
    "current_turn" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "fail_reason" TEXT,
    "fail_code" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "schedule_id" TEXT,
    "retention_eligible_at" TIMESTAMP(3),
    "triggered_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_turns" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_order" INTEGER NOT NULL,
    "direction" "TurnDirection" NOT NULL,
    "message" TEXT NOT NULL,
    "raw_message" TEXT,
    "sanitized" BOOLEAN NOT NULL DEFAULT false,
    "redactions_count" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latency_ms" INTEGER,
    "waha_message_id" TEXT,
    "is_timeout" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "research_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_analyses" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previous_version_id" TEXT,
    "agent_name" TEXT,
    "has_presentation_menu" BOOLEAN,
    "menu_type" TEXT,
    "tone_profile" TEXT,
    "tone_notes" TEXT,
    "uses_emoji" BOOLEAN,
    "response_time_p50_ms" INTEGER,
    "response_time_p95_ms" INTEGER,
    "has_proactive_reengage" BOOLEAN,
    "reengage_time_ms" INTEGER,
    "languages_detected" TEXT[],
    "capability_map" JSONB,
    "can_take_actions" BOOLEAN,
    "has_realtime_lookup" BOOLEAN,
    "data_freshness" TEXT,
    "capability_notes" TEXT,
    "estimated_llm" TEXT,
    "llm_confidence" INTEGER,
    "llm_evidence_notes" TEXT,
    "has_rag" BOOLEAN,
    "rag_domain_scope" TEXT,
    "has_function_calling" BOOLEAN,
    "detected_tools" TEXT[],
    "has_cross_session_memory" BOOLEAN,
    "system_prompt_hints" TEXT,
    "prompt_structure_notes" TEXT,
    "prompt_injection_resistance" INTEGER,
    "handles_offensive_input" TEXT,
    "competitor_mention_policy" TEXT,
    "consistency_score" INTEGER,
    "hallucination_rate" TEXT,
    "adversarial_notes" TEXT,
    "changes_from_previous" TEXT,
    "significant_changes" BOOLEAN NOT NULL DEFAULT false,
    "regressions" TEXT[],
    "improvements" TEXT[],
    "scores" JSONB,
    "score_total" DOUBLE PRECISION,
    "best_turn_order" INTEGER,
    "best_turn_text" TEXT,
    "best_turn_justification" TEXT,
    "worst_turn_order" INTEGER,
    "worst_turn_text" TEXT,
    "worst_turn_justification" TEXT,
    "key_strengths" TEXT[],
    "key_weaknesses" TEXT[],
    "unique_capabilities" TEXT[],
    "things_to_replicate" TEXT[],
    "things_to_avoid" TEXT[],
    "executive_summary" TEXT,
    "rawJson" JSONB NOT NULL,
    "llm_model" TEXT NOT NULL,
    "llm_input_tokens" INTEGER,
    "llm_output_tokens" INTEGER,
    "llm_cost_usd" DECIMAL(10,6),
    "llm_reasoning_trace" TEXT,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_session_schedules" (
    "id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "script_id" TEXT NOT NULL,
    "phone_id" TEXT NOT NULL,
    "cron_expr" TEXT,
    "interval_ms" BIGINT,
    "jitter_ms" INTEGER NOT NULL DEFAULT 7200000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_session_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_insights" (
    "id" TEXT NOT NULL,
    "vertical_slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "evidence" TEXT,
    "seen_in_count" INTEGER NOT NULL DEFAULT 1,
    "status" "InsightStatus" NOT NULL DEFAULT 'pending',
    "rejected_reason" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intelligence_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_sources" (
    "insight_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,

    CONSTRAINT "insight_sources_pkey" PRIMARY KEY ("insight_id","analysis_id")
);

-- CreateTable
CREATE TABLE "prompt_patterns" (
    "id" TEXT NOT NULL,
    "vertical_slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "PatternStatus" NOT NULL DEFAULT 'pending',
    "rejected_reason" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_pattern_versions" (
    "id" TEXT NOT NULL,
    "pattern_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "pattern_text" TEXT NOT NULL,
    "pattern_variables" TEXT[],
    "seen_in_count" INTEGER NOT NULL DEFAULT 1,
    "avg_score_when" DOUBLE PRECISION,
    "notes" TEXT,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "edited_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_pattern_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pattern_sources" (
    "pattern_id" TEXT NOT NULL,
    "analysis_id" TEXT NOT NULL,

    CONSTRAINT "pattern_sources_pkey" PRIMARY KEY ("pattern_id","analysis_id")
);

-- CreateTable
CREATE TABLE "prompt_pattern_uses" (
    "id" TEXT NOT NULL,
    "pattern_id" TEXT NOT NULL,
    "pattern_version_id" TEXT NOT NULL,
    "agent_template_slug" TEXT NOT NULL,
    "inserted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inserted_by" TEXT,
    "score_at_insertion" DOUBLE PRECISION,
    "score_after" DOUBLE PRECISION,
    "outcome" TEXT,

    CONSTRAINT "prompt_pattern_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_audit_log" (
    "id" TEXT NOT NULL,
    "actor_email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "payload" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_replies_campaign_send_id_key" ON "campaign_replies"("campaign_send_id");

-- CreateIndex
CREATE INDEX "campaign_replies_contact_id_idx" ON "campaign_replies"("contact_id");

-- CreateIndex
CREATE INDEX "clients_project_id_idx" ON "clients"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_project_id_external_id_key" ON "clients"("project_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_verticals_slug_key" ON "research_verticals"("slug");

-- CreateIndex
CREATE INDEX "research_verticals_is_active_idx" ON "research_verticals"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "research_phones_label_key" ON "research_phones"("label");

-- CreateIndex
CREATE UNIQUE INDEX "research_phones_waha_session_key" ON "research_phones"("waha_session");

-- CreateIndex
CREATE INDEX "research_phones_status_idx" ON "research_phones"("status");

-- CreateIndex
CREATE UNIQUE INDEX "research_targets_phone_number_key" ON "research_targets"("phone_number");

-- CreateIndex
CREATE INDEX "research_targets_vertical_slug_status_idx" ON "research_targets"("vertical_slug", "status");

-- CreateIndex
CREATE INDEX "research_targets_country_idx" ON "research_targets"("country");

-- CreateIndex
CREATE INDEX "research_targets_opted_out_at_idx" ON "research_targets"("opted_out_at");

-- CreateIndex
CREATE INDEX "probe_scripts_level_is_active_idx" ON "probe_scripts"("level", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "probe_scripts_vertical_slug_name_key" ON "probe_scripts"("vertical_slug", "name");

-- CreateIndex
CREATE INDEX "research_sessions_status_idx" ON "research_sessions"("status");

-- CreateIndex
CREATE INDEX "research_sessions_target_id_completed_at_idx" ON "research_sessions"("target_id", "completed_at");

-- CreateIndex
CREATE INDEX "research_sessions_phone_id_status_idx" ON "research_sessions"("phone_id", "status");

-- CreateIndex
CREATE INDEX "research_sessions_schedule_id_idx" ON "research_sessions"("schedule_id");

-- CreateIndex
CREATE INDEX "research_sessions_retention_eligible_at_idx" ON "research_sessions"("retention_eligible_at");

-- CreateIndex
CREATE UNIQUE INDEX "research_turns_waha_message_id_key" ON "research_turns"("waha_message_id");

-- CreateIndex
CREATE INDEX "research_turns_session_id_idx" ON "research_turns"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_turns_session_id_turn_order_direction_key" ON "research_turns"("session_id", "turn_order", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "research_analyses_session_id_key" ON "research_analyses"("session_id");

-- CreateIndex
CREATE INDEX "research_analyses_analyzed_at_idx" ON "research_analyses"("analyzed_at");

-- CreateIndex
CREATE INDEX "research_analyses_score_total_idx" ON "research_analyses"("score_total");

-- CreateIndex
CREATE INDEX "research_session_schedules_is_active_next_run_at_idx" ON "research_session_schedules"("is_active", "next_run_at");

-- CreateIndex
CREATE INDEX "research_session_schedules_target_id_idx" ON "research_session_schedules"("target_id");

-- CreateIndex
CREATE INDEX "intelligence_insights_vertical_slug_status_idx" ON "intelligence_insights"("vertical_slug", "status");

-- CreateIndex
CREATE INDEX "intelligence_insights_category_idx" ON "intelligence_insights"("category");

-- CreateIndex
CREATE INDEX "insight_sources_analysis_id_idx" ON "insight_sources"("analysis_id");

-- CreateIndex
CREATE INDEX "prompt_patterns_vertical_slug_status_idx" ON "prompt_patterns"("vertical_slug", "status");

-- CreateIndex
CREATE INDEX "prompt_patterns_category_idx" ON "prompt_patterns"("category");

-- CreateIndex
CREATE INDEX "prompt_pattern_versions_pattern_id_is_current_idx" ON "prompt_pattern_versions"("pattern_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_pattern_versions_pattern_id_version_number_key" ON "prompt_pattern_versions"("pattern_id", "version_number");

-- CreateIndex
CREATE INDEX "pattern_sources_analysis_id_idx" ON "pattern_sources"("analysis_id");

-- CreateIndex
CREATE INDEX "prompt_pattern_uses_pattern_id_idx" ON "prompt_pattern_uses"("pattern_id");

-- CreateIndex
CREATE INDEX "prompt_pattern_uses_agent_template_slug_idx" ON "prompt_pattern_uses"("agent_template_slug");

-- CreateIndex
CREATE INDEX "research_audit_log_entity_type_entity_id_idx" ON "research_audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "research_audit_log_actor_email_at_idx" ON "research_audit_log"("actor_email", "at");

-- CreateIndex
CREATE INDEX "research_audit_log_action_at_idx" ON "research_audit_log"("action", "at");

-- CreateIndex
CREATE INDEX "api_keys_project_id_idx" ON "api_keys"("project_id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_replies" ADD CONSTRAINT "campaign_replies_campaign_send_id_fkey" FOREIGN KEY ("campaign_send_id") REFERENCES "campaign_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_targets" ADD CONSTRAINT "research_targets_vertical_slug_fkey" FOREIGN KEY ("vertical_slug") REFERENCES "research_verticals"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "probe_scripts" ADD CONSTRAINT "probe_scripts_vertical_slug_fkey" FOREIGN KEY ("vertical_slug") REFERENCES "research_verticals"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "research_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "research_phones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "probe_scripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_sessions" ADD CONSTRAINT "research_sessions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "research_session_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_turns" ADD CONSTRAINT "research_turns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "research_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_analyses" ADD CONSTRAINT "research_analyses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "research_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_session_schedules" ADD CONSTRAINT "research_session_schedules_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "research_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_session_schedules" ADD CONSTRAINT "research_session_schedules_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "probe_scripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_session_schedules" ADD CONSTRAINT "research_session_schedules_phone_id_fkey" FOREIGN KEY ("phone_id") REFERENCES "research_phones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_insights" ADD CONSTRAINT "intelligence_insights_vertical_slug_fkey" FOREIGN KEY ("vertical_slug") REFERENCES "research_verticals"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_sources" ADD CONSTRAINT "insight_sources_insight_id_fkey" FOREIGN KEY ("insight_id") REFERENCES "intelligence_insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_sources" ADD CONSTRAINT "insight_sources_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "research_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_patterns" ADD CONSTRAINT "prompt_patterns_vertical_slug_fkey" FOREIGN KEY ("vertical_slug") REFERENCES "research_verticals"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_pattern_versions" ADD CONSTRAINT "prompt_pattern_versions_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "prompt_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_sources" ADD CONSTRAINT "pattern_sources_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "prompt_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pattern_sources" ADD CONSTRAINT "pattern_sources_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "research_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_pattern_uses" ADD CONSTRAINT "prompt_pattern_uses_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "prompt_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
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

