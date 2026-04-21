-- AlterTable
ALTER TABLE "usage_records" ADD COLUMN "agent_id" TEXT;
ALTER TABLE "usage_records" ADD COLUMN "client_id" TEXT;

-- CreateIndex
CREATE INDEX "usage_records_project_id_agent_id_idx" ON "usage_records"("project_id", "agent_id");
CREATE INDEX "usage_records_project_id_client_id_idx" ON "usage_records"("project_id", "client_id");
