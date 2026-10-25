import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one Postgres and one Redis; files reset state in beforeEach.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    env: { NODE_ENV: 'test', CADENCE_SERVICE: 'test' },
  },
});
