/**
 * Read-only queries for the intelligence dashboard.
 *
 * Uses the `research_vertical_stats` materialized view for aggregated
 * coverage data (refreshed by the analyzer after each persisted analysis),
 * and direct Prisma queries for live counts and activity feeds.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────

/** One row from research_vertical_stats materialized view. */
export interface VerticalStats {
  verticalSlug: string;
  verticalName: string;
  targetCount: number;
  analysisCount: number;
  l1Count: number;
  l2Count: number;
  l3Count: number;
  l4Count: number;
  avgScore: number | null;
}

/** Top-performing target for a given vertical. */
export interface TopPerformer {
  targetId: string;
  targetName: string;
  company: string | null;
  verticalSlug: string;
  analysisId: string;
  scoreTotal: number;
  keyStrengths: string[];
  thingsToReplicate: string[];
  analyzedAt: Date;
}

/** A recent pipeline activity entry. */
export interface RecentActivityEntry {
  type: 'session_completed' | 'analysis_done';
  sessionId: string;
  targetName: string;
  verticalSlug: string;
  scriptName: string | null;
  level: string | null;
  scoreTotal: number | null;
  occurredAt: Date;
}

/** A pipeline suggestion based on coverage gaps. */
export interface CoverageSuggestion {
  verticalSlug: string;
  verticalName: string;
  level: 'L1' | 'L2' | 'L3' | 'L4';
  currentCount: number;
  message: string;
}

/** System-wide totals for the overview status bar. */
export interface SystemStats {
  activePhonesCount: number;
  totalTargetsCount: number;
  completedSessionsCount: number;
  totalAnalysesCount: number;
  approvedInsightsCount: number;
}

// ─── Repository interface ─────────────────────────────────────────

export interface IntelligenceStatsRepository {
  /** Live system-wide totals. */
  getSystemStats(): Promise<SystemStats>;
  /** All rows from the materialized view. */
  getAllVerticalStats(): Promise<VerticalStats[]>;
  /** Single row from the materialized view by slug. */
  getVerticalStat(slug: string): Promise<VerticalStats | null>;
  /** Top N targets by scoreTotal for a given vertical (best analysis per target). */
  getTopPerformers(verticalSlug: string, limit?: number): Promise<TopPerformer[]>;
  /** Most recent completed sessions + analyses (newest first). */
  getRecentActivity(limit?: number): Promise<RecentActivityEntry[]>;
  /** Verticals with thin coverage at any analysis level. */
  getCoverageGaps(): Promise<CoverageSuggestion[]>;
}

// ─── Raw row shapes from $queryRaw ───────────────────────────────

interface RawVerticalStats {
  vertical_slug: string;
  vertical_name: string;
  target_count: bigint;
  analysis_count: bigint;
  l1_count: bigint;
  l2_count: bigint;
  l3_count: bigint;
  l4_count: bigint;
  avg_score: number | null;
}

interface RawTopPerformer {
  target_id: string;
  target_name: string;
  company: string | null;
  vertical_slug: string;
  analysis_id: string;
  score_total: number;
  key_strengths: string[];
  things_to_replicate: string[];
  analyzed_at: Date;
}

interface RawActivity {
  session_id: string;
  target_name: string;
  vertical_slug: string;
  script_name: string | null;
  script_level: string | null;
  score_total: number | null;
  completed_at: Date;
  has_analysis: boolean;
}

// ─── Factory ─────────────────────────────────────────────────────

/** Minimum coverage count considered "good" per level. */
const GOOD_COVERAGE_THRESHOLD = 5;

function toNumber(v: bigint | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'bigint' ? Number(v) : v;
}

