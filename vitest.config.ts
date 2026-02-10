import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

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
      'src/**/*.test.ts', // Unit tests
      'src/**/*.integration.test.ts', // Integration tests
      'tests/**/*.test.ts', // E2E, security, performance tests
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30_000, // 30s for integration tests
    hookTimeout: 30_000, // 30s for setup/teardown hooks
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.integration.test.ts',
        'src/**/types.ts',
        'src/**/index.ts',
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
});
