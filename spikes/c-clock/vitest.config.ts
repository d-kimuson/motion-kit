import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { compareClocks } from './experiment.ts';

export default defineConfig({
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'] },
  test: {
    include: ['spikes/c-clock/**/*.browser.test.ts'],
    testTimeout: 180_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 640, height: 480 },
      screenshotFailures: false,
      commands: { compareClocks },
    },
  },
});
