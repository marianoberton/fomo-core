-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "external_project" TEXT,
    "run_type" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total_steps" INTEGER NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_steps" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "agent_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "input" TEXT,
    "output" TEXT,
    "metadata" JSONB,

    CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_project_id_status_started_at_idx" ON "agent_runs"("project_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "agent_runs_external_project_status_idx" ON "agent_runs"("external_project", "status");

-- CreateIndex
CREATE INDEX "agent_runs_status_started_at_idx" ON "agent_runs"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_steps_run_id_step_index_key" ON "agent_run_steps"("run_id", "step_index");

-- CreateIndex
CREATE INDEX "agent_run_steps_run_id_status_idx" ON "agent_run_steps"("run_id", "status");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
