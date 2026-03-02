-- DropForeignKey
ALTER TABLE "agents" DROP CONSTRAINT "agents_project_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_project_id_fkey";

-- DropForeignKey
ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_requests_session_id_fkey";

-- DropForeignKey
ALTER TABLE "channel_integrations" DROP CONSTRAINT "channel_integrations_project_id_fkey";

-- DropForeignKey
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_project_id_fkey";

-- DropForeignKey
ALTER TABLE "execution_traces" DROP CONSTRAINT "execution_traces_session_id_fkey";

-- DropForeignKey
ALTER TABLE "files" DROP CONSTRAINT "files_project_id_fkey";

-- DropForeignKey
ALTER TABLE "mcp_server_instances" DROP CONSTRAINT "mcp_server_instances_project_id_fkey";

-- DropForeignKey
ALTER TABLE "memory_entries" DROP CONSTRAINT "memory_entries_project_id_fkey";

-- DropForeignKey
ALTER TABLE "messages" DROP CONSTRAINT "messages_session_id_fkey";

-- DropForeignKey
ALTER TABLE "prompt_layers" DROP CONSTRAINT "prompt_layers_project_id_fkey";

-- DropForeignKey
ALTER TABLE "scheduled_task_runs" DROP CONSTRAINT "scheduled_task_runs_task_id_fkey";

-- DropForeignKey
ALTER TABLE "scheduled_tasks" DROP CONSTRAINT "scheduled_tasks_project_id_fkey";

-- DropForeignKey
ALTER TABLE "secrets" DROP CONSTRAINT "secrets_project_id_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_project_id_fkey";

-- DropForeignKey
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_project_id_fkey";

-- DropForeignKey
ALTER TABLE "webhooks" DROP CONSTRAINT "webhooks_project_id_fkey";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "manager_agent_id" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "operating_mode" TEXT NOT NULL DEFAULT 'customer-facing',
ADD COLUMN     "skill_ids" TEXT[];

-- AlterTable
ALTER TABLE "channel_integrations" ALTER COLUMN "config" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "tags" TEXT[];

-- CreateTable
CREATE TABLE "skill_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "instructions_fragment" TEXT NOT NULL,
    "required_tools" TEXT[],
    "required_mcp_servers" TEXT[],
    "parameters_schema" JSONB,
    "tags" TEXT[],
    "icon" TEXT,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_instances" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_id" TEXT,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "instructions_fragment" TEXT NOT NULL,
    "required_tools" TEXT[],
    "required_mcp_servers" TEXT[],
    "parameters" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "skill_templates_name_key" ON "skill_templates"("name");

-- CreateIndex
CREATE INDEX "skill_templates_category_idx" ON "skill_templates"("category");

-- CreateIndex
CREATE INDEX "skill_instances_project_id_status_idx" ON "skill_instances"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "skill_instances_project_id_name_key" ON "skill_instances"("project_id", "name");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memory_entries" ADD CONSTRAINT "memory_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_layers" ADD CONSTRAINT "prompt_layers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_traces" ADD CONSTRAINT "execution_traces_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_manager_agent_id_fkey" FOREIGN KEY ("manager_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_integrations" ADD CONSTRAINT "channel_integrations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_instances" ADD CONSTRAINT "mcp_server_instances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_instances" ADD CONSTRAINT "skill_instances_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_instances" ADD CONSTRAINT "skill_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "skill_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
