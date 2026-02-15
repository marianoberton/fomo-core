/**
 * Template Manager
 * Service for creating projects from pre-configured vertical templates
 */
import type { PrismaClient } from '@prisma/client';
import type { AgentConfig, ProjectId } from '@/core/types.js';
import type { PromptLayer } from '@/prompts/types.js';
import { nanoid } from 'nanoid';
import { createLogger } from '@/observability/logger.js';

// Import templates
import {
  carDealershipIdentity,
  carDealershipInstructions,
  carDealershipSafety,
  carDealershipConfig,
  carDealershipSampleData,
} from './car-dealership.js';

import {
  wholesaleHardwareIdentity,
  wholesaleHardwareInstructions,
  wholesaleHardwareSafety,
  wholesaleHardwareConfig,
  wholesaleHardwareSampleData,
} from './wholesale-hardware.js';

import {
  boutiqueHotelIdentity,
  boutiqueHotelInstructions,
  boutiqueHotelSafety,
  boutiqueHotelConfig,
  boutiqueHotelSampleData,
} from './boutique-hotel.js';

const logger = createLogger({ name: 'template-manager' });

// ─── Template Registry ──────────────────────────────────────────

export interface VerticalTemplate {
  id: string;
  name: string;
  description: string;
  identity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'>;
  instructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'>;
  safety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'>;
  agentConfig: Partial<AgentConfig>;
  sampleData?: unknown;
}

export const VERTICAL_TEMPLATES: Record<string, VerticalTemplate> = {
  'car-dealership': {
    id: 'car-dealership',
    name: 'Concesionaria de Vehículos',
    description: 'Asistente para concesionarias: consultas, calificación de leads, agendamiento de visitas y test drives',
    identity: carDealershipIdentity,
    instructions: carDealershipInstructions,
    safety: carDealershipSafety,
    agentConfig: carDealershipConfig,
    sampleData: carDealershipSampleData,
  },
  'wholesale-hardware': {
    id: 'wholesale-hardware',
    name: 'Mayorista / Ferretería',
    description: 'Asistente para mayoristas y ferreterías: búsqueda de productos, sugerencias complementarias, toma de pedidos',
    identity: wholesaleHardwareIdentity,
    instructions: wholesaleHardwareInstructions,
    safety: wholesaleHardwareSafety,
    agentConfig: wholesaleHardwareConfig,
    sampleData: wholesaleHardwareSampleData,
  },
  'boutique-hotel': {
    id: 'boutique-hotel',
    name: 'Hotel Boutique',
    description: 'Concierge virtual: información de habitaciones, recomendaciones de zona, gestión de reservas y servicios',
    identity: boutiqueHotelIdentity,
    instructions: boutiqueHotelInstructions,
    safety: boutiqueHotelSafety,
    agentConfig: boutiqueHotelConfig,
    sampleData: boutiqueHotelSampleData,
  },
};

// ─── Template Manager ───────────────────────────────────────────

export interface CreateProjectFromTemplateParams {
  templateId: string;
  projectName: string;
  projectDescription?: string;
  environment: 'production' | 'staging' | 'development';
  owner: string;
  tags?: string[];
  provider: {
    provider: 'anthropic' | 'openai' | 'google' | 'ollama';
    model: string;
    temperature?: number;
    apiKeyEnvVar?: string;
  };
  includeSampleData?: boolean;
}

