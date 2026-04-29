/**
 * Seed entry-point for ProbeScript rows.
 *
 * Owner of this file: Claude #3 (Probe Script Library track).
 * Until that track lands, this is a no-op so `pnpm db:seed` keeps working.
 *
 * Expected final shape (see NEXUS_INTELLIGENCE_PLAN.md §2):
 *   - 2 universal L1 scripts
 *   - 3 L2 scripts per active vertical (~30 total)
 *   - 3 universal L3 scripts (llm-detection, rag-probe, tool-latency)
 *   - 3 universal L4 scripts (prompt-injection, consistency, edge-cases)
 *   - All marked isOfficial: true
 *   - Idempotent via @@unique([verticalSlug, name])
 *
 * Depends on: ResearchVertical rows already seeded — call this AFTER
 * seedResearchVerticals().
 */
import type { PrismaClient } from '@prisma/client';

export async function seedResearchScripts(prisma: PrismaClient): Promise<void> {
  void prisma;
  console.log('  [research] seedResearchScripts — stub, nothing seeded');
}
