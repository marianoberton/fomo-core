import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { ProjectId } from '@/core/types.js';
import { createContactRepository } from './contact-repository.js';

const PROJECT_ID = 'proj_test' as ProjectId;

function makeContactRecord(overrides?: Record<string, unknown>) {
  return {
    id: 'contact_abc',
    projectId: PROJECT_ID,
    name: 'John Doe',
    displayName: 'Johnny',
    phone: '+1234567890',
    email: 'john@example.com',
    telegramId: '123456',
    slackId: 'U123456',
    timezone: 'America/New_York',
    language: 'en',
    metadata: { source: 'web' },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function createMockPrisma() {
  return {
    contact: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('ContactRepository', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates a contact with all fields', async () => {
      vi.mocked(mockPrisma.contact.create).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.create({
        projectId: PROJECT_ID,
        name: 'John Doe',
        phone: '+1234567890',
      });

      expect(contact.id).toBe('contact_abc');
      expect(contact.name).toBe('John Doe');
      expect(contact.phone).toBe('+1234567890');
      expect(mockPrisma.contact.create).toHaveBeenCalledOnce();
    });

    it('creates a contact with minimal fields', async () => {
      vi.mocked(mockPrisma.contact.create).mockResolvedValue(
        makeContactRecord({ phone: null, email: null }) as never
      );

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.create({
        projectId: PROJECT_ID,
        name: 'Jane Doe',
      });

      expect(contact.name).toBe('John Doe');
    });
  });

  describe('findById', () => {
    it('returns contact when found', async () => {
      vi.mocked(mockPrisma.contact.findUnique).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.findById('contact_abc');

      expect(contact?.id).toBe('contact_abc');
      expect(contact?.name).toBe('John Doe');
    });

    it('returns null when not found', async () => {
      vi.mocked(mockPrisma.contact.findUnique).mockResolvedValue(null as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.findById('nonexistent');

      expect(contact).toBeNull();
    });
  });

  describe('findByChannel', () => {
    it('finds contact by phone', async () => {
      vi.mocked(mockPrisma.contact.findUnique).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.findByChannel(PROJECT_ID, {
        type: 'phone',
        value: '+1234567890',
      });

      expect(contact?.phone).toBe('+1234567890');
      expect(mockPrisma.contact.findUnique).toHaveBeenCalledWith({
        where: { projectId_phone: { projectId: PROJECT_ID, phone: '+1234567890' } },
      });
    });

    it('finds contact by telegramId', async () => {
      vi.mocked(mockPrisma.contact.findUnique).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.findByChannel(PROJECT_ID, {
        type: 'telegramId',
        value: '123456',
      });

      expect(contact?.telegramId).toBe('123456');
    });

    it('finds contact by email', async () => {
      vi.mocked(mockPrisma.contact.findUnique).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.findByChannel(PROJECT_ID, {
        type: 'email',
        value: 'john@example.com',
      });

      expect(contact?.email).toBe('john@example.com');
    });

    it('finds contact by slackId', async () => {
      vi.mocked(mockPrisma.contact.findUnique).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.findByChannel(PROJECT_ID, {
        type: 'slackId',
        value: 'U123456',
      });

      expect(contact?.slackId).toBe('U123456');
    });
  });

  describe('update', () => {
    it('updates contact fields', async () => {
      vi.mocked(mockPrisma.contact.update).mockResolvedValue(
        makeContactRecord({ name: 'John Updated' }) as never
      );

      const repo = createContactRepository(mockPrisma);
      const contact = await repo.update('contact_abc', { name: 'John Updated' });

      expect(contact.name).toBe('John Updated');
      expect(mockPrisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'contact_abc' },
        data: { name: 'John Updated' },
      });
    });
  });

  describe('delete', () => {
    it('deletes a contact', async () => {
      vi.mocked(mockPrisma.contact.delete).mockResolvedValue(makeContactRecord() as never);

      const repo = createContactRepository(mockPrisma);
      await repo.delete('contact_abc');

      expect(mockPrisma.contact.delete).toHaveBeenCalledWith({
        where: { id: 'contact_abc' },
      });
    });
  });

  describe('list', () => {
    it('lists contacts by project', async () => {
      vi.mocked(mockPrisma.contact.findMany).mockResolvedValue([
        makeContactRecord(),
        makeContactRecord({ id: 'contact_def', name: 'Jane Doe' }),
      ] as never);

      const repo = createContactRepository(mockPrisma);
      const contacts = await repo.list(PROJECT_ID);

      expect(contacts).toHaveLength(2);
      expect(contacts[0].name).toBe('John Doe');
    });

    it('respects limit and offset', async () => {
      vi.mocked(mockPrisma.contact.findMany).mockResolvedValue([makeContactRecord()] as never);

      const repo = createContactRepository(mockPrisma);
      await repo.list(PROJECT_ID, { limit: 10, offset: 5 });

      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith({
        where: { projectId: PROJECT_ID },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 5,
      });
    });
  });
});