export function createIntelligenceStatsRepository(
  prisma: PrismaClient,
): IntelligenceStatsRepository {
  return {
    async getSystemStats() {
      const [activePhonesCount, totalTargetsCount, completedSessionsCount, totalAnalysesCount, approvedInsightsCount] =
        await Promise.all([
          prisma.researchPhone.count({ where: { status: 'active' } }),
          prisma.researchTarget.count({ where: { dsarDeletedAt: null } }),
          prisma.researchSession.count({ where: { status: 'completed' } }),
          prisma.researchAnalysis.count(),
          prisma.intelligenceInsight.count({ where: { status: 'approved' } }),
        ]);

      return {
        activePhonesCount,
        totalTargetsCount,
        completedSessionsCount,
        totalAnalysesCount,
        approvedInsightsCount,
      };
    },

    async getAllVerticalStats() {
      const rows = await prisma.$queryRaw<RawVerticalStats[]>(
        Prisma.sql`SELECT * FROM research_vertical_stats ORDER BY vertical_name ASC`,
      );

      return rows.map((r) => ({
        verticalSlug: r.vertical_slug,
        verticalName: r.vertical_name,
        targetCount: toNumber(r.target_count),
        analysisCount: toNumber(r.analysis_count),
        l1Count: toNumber(r.l1_count),
        l2Count: toNumber(r.l2_count),
        l3Count: toNumber(r.l3_count),
        l4Count: toNumber(r.l4_count),
        avgScore: r.avg_score !== null ? Number(r.avg_score) : null,
      }));
    },

    async getVerticalStat(slug) {
      const rows = await prisma.$queryRaw<RawVerticalStats[]>(
        Prisma.sql`SELECT * FROM research_vertical_stats WHERE vertical_slug = ${slug}`,
      );

      const r = rows[0];
      if (!r) return null;
      return {
        verticalSlug: r.vertical_slug,
        verticalName: r.vertical_name,
        targetCount: toNumber(r.target_count),
        analysisCount: toNumber(r.analysis_count),
        l1Count: toNumber(r.l1_count),
        l2Count: toNumber(r.l2_count),
        l3Count: toNumber(r.l3_count),
        l4Count: toNumber(r.l4_count),
        avgScore: r.avg_score !== null ? Number(r.avg_score) : null,
      };
    },

    async getTopPerformers(verticalSlug, limit = 3) {
      // Best score per target: pick the latest analysis with the highest scoreTotal.
      const rows = await prisma.$queryRaw<RawTopPerformer[]>(Prisma.sql`
        SELECT DISTINCT ON (t.id)
          t.id             AS target_id,
          t.name           AS target_name,
          t.company        AS company,
          t.vertical_slug  AS vertical_slug,
          a.id             AS analysis_id,
          a.score_total    AS score_total,
          a.key_strengths  AS key_strengths,
          a.things_to_replicate AS things_to_replicate,
          a.analyzed_at    AS analyzed_at
        FROM research_targets t
        JOIN research_sessions  s ON s.target_id = t.id AND s.status = 'completed'
        JOIN research_analyses  a ON a.session_id = s.id AND a.score_total IS NOT NULL
        WHERE t.vertical_slug = ${verticalSlug}
          AND t.dsar_deleted_at IS NULL
        ORDER BY t.id, a.score_total DESC, a.analyzed_at DESC
      `);

      // Sort the distinct-per-target results by score and take top N
      return rows
        .sort((a, b) => b.score_total - a.score_total)
        .slice(0, limit)
        .map((r) => ({
          targetId: r.target_id,
          targetName: r.target_name,
          company: r.company,
          verticalSlug: r.vertical_slug,
          analysisId: r.analysis_id,
          scoreTotal: Number(r.score_total),
          keyStrengths: Array.isArray(r.key_strengths) ? r.key_strengths : [],
          thingsToReplicate: Array.isArray(r.things_to_replicate) ? r.things_to_replicate : [],
          analyzedAt: r.analyzed_at,
        }));
    },

    async getRecentActivity(limit = 20) {
      const rows = await prisma.$queryRaw<RawActivity[]>(Prisma.sql`
        SELECT
          s.id               AS session_id,
          t.name             AS target_name,
          t.vertical_slug    AS vertical_slug,
          ps.name            AS script_name,
          ps.level::text     AS script_level,
          a.score_total      AS score_total,
          s.completed_at     AS completed_at,
          (a.id IS NOT NULL) AS has_analysis
        FROM research_sessions s
        JOIN research_targets t  ON t.id = s.target_id
        JOIN probe_scripts    ps ON ps.id = s.script_id
        LEFT JOIN research_analyses a ON a.session_id = s.id
        WHERE s.status = 'completed' AND s.completed_at IS NOT NULL
        ORDER BY s.completed_at DESC
        LIMIT ${limit}
      `);

      return rows.map((r) => ({
        type: (r.has_analysis ? 'analysis_done' : 'session_completed') as RecentActivityEntry['type'],
        sessionId: r.session_id,
        targetName: r.target_name,
        verticalSlug: r.vertical_slug,
        scriptName: r.script_name,
        level: r.script_level,
        scoreTotal: r.score_total !== null ? Number(r.score_total) : null,
        occurredAt: r.completed_at,
      }));
    },

    async getCoverageGaps() {
      const allStats = await this.getAllVerticalStats();
      const suggestions: CoverageSuggestion[] = [];

      const levels: Array<{ key: keyof Pick<VerticalStats, 'l1Count' | 'l2Count' | 'l3Count' | 'l4Count'>; label: 'L1' | 'L2' | 'L3' | 'L4' }> = [
        { key: 'l1Count', label: 'L1' },
        { key: 'l2Count', label: 'L2' },
        { key: 'l3Count', label: 'L3' },
        { key: 'l4Count', label: 'L4' },
      ];

      for (const stat of allStats) {
        for (const { key, label } of levels) {
          const count = stat[key];
          if (count < GOOD_COVERAGE_THRESHOLD) {
            const needed = GOOD_COVERAGE_THRESHOLD - count;
            suggestions.push({
              verticalSlug: stat.verticalSlug,
              verticalName: stat.verticalName,
              level: label,
              currentCount: count,
              message:
                count === 0
                  ? `${stat.verticalName} no tiene análisis ${label}. Crear ${needed} sesión${needed > 1 ? 'es' : ''} para comenzar.`
                  : `${stat.verticalName} tiene ${count} análisis ${label}. Agregar ${needed} más para buena cobertura.`,
            });
          }
        }
      }

      // Sort: verticals with 0 coverage first, then by level
      return suggestions.sort((a, b) => a.currentCount - b.currentCount);
    },
  };
}
