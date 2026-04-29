import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Vitest configuration for the research module test suite.
 *
 * Covers:
 *  - Unit tests: pii-scrubber, mock-waha-server
 *  - Fixture integrity checks (transcript shape validation)
 *
 * DB/Redis integration tests for research repos are handled by the existing
 * `vitest.integration.config.ts` and should be kept separate to avoid
 * requiring Docker in the lightweight research test pass.
 *
 * Run with:  pnpm test:research
 * CI target: ~30s, no external services required.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'src/research/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      // Integration tests that need DB/Redis live in the integration config
      'src/research/**/*.integration.test.ts',
    ],
    // Research tests are fast and self-contained; parallel is safe here
    fileParallelism: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: ['src/research/**/*.ts'],
      exclude: [
        'src/research/**/*.test.ts',
        'src/research/**/*.integration.test.ts',
        'src/research/types.ts',
        'src/research/errors.ts',
        'src/research/testing/fixtures/**',
      ],
    },
  },
});
