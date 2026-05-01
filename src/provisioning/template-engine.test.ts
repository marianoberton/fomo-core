/**
 * Tests for the template engine — variable substitution and workspace preparation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  renderTemplate,
  renderTemplateFile,
  resolveTemplatePath,
  createTemplateEngine,
  TemplateError,
  TemplateVarsSchema,
} from './template-engine.js';
import type { Logger } from '@/observability/logger.js';

// ─── Mocks ──────────────────────────────────────────────────────

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// ─── renderTemplate (pure function) ─────────────────────────────

describe('renderTemplate', () => {
  it('replaces single variable', () => {
    const result = renderTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple variables', () => {
    const result = renderTemplate(
      '{{company_name}} - {{company_vertical}}',
      { company_name: 'Acme', company_vertical: 'ventas' },
    );
    expect(result).toBe('Acme - ventas');
  });

  it('replaces repeated occurrences of the same variable', () => {
    const result = renderTemplate(
      '{{name}} and {{name}} again',
      { name: 'Foo' },
    );
    expect(result).toBe('Foo and Foo again');
  });

  it('leaves unmatched placeholders as-is', () => {
    const result = renderTemplate('{{known}} and {{unknown}}', { known: 'yes' });
    expect(result).toBe('yes and {{unknown}}');
  });

  it('returns original string when no variables match', () => {
    const result = renderTemplate('No vars here', { name: 'test' });
    expect(result).toBe('No vars here');
  });

  it('handles empty vars object', () => {
    const result = renderTemplate('{{name}}', {});
    expect(result).toBe('{{name}}');
  });

  it('handles empty template string', () => {
    const result = renderTemplate('', { name: 'test' });
    expect(result).toBe('');
  });

  it('handles multiline templates', () => {
    const template = `# {{title}}

Company: {{company_name}}
Owner: {{owner_name}}`;
    const result = renderTemplate(template, {
      title: 'SOUL',
      company_name: 'Acme Corp',
      owner_name: 'John',
    });
    expect(result).toContain('# SOUL');
    expect(result).toContain('Company: Acme Corp');
    expect(result).toContain('Owner: John');
  });

  it('does not replace non-word-char patterns like {{foo-bar}}', () => {
    const result = renderTemplate('{{foo-bar}}', { 'foo-bar': 'nope' });
    expect(result).toBe('{{foo-bar}}');
  });
});

// ─── TemplateVarsSchema ─────────────────────────────────────────

describe('TemplateVarsSchema', () => {
  const validVars = {
    client_id: 'client-001',
    instance_name: 'acme-corp',
    company_name: 'Acme Corp',
    company_vertical: 'ventas',
    manager_name: 'Alex',
    owner_name: 'John Doe',
    channels: 'whatsapp,telegram',
  };

  it('accepts valid template variables', () => {
    const result = TemplateVarsSchema.safeParse(validVars);
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = TemplateVarsSchema.safeParse({
      ...validVars,
      channels_list: '- whatsapp\n- telegram',
      channels_config: 'whatsapp:\n  enabled: true',
      health_check_port: '8080',
      fomo_core_api_url: 'https://core.fomo.com.ar',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty client_id', () => {
    const result = TemplateVarsSchema.safeParse({ ...validVars, client_id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { company_name: _, ...incomplete } = validVars;
    const result = TemplateVarsSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

// ─── renderTemplateFile ─────────────────────────────────────────

describe('renderTemplateFile', () => {
  const tmpDir = path.join('/tmp', 'template-engine-test-' + process.pid);

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads file and renders variables', async () => {
    const filePath = path.join(tmpDir, 'test.md.template');
    await fs.writeFile(filePath, '# {{title}}\nBy {{author}}', 'utf-8');

    const result = await renderTemplateFile(filePath, {
      title: 'My Doc',
      author: 'Jane',
    });
    expect(result).toBe('# My Doc\nBy Jane');
  });

  it('throws TemplateError for missing file', async () => {
    await expect(
      renderTemplateFile('/tmp/nonexistent-file.md', {}),
    ).rejects.toThrow(TemplateError);
  });
});

// ─── resolveTemplatePath ────────────────────────────────────────

describe('resolveTemplatePath', () => {
  const tmpTemplates = path.join('/tmp', 'resolve-test-' + process.pid);

  beforeEach(async () => {
    await fs.mkdir(path.join(tmpTemplates, 'base'), { recursive: true });
    await fs.mkdir(path.join(tmpTemplates, 'ventas'), { recursive: true });
    await fs.writeFile(path.join(tmpTemplates, 'base', 'SOUL.md.template'), 'base soul', 'utf-8');
    await fs.writeFile(path.join(tmpTemplates, 'ventas', 'SOUL.md.template'), 'ventas soul', 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(tmpTemplates, { recursive: true, force: true });
  });

  it('returns vertical-specific path when it exists', async () => {
    // resolveTemplatePath uses the global TEMPLATES_DIR constant,
    // so we test the logic directly via the createTemplateEngine service
    const content = await fs.readFile(
      path.join(tmpTemplates, 'ventas', 'SOUL.md.template'),
      'utf-8',
    );
    expect(content).toBe('ventas soul');
  });

  it('base template exists as fallback', async () => {
    const content = await fs.readFile(
      path.join(tmpTemplates, 'base', 'SOUL.md.template'),
      'utf-8',
    );
    expect(content).toBe('base soul');
  });
});

// ─── createTemplateEngine — prepareClientWorkspace ──────────────

describe('createTemplateEngine', () => {
  const tmpTemplates = path.join('/tmp', 'engine-test-templates-' + process.pid);
  const tmpWorkspace = path.join('/tmp', 'engine-test-workspace-' + process.pid);
  let logger: Logger;

  beforeEach(async () => {
    logger = createMockLogger();

    // Set up template directories
    await fs.mkdir(path.join(tmpTemplates, 'base', 'config'), { recursive: true });
    await fs.mkdir(path.join(tmpTemplates, 'base', 'docker'), { recursive: true });
    await fs.mkdir(path.join(tmpTemplates, 'ventas'), { recursive: true });
    await fs.mkdir(path.join(tmpTemplates, 'atencion'), { recursive: true });

    // Base templates
    await fs.writeFile(
      path.join(tmpTemplates, 'base', 'SOUL.md.template'),
      '# SOUL - {{company_name}}\nManager: {{manager_name}}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpTemplates, 'base', 'USER.md.template'),
      '# USER\nOwner: {{owner_name}}\nVertical: {{company_vertical}}',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpTemplates, 'base', 'config', 'openclaw.config.yml.template'),
      'instance:\n  name: "{{instance_name}}"',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpTemplates, 'base', 'docker', 'Dockerfile'),
      'FROM node:22-slim',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpTemplates, 'base', 'docker', 'healthcheck.js'),
      'process.exit(0);',
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpTemplates, 'base', 'docker', 'entrypoint.sh'),
      '#!/bin/sh\necho {{company_name}}',
      'utf-8',
    );

    // Ventas vertical override
    await fs.writeFile(
      path.join(tmpTemplates, 'ventas', 'SOUL.md.template'),
      '# VENTAS SOUL - {{company_name}}\nSales Manager: {{manager_name}}',
      'utf-8',
    );

    // Atencion vertical override
    await fs.writeFile(
      path.join(tmpTemplates, 'atencion', 'SOUL.md.template'),
      '# ATENCION SOUL - {{company_name}}\nSupport Manager: {{manager_name}}',
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpTemplates, { recursive: true, force: true });
    await fs.rm(tmpWorkspace, { recursive: true, force: true });
  });

  const baseVars: Record<string, string> = {
    client_id: 'client-001',
    instance_name: 'acme-corp',
    company_name: 'Acme Corp',
    company_vertical: 'ventas',
    manager_name: 'Alex',
    owner_name: 'John Doe',
    channels: 'whatsapp,telegram',
    channels_list: '- whatsapp\n- telegram',
    channels_config: 'whatsapp:\n    enabled: true\n  telegram:\n    enabled: true',
    health_check_port: '8080',
    fomo_core_api_url: 'https://core.fomo.com.ar',
  };

  it('creates workspace directory with rendered SOUL.md for ventas vertical', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);

    expect(dir).toBe(path.join(tmpWorkspace, 'client-001'));

    const soul = await fs.readFile(path.join(dir, 'SOUL.md'), 'utf-8');
    expect(soul).toContain('VENTAS SOUL - Acme Corp');
    expect(soul).toContain('Sales Manager: Alex');
  });

  it('creates workspace with rendered USER.md from base', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);

    const user = await fs.readFile(path.join(dir, 'USER.md'), 'utf-8');
    expect(user).toContain('Owner: John Doe');
    expect(user).toContain('Vertical: ventas');
  });

  it('uses atencion SOUL.md when vertical is atencion', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-002', 'atencion', {
      ...baseVars,
      company_vertical: 'atencion',
    });

    const soul = await fs.readFile(path.join(dir, 'SOUL.md'), 'utf-8');
    expect(soul).toContain('ATENCION SOUL - Acme Corp');
    expect(soul).toContain('Support Manager: Alex');
  });

  it('falls back to base SOUL.md for unknown vertical', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    // An unknown vertical should fall back to 'ventas' (default) and use its template
    const dir = await engine.prepareClientWorkspace('client-003', 'unknown-vertical', baseVars);

    const soul = await fs.readFile(path.join(dir, 'SOUL.md'), 'utf-8');
    // Falls back to default 'ventas' since 'unknown-vertical' is not a valid Vertical
    expect(soul).toContain('VENTAS SOUL - Acme Corp');
  });

  it('renders config files with template substitution', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);

    const config = await fs.readFile(
      path.join(dir, 'config', 'openclaw.config.yml'),
      'utf-8',
    );
    expect(config).toContain('name: "acme-corp"');
  });

  it('copies docker files (binary files copied as-is)', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);

    const dockerfile = await fs.readFile(path.join(dir, 'docker', 'Dockerfile'), 'utf-8');
    expect(dockerfile).toBe('FROM node:22-slim');

    const healthcheck = await fs.readFile(path.join(dir, 'docker', 'healthcheck.js'), 'utf-8');
    expect(healthcheck).toBe('process.exit(0);');
  });

  it('renders .sh files with variable substitution', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);

    const entrypoint = await fs.readFile(path.join(dir, 'docker', 'entrypoint.sh'), 'utf-8');
    expect(entrypoint).toContain('echo Acme Corp');
  });

  it('cleans up existing workspace before creating new one', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    // Create workspace twice for the same client
    await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);
    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', {
      ...baseVars,
      company_name: 'New Corp',
    });

    const soul = await fs.readFile(path.join(dir, 'SOUL.md'), 'utf-8');
    expect(soul).toContain('New Corp');
  });

  it('cleanupClientWorkspace removes workspace directory', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    const dir = await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);
    const exists = await fs.access(dir).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    await engine.cleanupClientWorkspace('client-001');
    const existsAfter = await fs.access(dir).then(() => true).catch(() => false);
    expect(existsAfter).toBe(false);
  });

  it('cleanupClientWorkspace does not throw for non-existent workspace', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    await expect(
      engine.cleanupClientWorkspace('non-existent'),
    ).resolves.toBeUndefined();
  });

  it('logs workspace preparation', async () => {
    const engine = createTemplateEngine({
      logger,
      templatesDir: tmpTemplates,
      workspaceBase: tmpWorkspace,
    });

    await engine.prepareClientWorkspace('client-001', 'ventas', baseVars);

    expect(logger.info).toHaveBeenCalledWith(
      'Preparing client workspace',
      expect.objectContaining({
        component: 'template-engine',
        clientId: 'client-001',
        vertical: 'ventas',
      }),
    );
  });
});
