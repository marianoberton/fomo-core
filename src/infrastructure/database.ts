/**
 * Prisma client singleton with connection lifecycle management.
 * Provides a centralized database client for all repositories and stores.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@/observability/logger.js';

const logger = createLogger({ name: 'database' });

/** Options for creating the Prisma client. */
export interface DatabaseOptions {
  /** Override DATABASE_URL from env. */
  url?: string;
  /** Log Prisma queries (recommended only in development). */
  logQueries?: boolean;
  /** Maximum number of connections in the pool (default: 10). */
  connectionLimit?: number;
  /** Maximum seconds to wait for a connection from the pool (default: 10). */
  poolTimeoutSeconds?: number;
}

/** Wrapper around PrismaClient with lifecycle hooks. */
export interface Database {
  /** The raw PrismaClient instance. */
  client: PrismaClient;
  /** Establish the database connection. */
  connect(): Promise<void>;
  /** Gracefully close the database connection. */
  disconnect(): Promise<void>;
}

let instance: Database | undefined;

/**
 * Create a Database wrapper around PrismaClient.
 * Stores the instance as a singleton — calling twice throws.
 */
export function createDatabase(options?: DatabaseOptions): Database {
  if (instance) {
    throw new Error('Database already initialized. Call disconnect() first or use getDatabase().');
  }

  // Append connection pool params to the URL if not already present.
  // Prisma uses ?connection_limit=N&pool_timeout=N query params.
  let datasourceUrl = options?.url;
  if (datasourceUrl) {
    const url = new URL(datasourceUrl);
    if (!url.searchParams.has('connection_limit') && options?.connectionLimit) {
      url.searchParams.set('connection_limit', String(options.connectionLimit));
    }
    if (!url.searchParams.has('pool_timeout') && options?.poolTimeoutSeconds) {
      url.searchParams.set('pool_timeout', String(options.poolTimeoutSeconds));
    }
    datasourceUrl = url.toString();
  }

  const connectionLimit = options?.connectionLimit ?? 10;
  const poolTimeout = options?.poolTimeoutSeconds ?? 10;

  logger.info('Initializing database', {
    component: 'database',
    connectionLimit,
    poolTimeoutSeconds: poolTimeout,
  });

  const client = new PrismaClient({
    datasourceUrl,
    log: options?.logQueries
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'error' },
        ]
      : [{ emit: 'event', level: 'error' }],
  });

  if (options?.logQueries) {
     
    client.$on('query' as never, (e: unknown) => {
      const event = e as { query: string; duration: number };
      logger.debug('Prisma query', {
        component: 'database',
        query: event.query,
        durationMs: event.duration,
      });
    });
  }

   
  client.$on('error' as never, (e: unknown) => {
    const event = e as { message: string };
    logger.error('Prisma error', {
      component: 'database',
      message: event.message,
    });
  });

  const db: Database = {
    client,

    async connect(): Promise<void> {
      await client.$connect();
      logger.info('Database connected', { component: 'database' });
    },

    async disconnect(): Promise<void> {
      await client.$disconnect();
      instance = undefined;
      logger.info('Database disconnected', { component: 'database' });
    },
  };

  instance = db;
  return db;
}

/**
 * Get the existing Database singleton.
 * Throws if `createDatabase()` hasn't been called yet.
 */
export function getDatabase(): Database {
  if (!instance) {
    throw new Error('Database not initialized. Call createDatabase() first.');
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 * Does NOT disconnect — caller is responsible for cleanup.
 */
export function resetDatabaseSingleton(): void {
  instance = undefined;
}
