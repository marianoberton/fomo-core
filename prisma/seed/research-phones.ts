/**
 * Seed entry-point for ResearchPhone placeholders.
 *
 * Owner of this file: Claude #1 (WAHA + Phone Manager track).
 *
 * Phones are NOT seeded with phone numbers — those come from real SIM
 * pairings via the dashboard QR flow. This stub is reserved in case we
 * want to seed the 20 `label`s ("phone-01"…"phone-20") with status=pending
 * to make the UI grid visible from day 1.
 */
import type { PrismaClient } from '@prisma/client';

export async function seedResearchPhones(prisma: PrismaClient): Promise<void> {
  void prisma;
  console.log('  [research] seedResearchPhones — stub, nothing seeded');
}
