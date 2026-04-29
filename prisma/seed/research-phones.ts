/**
 * Seeds 20 ResearchPhone label placeholders ("phone-01" … "phone-20").
 *
 * Phones are seeded with status=pending and NO real phone numbers — those
 * come from actual SIM pairings via the dashboard QR flow. Seeding the
 * labels pre-populates the UI grid so Fomo can see all 20 slots from day 1
 * and know which ones still need a QR scan.
 *
 * Idempotent: uses upsert keyed on `label`. Safe to re-run.
 */
import type { PrismaClient } from '@prisma/client';

const PHONE_COUNT = 20;

export async function seedResearchPhones(prisma: PrismaClient): Promise<void> {
  const labels = Array.from({ length: PHONE_COUNT }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return { label: `phone-${n}`, wahaSession: `phone-${n}` };
  });

  let upserted = 0;

  for (const { label, wahaSession } of labels) {
    await prisma.researchPhone.upsert({
      where: { label },
      create: {
        label,
        wahaSession,
        notes: 'Pre-seeded slot — connect via dashboard QR flow',
        createdBy: 'seed',
      },
      update: {}, // never overwrite existing data (e.g. real phoneNumber)
    });
    upserted++;
  }

  console.log(`  [research] seedResearchPhones — ${upserted} phones upserted (phone-01 … phone-${String(PHONE_COUNT).padStart(2, '0')})`);
}
