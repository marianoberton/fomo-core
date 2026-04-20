-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "session_id" TEXT,
    "agent_id" TEXT,
    "tool_id" TEXT NOT NULL,
    "input_redacted" JSONB NOT NULL,
    "approved_by" TEXT,
    "outcome" TEXT NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_logs_actor_created_at_idx" ON "admin_audit_logs"("actor", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_logs_tool_id_created_at_idx" ON "admin_audit_logs"("tool_id", "created_at");
