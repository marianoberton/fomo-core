-- AlterTable
ALTER TABLE "memory_entries" ADD COLUMN     "agent_id" TEXT,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'agent';

-- CreateIndex
CREATE INDEX "memory_entries_project_id_agent_id_idx" ON "memory_entries"("project_id", "agent_id");

-- CreateIndex
CREATE INDEX "memory_entries_project_id_scope_idx" ON "memory_entries"("project_id", "scope");
