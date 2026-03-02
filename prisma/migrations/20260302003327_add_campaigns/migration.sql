-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "CampaignSendStatus" AS ENUM ('queued', 'sent', 'failed');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "template" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "audience_filter" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_sends" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "status" "CampaignSendStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_project_id_status_idx" ON "campaigns"("project_id", "status");

-- CreateIndex
CREATE INDEX "campaign_sends_campaign_id_status_idx" ON "campaign_sends"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_sends_contact_id_idx" ON "campaign_sends"("contact_id");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
