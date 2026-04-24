-- Migration: Campaign lifecycle — statuses + timestamps
-- Track D — A4
--
-- ALTER TYPE ... ADD VALUE cannot run inside a BEGIN/COMMIT that also uses
-- the new value. Prisma runs each statement in its own implicit transaction
-- so `IF NOT EXISTS` + a statement-per-line works on PG 12+.

-- 1. CampaignStatus — add 'cancelled' (paused already exists)
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- 2. CampaignSendStatus — add 'delivered' and 'unsubscribed'
ALTER TYPE "CampaignSendStatus" ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE "CampaignSendStatus" ADD VALUE IF NOT EXISTS 'unsubscribed';

-- 3. Campaign lifecycle timestamps
ALTER TABLE "campaigns" ADD COLUMN "paused_at" TIMESTAMP(3);
ALTER TABLE "campaigns" ADD COLUMN "resumed_at" TIMESTAMP(3);
ALTER TABLE "campaigns" ADD COLUMN "cancelled_at" TIMESTAMP(3);

-- 4. CampaignSend delivery / opt-out timestamps
ALTER TABLE "campaign_sends" ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "campaign_sends" ADD COLUMN "unsubscribed_at" TIMESTAMP(3);
