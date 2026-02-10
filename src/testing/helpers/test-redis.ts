/**
 * Test Redis helper for integration tests.
 * Provides Redis cleanup capabilities.
 */
import Redis from 'ioredis';

/** Test Redis instance with helpers for cleanup. */
export interface TestRedis {
  /** Redis client connected to test instance. */
  client: Redis;
  /** Flush test database (delete all keys). */
  flush: () => Promise<void>;
  /** Disconnect from Redis. */
  disconnect: () => Promise<void>;
}

/**
 * Create a test Redis instance.
 * Connects to test Redis and provides helpers for cleanup.
 *
 * @returns Test Redis instance.
 */
export async function createTestRedis(): Promise<TestRedis> {
  const testRedisUrl = process.env.TEST_REDIS_URL || 'redis://localhost:6380';

  const client = new Redis(testRedisUrl, {
    // Suppress Redis logs in tests
    lazyConnect: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
  });

  // Wait for connection
  await client.ping();

  return {
    client,

    /**
     * Flush test database.
     * Deletes all keys from the current database.
     * Fast isolation between tests.
     */
    flush: async () => {
      await client.flushdb();
    },

    /**
     * Disconnect from Redis.
     * Call in afterAll hook.
     */
    disconnect: async () => {
      await client.quit();
    },
  };
}
