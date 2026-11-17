import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // First run downloads a MongoDB binary for the throwaway test database.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each file gets its own module graph (and therefore its own cached DB connection).
    isolate: true,
    fileParallelism: false,
  },
});
