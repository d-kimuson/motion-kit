import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          isolate: false,
          include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', '.agents/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.tsx', 'src/render/**/*.test.ts'],
          setupFiles: ['configs/vitest/time.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'loading',
          include: ['src/render/loading/**/*.test.ts', 'src/render/browser/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'frame-transport',
          include: ['src/render/renderer.test.ts', 'src/render/capture/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'],
        },
        test: {
          name: 'composition-dom',
          include: [
            'src/core/composition/**/*.browser.test.tsx',
            'src/core/runtime/**/*.browser.test.tsx',
            'src/core/assets/**/*.browser.test.tsx',
          ],
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
