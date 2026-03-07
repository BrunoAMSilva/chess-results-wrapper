import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use in-memory database for all tests
    env: {
      DATABASE_PATH: ':memory:',
    },
    // Exclude Playwright tests (they use a different runner)
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/*.spec.ts'],
    // Default timeout for unit tests
    testTimeout: 10000,
    // Run tests in sequence to avoid DB concurrency issues
    pool: 'forks',
  },
});
