-- AlterTable: add variantId to campaign_sends for A/B testing
ALTER TABLE "campaign_sends" ADD COLUMN "variant_id" TEXT;

-- CreateIndex
CREATE INDEX "campaign_sends_campaign_id_variant_id_idx" ON "campaign_sends"("campaign_id", "variant_id");
