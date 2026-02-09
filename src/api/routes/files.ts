/**
 * File routes — upload, download, and manage files.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { ProjectId } from '@/core/types.js';

// ─── Schemas ────────────────────────────────────────────────────

const uploadQuerySchema = z.object({
  projectId: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().optional(),
  expiresIn: z.string().transform(Number).optional(), // seconds until expiry
});

const listQuerySchema = z.object({
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});

// ─── Route Registration ─────────────────────────────────────────

export function fileRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { fileService, fileRepository, logger } = deps;

  // ─── Upload File ────────────────────────────────────────────────

  fastify.post(
    '/files/upload',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = uploadQuerySchema.safeParse(request.query);

      if (!query.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: query.error.flatten(),
        });
      }

      const { projectId, filename, mimeType, expiresIn } = query.data;

      // Get raw body as buffer
      const content = request.body as Buffer | undefined;

      if (!content || content.length === 0) {
        return reply.status(400).send({ error: 'Empty file body' });
      }

      // Determine MIME type
      const resolvedMimeType = mimeType ?? 
        request.headers['content-type'] ?? 
        'application/octet-stream';

      // Calculate expiry if specified
      const expiresAt = expiresIn 
        ? new Date(Date.now() + expiresIn * 1000)
        : undefined;

      const file = await fileService.upload({
        projectId: projectId as ProjectId,
        filename,
        mimeType: resolvedMimeType,
        content,
        expiresAt,
      });

      logger.info('File uploaded via API', {
        component: 'files-route',
        fileId: file.id,
        projectId,
        filename,
        sizeBytes: file.sizeBytes,
      });

      return reply.status(201).send({ file });
    },
  );

  // ─── Download File ──────────────────────────────────────────────

  fastify.get(
    '/files/:fileId/download',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };

      try {
        const { file, content } = await fileService.download(fileId);

        return await reply
          .header('Content-Type', file.mimeType)
          .header('Content-Disposition', `attachment; filename="${file.originalFilename}"`)
          .header('Content-Length', file.sizeBytes)
          .send(content);
      } catch (error) {
        if ((error as Error).message.includes('not found')) {
          return reply.status(404).send({ error: 'File not found' });
        }
        throw error;
      }
    },
  );

  // ─── Get File Metadata ──────────────────────────────────────────

  fastify.get(
    '/files/:fileId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };

      const file = await fileService.getById(fileId);

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      return reply.send({ file });
    },
  );

  // ─── Get Temporary URL ──────────────────────────────────────────

  fastify.get(
    '/files/:fileId/url',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };
      const { expiresIn } = request.query as { expiresIn?: string };

      const expiresInSeconds = expiresIn ? Number(expiresIn) : 3600;

      const url = await fileService.getTemporaryUrl(fileId, expiresInSeconds);

      if (!url) {
        return reply.status(404).send({ error: 'File not found or URL not available' });
      }

      return reply.send({ url, expiresIn: expiresInSeconds });
    },
  );

  // ─── List Files by Project ──────────────────────────────────────

  fastify.get(
    '/projects/:projectId/files',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const query = listQuerySchema.parse(request.query);

      const files = await fileRepository.findByProject(projectId as ProjectId, {
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send({ files });
    },
  );

  // ─── Delete File ────────────────────────────────────────────────

  fastify.delete(
    '/files/:fileId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileId } = request.params as { fileId: string };

      try {
        await fileService.delete(fileId);

        logger.info('File deleted via API', {
          component: 'files-route',
          fileId,
        });

        return await reply.status(204).send();
      } catch (error) {
        if ((error as Error).message.includes('not found')) {
          return reply.status(404).send({ error: 'File not found' });
        }
        throw error;
      }
    },
  );
}
