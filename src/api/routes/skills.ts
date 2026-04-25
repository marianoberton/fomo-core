/**
 * Skill routes — templates, instances, and agent assignment.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDependencies } from '../types.js';
import type { AgentId } from '@/agents/types.js';
import { sendSuccess, sendNotFound, sendError } from '../error-handler.js';
import { requireProjectRole } from '../auth-middleware.js';

// ─── Schemas ────────────────────────────────────────────────────

const createInstanceSchema = z.object({
  templateId: z.string().optional(),
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  instructionsFragment: z.string().min(1),
  requiredTools: z.array(z.string()).optional(),
  requiredMcpServers: z.array(z.string()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const createFromTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const updateInstanceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  instructionsFragment: z.string().min(1).optional(),
  requiredTools: z.array(z.string()).optional(),
  requiredMcpServers: z.array(z.string()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const assignSkillsSchema = z.object({
  skillIds: z.array(z.string()),
});

// ─── Route Registration ─────────────────────────────────────────

export function skillRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const { skillService, agentRepository, agentRegistry, logger, memberRepository } = deps;
  const rbacOperator = requireProjectRole('operator', { memberRepository, logger });

  // ─── Skill Templates (Global) ─────────────────────────────────

  fastify.get(
    '/skill-templates',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = z.object({
        category: z.enum(['sales', 'support', 'operations', 'communication']).optional(),
      }).parse(request.query);

      const templates = await skillService.listTemplates(query.category);
      await sendSuccess(reply, templates); return;
    },
  );

  fastify.get(
    '/skill-templates/:templateId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { templateId } = request.params as { templateId: string };
      const template = await skillService.getTemplate(templateId);

      if (!template) {
        return sendNotFound(reply, 'SkillTemplate', templateId);
      }

      await sendSuccess(reply, template); return;
    },
  );

  // ─── Skill Instances (Per-Project) ────────────────────────────

  fastify.get(
    '/projects/:projectId/skills',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const instances = await skillService.listInstances(projectId);
      await sendSuccess(reply, instances); return;
    },
  );

  fastify.get(
    '/projects/:projectId/skills/:skillId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { projectId: string; skillId: string };
      const instance = await skillService.getInstance(skillId);

      if (!instance) {
        return sendNotFound(reply, 'SkillInstance', skillId);
      }

      await sendSuccess(reply, instance); return;
    },
  );

  fastify.post(
    '/projects/:projectId/skills',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createInstanceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await skillService.createInstance({
          projectId,
          ...parseResult.data,
        });
        logger.info('Skill instance created', { component: 'skills', instanceId: instance.id, projectId });
        await sendSuccess(reply, instance, 201); return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(reply, 'CONFLICT', 'Skill with this name already exists in the project', 409);
        }
        throw error;
      }
    },
  );

  fastify.post(
    '/projects/:projectId/skills/from-template',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { projectId } = request.params as { projectId: string };
      const parseResult = createFromTemplateSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await skillService.createFromTemplate(
          projectId,
          parseResult.data.templateId,
          {
            name: parseResult.data.name,
            displayName: parseResult.data.displayName,
            description: parseResult.data.description,
            parameters: parseResult.data.parameters,
          },
        );
        logger.info('Skill instance created from template', {
          component: 'skills',
          instanceId: instance.id,
          projectId,
          templateId: parseResult.data.templateId,
        });
        await sendSuccess(reply, instance, 201); return;
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          return sendError(reply, 'NOT_FOUND', error.message, 404);
        }
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          return sendError(reply, 'CONFLICT', 'Skill with this name already exists in the project', 409);
        }
        throw error;
      }
    },
  );

  fastify.patch(
    '/projects/:projectId/skills/:skillId',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { projectId: string; skillId: string };
      const parseResult = updateInstanceSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const instance = await skillService.updateInstance(skillId, parseResult.data);
        logger.info('Skill instance updated', { component: 'skills', instanceId: skillId });
        await sendSuccess(reply, instance); return;
      } catch {
        return sendNotFound(reply, 'SkillInstance', skillId);
      }
    },
  );

  fastify.delete(
    '/projects/:projectId/skills/:skillId',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { skillId } = request.params as { projectId: string; skillId: string };

      try {
        await skillService.deleteInstance(skillId);
        logger.info('Skill instance deleted', { component: 'skills', instanceId: skillId });
        return await reply.status(204).send();
      } catch {
        return reply.status(404).send({ error: 'Skill instance not found' });
      }
    },
  );

  // ─── Agent Skill Assignment ───────────────────────────────────

  fastify.get(
    '/projects/:projectId/agents/:agentId/skills',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };

      const agent = await agentRegistry.get(agentId as AgentId);
      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      // Return the full skill instances for the agent's assigned skills
      const composition = await skillService.composeForAgent(agent.skillIds);
      const instances = agent.skillIds.length > 0
        ? await Promise.all(
            agent.skillIds.map((id) => skillService.getInstance(id)),
          )
        : [];

      await sendSuccess(reply, {
        skills: instances.filter(Boolean),
        composition,
      }); return;
    },
  );

  fastify.post(
    '/projects/:projectId/agents/:agentId/skills',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { projectId: string; agentId: string };
      const parseResult = assignSkillsSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.flatten(),
        });
      }

      try {
        const agent = await agentRepository.update(
          agentId as AgentId,
          { skillIds: parseResult.data.skillIds },
        );
        agentRegistry.invalidate(agentId as AgentId);
        logger.info('Agent skills updated', {
          component: 'skills',
          agentId,
          skillCount: parseResult.data.skillIds.length,
        });
        await sendSuccess(reply, agent); return;
      } catch {
        return sendNotFound(reply, 'Agent', agentId);
      }
    },
  );

  fastify.delete(
    '/projects/:projectId/agents/:agentId/skills/:skillId',
    { preHandler: rbacOperator },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId, skillId } = request.params as { projectId: string; agentId: string; skillId: string };

      const agent = await agentRegistry.get(agentId as AgentId);
      if (!agent) {
        return sendNotFound(reply, 'Agent', agentId);
      }

      const updatedSkillIds = agent.skillIds.filter((id) => id !== skillId);
      await agentRepository.update(agentId as AgentId, { skillIds: updatedSkillIds });
      agentRegistry.invalidate(agentId as AgentId);

      logger.info('Skill unassigned from agent', { component: 'skills', agentId, skillId });
      return await reply.status(204).send();
    },
  );
}
