import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ApprovalId, ProjectId, SessionId, ToolCallId } from '@/core/types.js';
import type { ApprovalRequest } from './types.js';
import { createPrismaApprovalStore } from './prisma-approval-store.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'appr_1' as ApprovalId,
    projectId: PROJECT_ID,
    sessionId: 'sess_1' as SessionId,
    toolCallId: 'tc_1' as ToolCallId,
    toolId: 'dangerous-tool',
    toolInput: { target: 'db' },
    riskLevel: 'high',
    status: 'pending',
    requestedAt: new Date('2025-01-01T00:00:00Z'),
    expiresAt: new Date('2025-01-01T00:05:00Z'),
    ...overrides,
  };
}

const makePrismaRecord = (request: ApprovalRequest): Record<string, unknown> => {
  return {
    id: request.id,
    projectId: request.projectId,
    sessionId: request.sessionId,
    toolCallId: request.toolCallId,
    toolId: request.toolId,
    toolInput: request.toolInput,
    riskLevel: request.riskLevel,
    status: request.status,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    resolvedAt: request.resolvedAt ?? null,
    resolvedBy: request.resolvedBy ?? null,
    resolutionNote: request.resolutionNote ?? null,
  };
};

function createMockPrisma(): PrismaClient {
  return {
    approvalRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('PrismaApprovalStore', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates an approval request via Prisma', async () => {
      vi.mocked(mockPrisma.approvalRequest.create).mockResolvedValue({} as never);

      const store = createPrismaApprovalStore(mockPrisma);
      const request = makeRequest();
      await store.create(request);

       
      expect(mockPrisma.approvalRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: request.id,
          projectId: PROJECT_ID,
          toolId: 'dangerous-tool',
          status: 'pending',
        }) as unknown,
      });
    });
  });

  describe('get', () => {
    it('returns an approval request by ID', async () => {
      const request = makeRequest();
      vi.mocked(mockPrisma.approvalRequest.findUnique).mockResolvedValue(
        makePrismaRecord(request) as never,
      );

      const store = createPrismaApprovalStore(mockPrisma);
      const result = await store.get('appr_1' as ApprovalId);

      expect(result).toBeDefined();
      expect(result?.id).toBe('appr_1');
      expect(result?.toolId).toBe('dangerous-tool');
      expect(result?.status).toBe('pending');
    });

    it('returns undefined when not found', async () => {
      vi.mocked(mockPrisma.approvalRequest.findUnique).mockResolvedValue(null as never);

      const store = createPrismaApprovalStore(mockPrisma);
      const result = await store.get('nope' as ApprovalId);

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates an approval request', async () => {
      const request = makeRequest({ status: 'approved', resolvedBy: 'admin' });
      vi.mocked(mockPrisma.approvalRequest.update).mockResolvedValue(
        makePrismaRecord(request) as never,
      );

      const store = createPrismaApprovalStore(mockPrisma);
      const result = await store.update('appr_1' as ApprovalId, {
        status: 'approved',
        resolvedBy: 'admin',
      });

      expect(result).toBeDefined();
      expect(result?.status).toBe('approved');
       
      expect(mockPrisma.approvalRequest.update).toHaveBeenCalledWith({
        where: { id: 'appr_1' },
        data: expect.objectContaining({
          status: 'approved',
          resolvedBy: 'admin',
        }) as unknown,
      });
    });

    it('returns null when record not found', async () => {
      vi.mocked(mockPrisma.approvalRequest.update).mockRejectedValue(
        new Error('Record not found'),
      );

      const store = createPrismaApprovalStore(mockPrisma);
      const result = await store.update('nope' as ApprovalId, { status: 'approved' });

      expect(result).toBeNull();
    });
  });

  describe('listPending', () => {
    it('returns pending approvals for a project', async () => {
      const requests = [makeRequest(), makeRequest({ id: 'appr_2' as ApprovalId, toolId: 'other-tool' })];
      vi.mocked(mockPrisma.approvalRequest.findMany).mockResolvedValue(
        requests.map(makePrismaRecord) as never,
      );

      const store = createPrismaApprovalStore(mockPrisma);
      const result = await store.listPending(PROJECT_ID);

      expect(result).toHaveLength(2);
       
      expect(mockPrisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID, status: 'pending' },
        orderBy: { requestedAt: 'desc' },
      });
    });

    it('returns empty array when no pending approvals', async () => {
      vi.mocked(mockPrisma.approvalRequest.findMany).mockResolvedValue([] as never);

      const store = createPrismaApprovalStore(mockPrisma);
      const result = await store.listPending(PROJECT_ID);

      expect(result).toHaveLength(0);
    });
  });
});
