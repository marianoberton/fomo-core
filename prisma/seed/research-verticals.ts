/**
 * Seed entry-point for ResearchVertical rows.
 *
 * Owner of this file: Claude #2 (Targets + Verticals + Compliance track).
 * Until that track lands, this is a no-op so `pnpm db:seed` keeps working.
 *
 * Expected final shape (see NEXUS_INTELLIGENCE_PLAN.md §1.1):
 *   - 10 verticals with scoringRubric + analysisInstructions
 *   - Idempotent via `slug` UNIQUE + `skipDuplicates: true`
 *   - All weights inside each rubric must sum to 1.0
 */
import type { PrismaClient } from '@prisma/client';

export async function seedResearchVerticals(prisma: PrismaClient): Promise<void> {
  // Stub — Claude #2 fills this in.
  // Avoids unused-vars lint while keeping the signature stable for callers.
  void prisma;
  console.log('  [research] seedResearchVerticals — stub, nothing seeded');
}
