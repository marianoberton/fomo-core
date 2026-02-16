-- CreateTable
CREATE TABLE IF NOT EXISTS "channel_integrations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "channel_integrations_project_id_provider_key" ON "channel_integrations"("project_id", "provider");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_integrations_provider_status_idx" ON "channel_integrations"("provider", "status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_integrations_project_id_fkey'
  ) THEN
    ALTER TABLE "channel_integrations"
      ADD CONSTRAINT "channel_integrations_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
