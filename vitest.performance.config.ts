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
    include: ['tests/performance/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 120_000, // Performance tests may take longer
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
