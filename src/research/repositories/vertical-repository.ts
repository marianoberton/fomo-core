/**
 * ResearchVertical repository — CRUD over `research_verticals`.
 *
 * Verticals are global (no projectId). They define the industry
 * segments under which targets, scripts, and analyses are organised.
 */
import type { PrismaClient, ResearchVertical } from '@prisma/client';
// Value import required — Prisma.InputJsonValue is a runtime type alias
import { Prisma } from '@prisma/client';
import type { ScoringRubric } from '../types.js';

// ─── Input types ─────────────────────────────────────────────────

export interface CreateVerticalInput {
  slug: string;
  name: string;
  description?: string;
  scoringRubric: ScoringRubric;
  analysisInstructions: string;
  createdBy?: string;
}

export interface UpdateVerticalInput {
  name?: string;
  description?: string;
  scoringRubric?: ScoringRubric;
  analysisInstructions?: string;
  updatedBy?: string;
}

// ─── Interface ───────────────────────────────────────────────────

export interface ResearchVerticalRepository {
  /**
   * Create a new vertical. `slug` must be unique — Prisma throws on
   * duplicate (let the caller handle the unique constraint error).
   */
  create(data: CreateVerticalInput): Promise<ResearchVertical>;

  /** Return all verticals ordered by name (active and inactive). */
  findAll(): Promise<ResearchVertical[]>;

  /** Find one by slug. Returns `null` if not found. */
  findBySlug(slug: string): Promise<ResearchVertical | null>;

  /** Update editable fields by slug. Throws if not found. */
  update(slug: string, data: UpdateVerticalInput): Promise<ResearchVertical>;

  /** Set `isActive = true`. Idempotent. */
  activate(slug: string, updatedBy?: string): Promise<ResearchVertical>;

  /** Set `isActive = false`. Idempotent. */
  deactivate(slug: string, updatedBy?: string): Promise<ResearchVertical>;
}

/** Cast a typed object to Prisma's Json input type. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

// ─── Factory ─────────────────────────────────────────────────────

/** Create a Prisma-backed ResearchVerticalRepository. */
export function createResearchVerticalRepository(
  prisma: PrismaClient,
): ResearchVerticalRepository {
  return {
    async create(data) {
      return await prisma.researchVertical.create({
        data: {
          slug: data.slug,
          name: data.name,
          description: data.description,
          scoringRubric: toJson(data.scoringRubric),
          analysisInstructions: data.analysisInstructions,
          createdBy: data.createdBy,
        },
      });
    },

    async findAll() {
      return await prisma.researchVertical.findMany({
        orderBy: { name: 'asc' },
      });
    },

    async findBySlug(slug) {
      return await prisma.researchVertical.findUnique({
        where: { slug },
      });
    },

    async update(slug, data) {
      return await prisma.researchVertical.update({
        where: { slug },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.scoringRubric !== undefined && {
            scoringRubric: toJson(data.scoringRubric),
          }),
          ...(data.analysisInstructions !== undefined && {
            analysisInstructions: data.analysisInstructions,
          }),
          ...(data.updatedBy !== undefined && { updatedBy: data.updatedBy }),
        },
      });
    },

    async activate(slug, updatedBy) {
      return await prisma.researchVertical.update({
        where: { slug },
        data: { isActive: true, updatedBy },
      });
    },

    async deactivate(slug, updatedBy) {
      return await prisma.researchVertical.update({
        where: { slug },
        data: { isActive: false, updatedBy },
      });
    },
  };
}
