import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          isolate: false,
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', '.agents/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.tsx'],
          setupFiles: ['configs/vitest/time.setup.ts'],
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'],
        },
        test: {
          name: 'composition-dom',
          include: ['src/core/composition/**/*.browser.test.tsx'],
          setupFiles: ['configs/vitest/time.setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 640, height: 480 },
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
