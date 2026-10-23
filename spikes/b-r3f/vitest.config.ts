import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { flagProfiles, isFlagProfile } from './flags.ts';

const profile = process.env['SPIKE_THREE_FLAGS'] ?? 'swiftshader';
if (!isFlagProfile(profile)) throw new Error(`Unknown flag profile: ${profile}`);
// Playwright itself opts into SwiftShader. Removing only our args would not test its absence.
const ignoreDefaultArgs =
  profile === 'swiftshader-no-opt-in' ? ['--enable-unsafe-swiftshader'] : [];
console.log(JSON.stringify({ profile, flags: flagProfiles[profile], ignoreDefaultArgs }));

export default defineConfig({
  test: {
    include: ['spikes/b-r3f/**/*.browser.test.ts'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: { args: [...flagProfiles[profile]], ignoreDefaultArgs },
      }),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 640, height: 480 },
      screenshotFailures: false,
    },
  },
});
