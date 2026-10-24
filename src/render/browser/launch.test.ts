import { describe, expect, it } from 'vitest';

import { chromiumOptions, launchBrowser } from './launch.ts';

describe('Chromium launch policy', () => {
  it('keeps sandbox enabled and unsafe software rendering opt-in', () => {
    expect(chromiumOptions()).toEqual({
      headless: true,
      chromiumSandbox: true,
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
      args: [],
    });
    expect(chromiumOptions({ disableSandbox: true, softwareWebGL: true })).toMatchObject({
      chromiumSandbox: false,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
  });
  it('actually launches without no-sandbox or unsafe software flags and closes its process handle', async () => {
    const result = await launchBrowser();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Launch failed');
    try {
      expect(result.value.server.process().spawnargs).not.toContain('--no-sandbox');
      expect(result.value.server.process().spawnargs).not.toContain('--enable-unsafe-swiftshader');
    } finally {
      await result.value.server.kill();
    }
    expect(
      result.value.server.process().exitCode !== null ||
        result.value.server.process().signalCode !== null,
    ).toBe(true);
  });
  it('returns the exact install Diagnostic without retries when the browser is missing', async () => {
    expect(await launchBrowser({ executablePath: '/motion-kit-missing-browser/chromium' })).toEqual(
      {
        ok: false,
        error: {
          code: 'render.browser-launch-failed',
          severity: 'error',
          message: 'Chromium could not be launched.',
          hint: 'Install the matching browser with pnpm exec playwright install chromium; check sandbox support and the explicit launch options.',
        },
      },
    );
  });
});
