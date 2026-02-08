-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "PromptLayerType" AS ENUM ('identity', 'instructions', 'safety');

-- CreateEnum
CREATE TYPE "ScheduledTaskOrigin" AS ENUM ('static', 'agent_proposed');

-- CreateEnum
CREATE TYPE "ScheduledTaskStatus" AS ENUM ('proposed', 'active', 'paused', 'rejected', 'completed', 'expired');

-- CreateEnum
CREATE TYPE "ScheduledTaskRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'timeout', 'budget_exceeded');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'development',
    "owner" TEXT NOT NULL,
    "tags" TEXT[],
    "config_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "usage" JSONB,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memory_entries" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "session_id" TEXT,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_layers" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "layer_type" "PromptLayerType" NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "change_reason" TEXT NOT NULL,
    "performance_notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "prompt_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_traces" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "prompt_snapshot" JSONB NOT NULL,
    "events" JSONB NOT NULL,
    "total_duration_ms" INTEGER NOT NULL,
    "total_tokens_used" INTEGER NOT NULL,
    "total_cost_usd" DOUBLE PRECISION NOT NULL,
    "turn_count" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "execution_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tool_call_id" TEXT NOT NULL,
    "tool_id" TEXT NOT NULL,
    "tool_input" JSONB NOT NULL,
    "risk_level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cron_expression" TEXT NOT NULL,
    "task_payload" JSONB NOT NULL,
    "origin" "ScheduledTaskOrigin" NOT NULL,
    "status" "ScheduledTaskStatus" NOT NULL DEFAULT 'proposed',
    "proposed_by" TEXT,
    "approved_by" TEXT,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "timeout_ms" INTEGER NOT NULL DEFAULT 300000,
    "budget_per_run_usd" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "max_duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_turns" INTEGER NOT NULL DEFAULT 10,
    "max_runs" INTEGER,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_task_runs" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "status" "ScheduledTaskRunStatus" NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "tokens_used" INTEGER,
    "cost_usd" DOUBLE PRECISION,
    "trace_id" TEXT,
    "result" JSONB,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_project_id_status_idx" ON "sessions"("project_id", "status");

-- CreateIndex
CREATE INDEX "messages_session_id_created_at_idx" ON "messages"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "memory_entries_project_id_category_idx" ON "memory_entries"("project_id", "category");

-- CreateIndex
CREATE INDEX "memory_entries_project_id_importance_idx" ON "memory_entries"("project_id", "importance");

-- CreateIndex
CREATE INDEX "prompt_layers_project_id_layer_type_is_active_idx" ON "prompt_layers"("project_id", "layer_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_layers_project_id_layer_type_version_key" ON "prompt_layers"("project_id", "layer_type", "version");

-- CreateIndex
CREATE INDEX "usage_records_project_id_timestamp_idx" ON "usage_records"("project_id", "timestamp");

-- CreateIndex
CREATE INDEX "usage_records_project_id_session_id_idx" ON "usage_records"("project_id", "session_id");

-- CreateIndex
CREATE INDEX "execution_traces_project_id_created_at_idx" ON "execution_traces"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "execution_traces_session_id_idx" ON "execution_traces"("session_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_requests_project_id_status_idx" ON "approval_requests"("project_id", "status");

-- CreateIndex
CREATE INDEX "scheduled_tasks_project_id_status_idx" ON "scheduled_tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "scheduled_tasks_status_next_run_at_idx" ON "scheduled_tasks"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "scheduled_task_runs_task_id_created_at_idx" ON "scheduled_task_runs"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "scheduled_task_runs_status_idx" ON "scheduled_task_runs"("status");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_layers" ADD CONSTRAINT "prompt_layers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
