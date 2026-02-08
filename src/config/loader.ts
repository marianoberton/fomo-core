/**
 * Configuration loader — reads JSON config files, validates with Zod,
 * and resolves environment variable placeholders.
 */
import { readFile } from 'node:fs/promises';

import type { z } from 'zod';

import { NexusError } from '@/core/errors.js';
import type { Result } from '@/core/result.js';
import { err, ok } from '@/core/result.js';

import { projectConfigFileSchema } from './schema.js';

// ─── Types ──────────────────────────────────────────────────────

/**
 * Project configuration as loaded from a JSON file.
 * Does not include system-managed fields (status, createdAt, updatedAt).
 */
export type ProjectConfigFile = z.infer<typeof projectConfigFileSchema>;

// ─── Errors ─────────────────────────────────────────────────────

/**
 * Error thrown when configuration loading or validation fails.
 */
export class ConfigError extends NexusError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: 'CONFIG_ERROR',
      statusCode: 400,
      context,
    });
    this.name = 'ConfigError';
  }
}

// ─── Environment Variable Resolution ────────────────────────────

const ENV_VAR_PATTERN = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

/**
 * Recursively resolves environment variable placeholders in an object.
 * Replaces strings matching the pattern `${VAR_NAME}` with the value
 * of the corresponding environment variable.
 *
 * @param obj - The object to process (can be any JSON-compatible value)
 * @returns The object with all environment variables resolved
 * @throws ConfigError if a referenced environment variable is not defined
 */
export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    const match = ENV_VAR_PATTERN.exec(obj);
    const varName = match?.[1];
    if (varName !== undefined) {
      const value = process.env[varName];
      if (value === undefined) {
        throw new ConfigError(`Environment variable "${varName}" is not defined`, {
          variableName: varName,
          pattern: obj,
        });
      }
      return value;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }

  // Numbers, booleans, null — return as-is
  return obj;
}

// ─── Configuration Loader ───────────────────────────────────────

/**
 * Loads and validates a project configuration file.
 *
 * 1. Reads the JSON file from disk
 * 2. Parses the JSON content
 * 3. Resolves environment variable placeholders
 * 4. Validates against the Zod schema
 *
 * @param filePath - Path to the JSON configuration file
 * @returns A Result containing either the validated config or a ConfigError
 */
export async function loadProjectConfig(
  filePath: string,
): Promise<Result<ProjectConfigFile, ConfigError>> {
  // 1. Read the file
  let fileContent: string;
  try {
    fileContent = await readFile(filePath, 'utf-8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return err(
        new ConfigError(`Configuration file not found: ${filePath}`, {
          filePath,
          errorCode: 'ENOENT',
        }),
      );
    }
    return err(
      new ConfigError(`Failed to read configuration file: ${filePath}`, {
        filePath,
        errorCode: nodeError.code,
        errorMessage: nodeError.message,
      }),
    );
  }

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    return err(
      new ConfigError('Invalid JSON in configuration file', {
        filePath,
      }),
    );
  }

  // 3. Resolve environment variables
  let resolved: unknown;
  try {
    resolved = resolveEnvVars(parsed);
  } catch (error) {
    if (error instanceof ConfigError) {
      return err(error);
    }
    return err(
      new ConfigError('Failed to resolve environment variables', {
        filePath,
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  // 4. Validate with Zod
  const validation = projectConfigFileSchema.safeParse(resolved);
  if (!validation.success) {
    const issues = validation.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return err(
      new ConfigError('Configuration validation failed', {
        filePath,
        issues,
      }),
    );
  }

  return ok(validation.data);
}
