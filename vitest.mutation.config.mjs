import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/construction/src/**/*.test.ts'],
    maxWorkers: 1,
  },
});
