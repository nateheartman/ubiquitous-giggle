import { defineConfig } from 'vitest/config';

// Unit tests for the plain TypeScript modules (the formula engine so far).
// Playwright's specs under tests/e2e stay out of it.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
