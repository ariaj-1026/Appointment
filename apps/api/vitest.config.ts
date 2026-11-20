import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { NODE_ENV: 'test', DEFAULT_CLINIC_TIMEZONE: 'Asia/Manila' },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
