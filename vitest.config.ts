import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    isolate: false,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', '.agents/**/*.test.ts'],
    setupFiles: ['configs/vitest/time.setup.ts'],
  },
});
