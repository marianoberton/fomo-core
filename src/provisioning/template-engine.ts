/**
 * Template Engine — renders provisioning templates with client-specific variables.
 * Handles variable substitution in SOUL.md, USER.md, and config templates,
 * and prepares a client workspace directory with rendered files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { NexusError } from '@/core/errors.js';
import type { Logger } from '@/observability/logger.js';

// ─── Constants ──────────────────────────────────────────────────

const TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');
const CLIENT_WORKSPACE_BASE = '/tmp/clients';
const TEMPLATE_VAR_PATTERN = /\{\{(\w+)\}\}/g;

/** Supported vertical types for template selection. */
export const VerticalSchema = z.enum(['ventas', 'atencion', 'operaciones']);
export type Vertical = z.infer<typeof VerticalSchema>;

// ─── Template Variables Schema ──────────────────────────────────

/** Zod schema for template substitution variables. */
export const TemplateVarsSchema = z.object({
  client_id: z.string().min(1).max(128),
  instance_name: z.string().min(1).max(128),
  company_name: z.string().min(1).max(256),
  company_vertical: z.string().min(1).max(128),
  manager_name: z.string().min(1).max(128),
  owner_name: z.string().min(1).max(256),
  channels: z.string().min(1),
  channels_list: z.string().optional(),
  channels_config: z.string().optional(),
  health_check_port: z.string().optional(),
  fomo_core_api_url: z.string().optional(),
});
export type TemplateVars = z.infer<typeof TemplateVarsSchema>;

// ─── Errors ─────────────────────────────────────────────────────

/** Thrown when a template file cannot be found or rendered. */
export class TemplateError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message: `Template error: ${message}`,
      code: 'TEMPLATE_ERROR',
      statusCode: 500,
      context,
    });
    this.name = 'TemplateError';
  }
}

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Replace all `{{var_name}}` placeholders in a template string with values from vars.
 * Unmatched placeholders are left as-is.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(TEMPLATE_VAR_PATTERN, (_match, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : `{{${key}}}`;
  });
}

/**
 * Read a template file from disk and render it with the given variables.
 * @throws {TemplateError} If the file cannot be read.
 */
