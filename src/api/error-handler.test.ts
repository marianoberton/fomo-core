import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { ZodError, type ZodIssue } from 'zod';
import {
  NexusError,
  ToolNotAllowedError,
  BudgetExceededError,
  ProviderError,
} from '@/core/errors.js';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  registerErrorHandler,
} from './error-handler.js';

vi.mock('@/observability/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }),
}));

interface SuccessBody {
  success: true;
  data: unknown;
}

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ─── sendSuccess ─────────────────────────────────────────────────

describe('sendSuccess', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    app.get('/default-status', async (request, reply) => {
      void request;
      return sendSuccess(reply, { foo: 'bar' });
    });

    app.get('/custom-status', async (request, reply) => {
      void request;
      return sendSuccess(reply, { created: true }, 201);
    });

    app.get('/null-data', async (request, reply) => {
      void request;
      return sendSuccess(reply, null);
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns { success: true, data } with default 200 status', async () => {
    const response = await app.inject({ method: 'GET', url: '/default-status' });
    const body = response.json<SuccessBody>();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ foo: 'bar' });
  });

  it('returns the custom status code when provided', async () => {
    const response = await app.inject({ method: 'GET', url: '/custom-status' });
    const body = response.json<SuccessBody>();

    expect(response.statusCode).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ created: true });
  });

  it('handles null data', async () => {
    const response = await app.inject({ method: 'GET', url: '/null-data' });
    const body = response.json<SuccessBody>();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
  });
});

// ─── sendError ───────────────────────────────────────────────────

describe('sendError', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    app.get('/basic-error', async (request, reply) => {
      void request;
      return sendError(reply, 'TEST_ERROR', 'Something went wrong');
    });

    app.get('/custom-status-error', async (request, reply) => {
      void request;
      return sendError(reply, 'BAD_INPUT', 'Invalid field', 400);
    });

    app.get('/error-with-details', async (request, reply) => {
      void request;
      return sendError(reply, 'DETAIL_ERROR', 'With details', 422, {
        field: 'email',
        reason: 'invalid format',
      });
    });

    app.get('/error-no-details', async (request, reply) => {
      void request;
      return sendError(reply, 'NO_DETAILS', 'No details here', 500, undefined);
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns { success: false, error: { code, message } } with default 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/basic-error' });
    const body = response.json<ErrorBody>();

    expect(response.statusCode).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TEST_ERROR');
    expect(body.error.message).toBe('Something went wrong');
    expect(body.error.details).toBeUndefined();
  });

  it('uses the provided status code', async () => {
    const response = await app.inject({ method: 'GET', url: '/custom-status-error' });
    const body = response.json<ErrorBody>();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('BAD_INPUT');
    expect(body.error.message).toBe('Invalid field');
  });

  it('includes details when provided', async () => {
    const response = await app.inject({ method: 'GET', url: '/error-with-details' });
    const body = response.json<ErrorBody>();

    expect(response.statusCode).toBe(422);
    expect(body.error.details).toEqual({
      field: 'email',
      reason: 'invalid format',
    });
  });

  it('omits details key when details is undefined', async () => {
    const response = await app.inject({ method: 'GET', url: '/error-no-details' });
    const body = response.json<ErrorBody>();

    expect(body.error).not.toHaveProperty('details');
  });
});

// ─── sendNotFound ────────────────────────────────────────────────

describe('sendNotFound', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();

    app.get('/not-found', async (request, reply) => {
      void request;
      return sendNotFound(reply, 'Project', 'proj-123');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 with NOT_FOUND code and descriptive message', async () => {
    const response = await app.inject({ method: 'GET', url: '/not-found' });
    const body = response.json<ErrorBody>();

    expect(response.statusCode).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Project "proj-123" not found');
  });
});

// ─── registerErrorHandler ────────────────────────────────────────