export class TemplateManager {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * List all available vertical templates
   */
  listTemplates(): Array<{ id: string; name: string; description: string }> {
    return Object.values(VERTICAL_TEMPLATES).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
    }));
  }

  /**
   * Get a specific template by ID
   */
  getTemplate(templateId: string): VerticalTemplate | undefined {
    return VERTICAL_TEMPLATES[templateId];
  }

  /**
   * Create a new project from a template
   */
  async createProjectFromTemplate(params: CreateProjectFromTemplateParams): Promise<{
    projectId: ProjectId;
    config: AgentConfig;
    sampleData?: unknown;
  }> {
    const template = VERTICAL_TEMPLATES[params.templateId];
    if (!template) {
      throw new Error(`Template not found: ${params.templateId}`);
    }

    logger.info('Creating project from template', {
      component: 'template-manager',
      templateId: params.templateId,
      projectName: params.projectName,
      owner: params.owner,
    });

    const projectId = nanoid() as ProjectId;

    // Build full agent config from template + user overrides
    const agentConfig: AgentConfig = {
      projectId,
      agentRole: template.agentConfig.agentRole || 'assistant',
      provider: params.provider,
      failover: {
        onRateLimit: true,
        onServerError: true,
        onTimeout: true,
        timeoutMs: 30000,
        maxRetries: 3,
      },
      allowedTools: template.agentConfig.allowedTools || [],
      memoryConfig: template.agentConfig.memoryConfig || {
        longTerm: {
          enabled: true,
          maxEntries: 1000,
          retrievalTopK: 5,
          embeddingProvider: 'openai',
          decayEnabled: true,
          decayHalfLifeDays: 30,
        },
        contextWindow: {
          reserveTokens: 2000,
          pruningStrategy: 'turn-based',
          maxTurnsInContext: 20,
          compaction: {
            enabled: true,
            memoryFlushBeforeCompaction: false,
          },
        },
      },
      costConfig: template.agentConfig.costConfig || {
        dailyBudgetUSD: 5.0,
        monthlyBudgetUSD: 100.0,
        maxTokensPerTurn: 4000,
        maxTurnsPerSession: 50,
        maxToolCallsPerTurn: 5,
        alertThresholdPercent: 80,
        hardLimitPercent: 100,
        maxRequestsPerMinute: 20,
        maxRequestsPerHour: 200,
      },
      maxTurnsPerSession: template.agentConfig.maxTurnsPerSession || 50,
      maxConcurrentSessions: template.agentConfig.maxConcurrentSessions || 100,
    };

    // Create project in database
    await this.prisma.project.create({
      data: {
        id: projectId,
        name: params.projectName,
        description: params.projectDescription || template.description,
        environment: params.environment,
        owner: params.owner,
        tags: params.tags || [template.id, 'template-generated'],
        configJson: agentConfig as any,
        status: 'active',
      },
    });

    logger.info('Project created', {
      component: 'template-manager',
      projectId,
    });

    // Create prompt layers (identity, instructions, safety)
    const layers = [
      { ...template.identity, layerType: 'identity' as const },
      { ...template.instructions, layerType: 'instructions' as const },
      { ...template.safety, layerType: 'safety' as const },
    ];

    for (const layer of layers) {
      await this.prisma.promptLayer.create({
        data: {
          id: nanoid(),
          projectId,
          layerType: layer.layerType,
          version: 1,
          content: layer.content,
          isActive: true,
          createdAt: new Date(),
          createdBy: layer.createdBy,
          changeReason: layer.changeReason,
        },
      });
    }

    logger.info('Prompt layers created', {
      component: 'template-manager',
      projectId,
      layers: layers.length,
    });

    const result = {
      projectId,
      config: agentConfig,
      sampleData: params.includeSampleData ? template.sampleData : undefined,
    };

    logger.info('Project setup complete', {
      component: 'template-manager',
      projectId,
    });

    return result;
  }

  /**
   * Update an existing project to use a different template's prompts
   * (useful for switching verticals or resetting prompts)
   */
  async updateProjectPrompts(params: {
    projectId: ProjectId;
    templateId: string;
    updatedBy: string;
  }): Promise<void> {
    const template = VERTICAL_TEMPLATES[params.templateId];
    if (!template) {
      throw new Error(`Template not found: ${params.templateId}`);
    }

    logger.info('Updating project prompts from template', {
      component: 'template-manager',
      projectId: params.projectId,
      templateId: params.templateId,
    });

    // Deactivate all existing layers
    await this.prisma.promptLayer.updateMany({
      where: { projectId: params.projectId },
      data: { isActive: false },
    });

    // Get next version numbers for each layer type
    const existingLayers = await this.prisma.promptLayer.groupBy({
      by: ['layerType'],
      where: { projectId: params.projectId },
      _max: { version: true },
    });

    const nextVersions: Record<string, number> = {};
    for (const group of existingLayers) {
      nextVersions[group.layerType] = (group._max.version || 0) + 1;
    }

    // Create new active layers from template
    const layers = [
      { ...template.identity, layerType: 'identity' as const },
      { ...template.instructions, layerType: 'instructions' as const },
      { ...template.safety, layerType: 'safety' as const },
    ];

    for (const layer of layers) {
      const version = nextVersions[layer.layerType] || 1;
      await this.prisma.promptLayer.create({
        data: {
          id: nanoid(),
          projectId: params.projectId,
          layerType: layer.layerType,
          version,
          content: layer.content,
          isActive: true,
          createdAt: new Date(),
          createdBy: params.updatedBy,
          changeReason: `Updated from template: ${params.templateId}`,
          metadata: { templateId: params.templateId },
        },
      });
    }

    logger.info('Prompt layers updated', {
      component: 'template-manager',
      projectId: params.projectId,
    });
  }
}
