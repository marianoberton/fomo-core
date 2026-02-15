/**
 * Templates API Routes
 * Endpoints for listing and creating projects from vertical templates
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TemplateManager } from '@/templates/index.js';
import type { RouteDependencies } from '../types.js';
import { sendSuccess, sendError, sendNotFound } from '../error-handler.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'api:templates' });

// ─── Schemas ───────────────────────────────────────────────────

const createFromTemplateSchema = z.object({
  projectName: z.string().min(1).max(100, 'Project name must be 1-100 characters'),
  projectDescription: z.string().max(500).optional(),
  environment: z.enum(['production', 'staging', 'development']).default('development'),
  owner: z.string().min(1, 'Owner is required'),
  tags: z.array(z.string()).optional(),
  provider: z.object({
    provider: z.enum(['anthropic', 'openai', 'google', 'ollama']),
    model: z.string().min(1, 'Model is required'),
    temperature: z.number().min(0).max(2).optional(),
    apiKeyEnvVar: z.string().optional(),
  }),
  includeSampleData: z.boolean().default(false),
});

const updatePromptsFromTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  updatedBy: z.string().min(1, 'updatedBy is required'),
});

// ─── Routes ────────────────────────────────────────────────────

/** Register template routes. */
export function templateRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies,
): void {
  const templateManager = new TemplateManager(deps.prisma);

  /**
   * GET /templates
   * List all available vertical templates
   */
  fastify.get('/templates', async (_request, reply) => {
    logger.debug('Listing available templates', { component: 'api:templates' });

    const templates = templateManager.listTemplates();

    return sendSuccess(reply, { templates });
  });

  /**
   * GET /templates/:templateId
   * Get a specific template by ID (without sample data)
   */
  fastify.get<{
    Params: { templateId: string };
  }>('/templates/:templateId', async (request, reply) => {
    const { templateId } = request.params;

    logger.debug('Getting template details', {
      component: 'api:templates',
      templateId,
    });

    const template = templateManager.getTemplate(templateId);
    
    if (!template) {
      return sendNotFound(reply, 'Template', templateId);
    }

    return sendSuccess(reply, {
      id: template.id,
      name: template.name,
      description: template.description,
      allowedTools: template.agentConfig.allowedTools || [],
      agentRole: template.agentConfig.agentRole,
    });
  });

  /**
   * POST /templates/:templateId/create-project
   * Create a new project from a template
   */
  fastify.post<{
    Params: { templateId: string };
  }>('/templates/:templateId/create-project', async (request, reply) => {
    const { templateId } = request.params;
    const body = createFromTemplateSchema.parse(request.body);

    logger.info('Creating project from template', {
      component: 'api:templates',
      templateId,
      projectName: body.projectName,
      owner: body.owner,
    });

    try {
      const result = await templateManager.createProjectFromTemplate({
        templateId,
        ...body,
      });

      logger.info('Project created successfully', {
        component: 'api:templates',
        projectId: result.projectId,
        templateId,
      });

      return sendSuccess(reply, {
        projectId: result.projectId,
        message: `Project created successfully from template ${templateId}`,
        sampleData: result.sampleData,
      }, 201);
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return sendNotFound(reply, 'Template', templateId);
      }
      
      logger.error('Failed to create project from template', {
        component: 'api:templates',
        error,
        templateId,
      });
      return sendError(reply, 'PROJECT_CREATION_FAILED', error.message || 'Failed to create project', 400);
    }
  });

  /**
   * POST /projects/:projectId/update-prompts-from-template
   * Update an existing project's prompts from a template
   */
  fastify.post<{
    Params: { projectId: string };
  }>('/projects/:projectId/update-prompts-from-template', async (request, reply) => {
    const { projectId } = request.params;
    const body = updatePromptsFromTemplateSchema.parse(request.body);

    logger.info('Updating project prompts from template', {
      component: 'api:templates',
      projectId,
      templateId: body.templateId,
      updatedBy: body.updatedBy,
    });

    try {
      // Verify project exists
      const project = await deps.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return sendNotFound(reply, 'Project', projectId);
      }

      await templateManager.updateProjectPrompts({
        projectId: projectId as any,
        templateId: body.templateId,
        updatedBy: body.updatedBy,
      });

      logger.info('Project prompts updated successfully', {
        component: 'api:templates',
        projectId,
        templateId: body.templateId,
      });

      return sendSuccess(reply, {
        message: `Project prompts updated from template ${body.templateId}`,
      });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return sendNotFound(reply, 'Template', body.templateId);
      }
      
      logger.error('Failed to update prompts from template', {
        component: 'api:templates',
        error,
        projectId,
      });
      return sendError(reply, 'PROMPT_UPDATE_FAILED', error.message || 'Failed to update prompts', 400);
    }
  });
}