describe('registerErrorHandler', () => {
  describe('ZodError handling', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      registerErrorHandler(app);

      app.get('/throw-zod', () => {
        const issues: ZodIssue[] = [
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['name'],
            message: 'Expected string, received number',
          },
          {
            code: 'too_small',
            minimum: 1,
            inclusive: true,
            exact: false,
            type: 'string',
            path: ['nested', 'field'],
            message: 'String must contain at least 1 character(s)',
          },
        ];
        throw new ZodError(issues);
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('maps ZodError to 400 VALIDATION_ERROR with issues in details', async () => {
      const response = await app.inject({ method: 'GET', url: '/throw-zod' });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Request validation failed');
      expect(body.error.details).toBeDefined();

      const issues = body.error.details?.['issues'] as {
        path: string;
        message: string;
      }[];
      expect(issues).toHaveLength(2);
      expect(issues[0]).toEqual({
        path: 'name',
        message: 'Expected string, received number',
      });
      expect(issues[1]).toEqual({
        path: 'nested.field',
        message: 'String must contain at least 1 character(s)',
      });
    });
  });

  describe('NexusError handling', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      registerErrorHandler(app);

      app.get('/throw-tool-not-allowed', () => {
        throw new ToolNotAllowedError('dangerous-tool', 'proj-456');
      });

      app.get('/throw-budget-exceeded', () => {
        throw new BudgetExceededError('proj-789', 'daily', 15.5, 10);
      });

      app.get('/throw-provider-error', () => {
        throw new ProviderError('openai', 'rate limited');
      });

      app.get('/throw-base-nexus-error', () => {
        throw new NexusError({
          message: 'Custom error',
          code: 'CUSTOM_ERROR',
          statusCode: 418,
          context: { extra: 'info' },
        });
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('maps ToolNotAllowedError to 403 with TOOL_NOT_ALLOWED code', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/throw-tool-not-allowed',
      });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('TOOL_NOT_ALLOWED');
      expect(body.error.message).toContain('dangerous-tool');
      expect(body.error.message).toContain('proj-456');
      expect(body.error.details).toEqual({
        toolId: 'dangerous-tool',
        projectId: 'proj-456',
      });
    });

    it('maps BudgetExceededError to 429 with BUDGET_EXCEEDED code', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/throw-budget-exceeded',
      });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(429);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('BUDGET_EXCEEDED');
      expect(body.error.message).toContain('daily budget exceeded');
      expect(body.error.details).toEqual({
        projectId: 'proj-789',
        budgetType: 'daily',
        current: 15.5,
        limit: 10,
      });
    });

    it('maps ProviderError to 502 with PROVIDER_ERROR code', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/throw-provider-error',
      });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(502);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PROVIDER_ERROR');
      expect(body.error.message).toContain('rate limited');
    });

    it('uses error.statusCode, error.code, and error.context from NexusError', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/throw-base-nexus-error',
      });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(418);
      expect(body.error.code).toBe('CUSTOM_ERROR');
      expect(body.error.message).toBe('Custom error');
      expect(body.error.details).toEqual({ extra: 'info' });
    });
  });

  describe('Fastify built-in error handling (Error with statusCode)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      registerErrorHandler(app);

      app.get('/throw-fastify-error', () => {
        const error = new Error('Not Acceptable') as Error & {
          statusCode: number;
        };
        error.statusCode = 406;
        throw error;
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('maps Error with statusCode property to REQUEST_ERROR with that status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/throw-fastify-error',
      });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(406);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('REQUEST_ERROR');
      expect(body.error.message).toBe('Not Acceptable');
    });
  });

  describe('unknown error handling', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify();
      registerErrorHandler(app);

      app.get('/throw-plain-error', () => {
        throw new Error('Unexpected failure');
      });

      app.get('/throw-string', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'a raw string error';
      });

      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('maps a plain Error to 500 INTERNAL_ERROR and hides the message', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/throw-plain-error',
      });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred');
    });

    it('maps a thrown non-Error value to 500 INTERNAL_ERROR', async () => {
      const response = await app.inject({ method: 'GET', url: '/throw-string' });
      const body = response.json<ErrorBody>();

      expect(response.statusCode).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred');
    });
  });
});