export async function renderTemplateFile(
  templatePath: string,
  vars: Record<string, string>,
): Promise<string> {
  try {
    const content = await fs.readFile(templatePath, 'utf-8');
    return renderTemplate(content, vars);
  } catch (err) {
    throw new TemplateError(`Failed to read template: ${templatePath}`, {
      templatePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve the SOUL.md template path for a given vertical.
 * Falls back to base if the vertical-specific template does not exist.
 */
export async function resolveTemplatePath(
  vertical: string,
  filename: string,
): Promise<string> {
  const verticalPath = path.join(TEMPLATES_DIR, vertical, filename);
  try {
    await fs.access(verticalPath);
    return verticalPath;
  } catch {
    // Fall back to base template
    return path.join(TEMPLATES_DIR, 'base', filename);
  }
}

// ─── Service Interface ──────────────────────────────────────────

/** Template engine for preparing client provisioning workspaces. */
export interface TemplateEngine {
  /**
   * Prepare a client workspace directory with rendered template files.
   * Creates /tmp/clients/{clientId}/ with SOUL.md, USER.md, config/, and docker/ files.
   * @returns The absolute path to the client workspace directory.
   */
  prepareClientWorkspace(
    clientId: string,
    vertical: string,
    vars: Record<string, string>,
  ): Promise<string>;

  /**
   * Clean up a client workspace directory.
   */
  cleanupClientWorkspace(clientId: string): Promise<void>;
}

/** Dependencies for the template engine service. */
export interface TemplateEngineDeps {
  logger: Logger;
  templatesDir?: string;
  workspaceBase?: string;
}

// ─── Service Factory ────────────────────────────────────────────

/** Create a template engine service. */
export function createTemplateEngine(deps: TemplateEngineDeps): TemplateEngine {
  const { logger } = deps;
  const templatesDir = deps.templatesDir ?? TEMPLATES_DIR;
  const workspaceBase = deps.workspaceBase ?? CLIENT_WORKSPACE_BASE;
  const COMPONENT = 'template-engine';

  /**
   * Resolve template path with vertical override support.
   * If a vertical-specific file exists, use it; otherwise fall back to base.
   */
  async function resolveTemplate(vertical: string, filename: string): Promise<string> {
    const verticalPath = path.join(templatesDir, vertical, filename);
    try {
      await fs.access(verticalPath);
      return verticalPath;
    } catch {
      return path.join(templatesDir, 'base', filename);
    }
  }

  /**
   * Copy and render all files from a source directory into the workspace.
   * Only processes .template, .yml, .yaml, .md, .conf files for variable substitution.
   * Binary and other files are copied as-is.
   */
  async function copyAndRenderDir(
    srcDir: string,
    destDir: string,
    vars: Record<string, string>,
  ): Promise<void> {
    let fileNames: string[];
    try {
      fileNames = await fs.readdir(srcDir);
    } catch {
      // Source directory does not exist — skip silently
      return;
    }

    await fs.mkdir(destDir, { recursive: true });

    for (const fileName of fileNames) {
      const srcPath = path.join(srcDir, fileName);
      const stat = await fs.stat(srcPath);
      const destName = fileName.replace(/\.template$/, '');
      const destPath = path.join(destDir, destName);

      if (stat.isDirectory()) {
        await copyAndRenderDir(srcPath, destPath, vars);
      } else {
        const isTextTemplate = /\.(template|yml|yaml|md|conf|sh)$/.test(fileName);
        if (isTextTemplate) {
          const content = await fs.readFile(srcPath, 'utf-8');
          await fs.writeFile(destPath, renderTemplate(content, vars), 'utf-8');
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }
  }

  return {
    async prepareClientWorkspace(
      clientId: string,
      vertical: string,
      vars: Record<string, string>,
    ): Promise<string> {
      const validatedVertical = VerticalSchema.safeParse(vertical);
      const effectiveVertical = validatedVertical.success ? validatedVertical.data : 'ventas';

      logger.info('Preparing client workspace', {
        component: COMPONENT,
        clientId,
        vertical: effectiveVertical,
      });

      const workspaceDir = path.join(workspaceBase, clientId);

      // Clean up existing workspace if it exists
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }

      await fs.mkdir(workspaceDir, { recursive: true });

      // 1. Render SOUL.md (vertical-specific or base)
      const soulTemplatePath = await resolveTemplate(effectiveVertical, 'SOUL.md.template');
      const soulContent = await renderTemplateFile(soulTemplatePath, vars);
      await fs.writeFile(path.join(workspaceDir, 'SOUL.md'), soulContent, 'utf-8');

      // 2. Render USER.md (always from base)
      const userTemplatePath = path.join(templatesDir, 'base', 'USER.md.template');
      const userContent = await renderTemplateFile(userTemplatePath, vars);
      await fs.writeFile(path.join(workspaceDir, 'USER.md'), userContent, 'utf-8');

      // 3. Copy and render config/ directory
      const configSrcDir = path.join(templatesDir, 'base', 'config');
      await copyAndRenderDir(configSrcDir, path.join(workspaceDir, 'config'), vars);

      // 4. Copy docker/ files (Dockerfile, entrypoint.sh, healthcheck.js)
      const dockerSrcDir = path.join(templatesDir, 'base', 'docker');
      await copyAndRenderDir(dockerSrcDir, path.join(workspaceDir, 'docker'), vars);

      logger.info('Client workspace prepared', {
        component: COMPONENT,
        clientId,
        workspaceDir,
        vertical: effectiveVertical,
      });

      return workspaceDir;
    },

    async cleanupClientWorkspace(clientId: string): Promise<void> {
      const workspaceDir = path.join(workspaceBase, clientId);

      logger.info('Cleaning up client workspace', {
        component: COMPONENT,
        clientId,
        workspaceDir,
      });

      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } catch (err) {
        logger.warn('Failed to clean up client workspace', {
          component: COMPONENT,
          clientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
