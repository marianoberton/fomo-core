-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "agent_id" TEXT,
ADD COLUMN     "contact_id" TEXT;

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "telegram_id" TEXT,
    "slack_id" TEXT,
    "timezone" TEXT,
    "language" TEXT NOT NULL DEFAULT 'es',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_prompt" TEXT NOT NULL,
    "secret_env_var" TEXT,
    "allowed_ips" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prompt_config" JSONB NOT NULL,
    "tool_allowlist" TEXT[],
    "mcp_servers" JSONB,
    "channel_config" JSONB,
    "max_turns" INTEGER NOT NULL DEFAULT 10,
    "max_tokens_per_turn" INTEGER NOT NULL DEFAULT 4000,
    "budget_per_day_usd" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "public_url" TEXT,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_project_id_idx" ON "contacts"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_project_id_phone_key" ON "contacts"("project_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_project_id_email_key" ON "contacts"("project_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_project_id_telegram_id_key" ON "contacts"("project_id", "telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_project_id_slack_id_key" ON "contacts"("project_id", "slack_id");

-- CreateIndex
CREATE INDEX "webhooks_project_id_status_idx" ON "webhooks"("project_id", "status");

-- CreateIndex
CREATE INDEX "agents_project_id_status_idx" ON "agents"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_project_id_name_key" ON "agents"("project_id", "name");

-- CreateIndex
CREATE INDEX "files_project_id_uploaded_at_idx" ON "files"("project_id", "uploaded_at");

-- CreateIndex
CREATE INDEX "files_project_id_mime_type_idx" ON "files"("project_id", "mime_type");

-- CreateIndex
CREATE INDEX "sessions_contact_id_idx" ON "sessions"("contact_id");

-- CreateIndex
CREATE INDEX "sessions_agent_id_idx" ON "sessions"("agent_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
