import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/network/*.test.ts'], testTimeout: 10000, hookTimeout: 10000 },
});
