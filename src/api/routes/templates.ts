/**
 * Templates API Routes
 * Endpoints for listing and creating projects from vertical templates
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TemplateManager } from '@/templates/index.js';
import type { RouteDependencies } from '../types.js';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'api:templates' });

// ─── Schemas ───────────────────────────────────────────────────

const createFromTemplateSchema = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
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
  const templateManager = new TemplateManager(fastify.prisma);

  /**
   * GET /templates
   * List all available vertical templates
   */
  fastify.get('/templates', {
    schema: {
      description: 'List all available vertical templates',
      tags: ['templates'],
      response: {
        200: z.object({
          templates: z.array(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
          })),
        }),
      },
    },
  }, async (request, reply) => {
    logger.info('Listing available templates');

    const templates = templateManager.listTemplates();

    return reply.send({ templates });
  });

  /**
   * GET /templates/:templateId
   * Get a specific template by ID (without sample data)
   */
  fastify.get<{
    Params: { templateId: string };
  }>('/templates/:templateId', {
    schema: {
      description: 'Get a specific template details',
      tags: ['templates'],
      params: z.object({
        templateId: z.string(),
      }),
      response: {
        200: z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          allowedTools: z.array(z.string()),
          agentRole: z.string().optional(),
        }),
        404: z.object({
          error: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { templateId } = request.params;

    logger.info({ templateId }, 'Getting template details');

    const template = templateManager.getTemplate(templateId);
    
    if (!template) {
      return reply.code(404).send({ error: 'Template not found' });
    }

    return reply.send({
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
    Body: z.infer<typeof createFromTemplateSchema>;
  }>('/templates/:templateId/create-project', {
    schema: {
      description: 'Create a new project from a vertical template',
      tags: ['templates'],
      params: z.object({
        templateId: z.string(),
      }),
      body: createFromTemplateSchema,
      response: {
        201: z.object({
          projectId: z.string(),
          message: z.string(),
          sampleData: z.unknown().optional(),
        }),
        400: z.object({
          error: z.string(),
        }),
        404: z.object({
          error: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { templateId } = request.params;
    const body = createFromTemplateSchema.parse(request.body);

    logger.info({
      templateId,
      projectName: body.projectName,
      owner: body.owner,
    }, 'Creating project from template');

    try {
      const result = await templateManager.createProjectFromTemplate({
        templateId,
        ...body,
      });

      logger.info({
        projectId: result.projectId,
        templateId,
      }, 'Project created successfully');

      return reply.code(201).send({
        projectId: result.projectId,
        message: `Project created successfully from template ${templateId}`,
        sampleData: result.sampleData,
      });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return reply.code(404).send({ error: error.message });
      }
      
      logger.error({ error, templateId }, 'Failed to create project from template');
      return reply.code(400).send({ error: error.message || 'Failed to create project' });
    }
  });

  /**
   * POST /projects/:projectId/update-prompts-from-template
   * Update an existing project's prompts from a template
   */
  fastify.post<{
    Params: { projectId: string };
    Body: z.infer<typeof updatePromptsFromTemplateSchema>;
  }>('/projects/:projectId/update-prompts-from-template', {
    schema: {
      description: 'Update project prompts from a template (creates new versions)',
      tags: ['templates', 'projects'],
      params: z.object({
        projectId: z.string(),
      }),
      body: updatePromptsFromTemplateSchema,
      response: {
        200: z.object({
          message: z.string(),
        }),
        400: z.object({
          error: z.string(),
        }),
        404: z.object({
          error: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { projectId } = request.params;
    const body = updatePromptsFromTemplateSchema.parse(request.body);

    logger.info({
      projectId,
      templateId: body.templateId,
      updatedBy: body.updatedBy,
    }, 'Updating project prompts from template');

    try {
      // Verify project exists
      const project = await fastify.prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      await templateManager.updateProjectPrompts({
        projectId,
        templateId: body.templateId,
        updatedBy: body.updatedBy,
      });

      logger.info({
        projectId,
        templateId: body.templateId,
      }, 'Project prompts updated successfully');

      return reply.send({
        message: `Project prompts updated from template ${body.templateId}`,
      });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        return reply.code(404).send({ error: error.message });
      }
      
      logger.error({ error, projectId }, 'Failed to update prompts from template');
      return reply.code(400).send({ error: error.message || 'Failed to update prompts' });
    }
  });
}
