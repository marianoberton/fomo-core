-- Fix pre-existing drift: 'replied' and 'converted' were added to
-- schema.prisma but never migrated to production DB. Without this,
-- prisma.campaignSend.update({ status: 'replied' }) fails with
-- invalid enum value when the reply-tracker runs.
ALTER TYPE "CampaignSendStatus" ADD VALUE IF NOT EXISTS 'replied';
ALTER TYPE "CampaignSendStatus" ADD VALUE IF NOT EXISTS 'converted';
