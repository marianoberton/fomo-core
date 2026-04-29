/**
 * CRUD over `research_phones` — one row per physical SIM / WAHA session.
 */
import type { PrismaClient, ResearchPhone, ResearchPhoneStatus } from '@prisma/client';
import type { ResearchPhoneId } from '../types.js';

// ─── Input / output types ─────────────────────────────────────────────

export interface CreatePhoneInput {
  label: string;
  wahaSession: string;
  notes?: string;
  createdBy?: string;
}

export interface UpdatePhoneStatusInput {
  status: ResearchPhoneStatus;
  phoneNumber?: string;
}

// ─── Interface ───────────────────────────────────────────────────────

export interface ResearchPhoneRepository {
  create(data: CreatePhoneInput): Promise<ResearchPhone>;
  findAll(): Promise<ResearchPhone[]>;
  findById(id: ResearchPhoneId): Promise<ResearchPhone | null>;
  findBySession(wahaSession: string): Promise<ResearchPhone | null>;
  updateStatus(id: ResearchPhoneId, update: UpdatePhoneStatusInput): Promise<ResearchPhone>;
  updateLastSeen(id: ResearchPhoneId): Promise<void>;
  delete(id: ResearchPhoneId): Promise<void>;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createResearchPhoneRepository(prisma: PrismaClient): ResearchPhoneRepository {
  async function create(data: CreatePhoneInput): Promise<ResearchPhone> {
    return prisma.researchPhone.create({
      data: {
        label: data.label,
        wahaSession: data.wahaSession,
        notes: data.notes,
        createdBy: data.createdBy,
      },
    });
  }

  async function findAll(): Promise<ResearchPhone[]> {
    return prisma.researchPhone.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async function findById(id: ResearchPhoneId): Promise<ResearchPhone | null> {
    return prisma.researchPhone.findUnique({ where: { id } });
  }

  async function findBySession(wahaSession: string): Promise<ResearchPhone | null> {
    return prisma.researchPhone.findUnique({ where: { wahaSession } });
  }

  async function updateStatus(id: ResearchPhoneId, update: UpdatePhoneStatusInput): Promise<ResearchPhone> {
    const data: Parameters<typeof prisma.researchPhone.update>[0]['data'] = {
      status: update.status,
    };
    if (update.phoneNumber !== undefined) {
      data['phoneNumber'] = update.phoneNumber;
    }
    if (update.status === 'banned') {
      data['bannedAt'] = new Date();
    }
    return prisma.researchPhone.update({ where: { id }, data });
  }

  async function updateLastSeen(id: ResearchPhoneId): Promise<void> {
    await prisma.researchPhone.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    });
  }

  async function deletePhone(id: ResearchPhoneId): Promise<void> {
    await prisma.researchPhone.delete({ where: { id } });
  }

  return {
    create,
    findAll,
    findById,
    findBySession,
    updateStatus,
    updateLastSeen,
    delete: deletePhone,
  };
}
