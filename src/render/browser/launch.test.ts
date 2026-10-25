import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { chromiumOptions, launchBrowser } from './launch.ts';

describe('Chromium launch policy', () => {
  it('keeps sandbox enabled and unsafe software rendering opt-in', () => {
    // The launcher never owns cancellation: its own signal handlers exit the process (130)
    // before a caller's asynchronous cleanup can finish (src/lib/exit.ts holds the guard).
    expect(chromiumOptions()).toEqual({
      headless: true,
      chromiumSandbox: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader'],
      args: [],
    });
    expect(chromiumOptions({ disableSandbox: true, softwareWebGL: true })).toMatchObject({
      chromiumSandbox: false,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
  });
  it.each([false, true])(
    'actually launches with sandbox and explicit softwareWebGL=%s flags',
    async (softwareWebGL) => {
      const result = await launchBrowser({ softwareWebGL });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Launch failed');
      try {
        const command = execFileSync(
          'ps',
          ['-ww', '-p', String(result.value.server.process().pid), '-o', 'command='],
          { encoding: 'utf8' },
        ).split(/\s+/);
        expect(command).not.toContain('--no-sandbox');
        for (const flag of [
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
        ]) {
          expect(command.includes(flag)).toBe(softwareWebGL);
        }
      } finally {
        await result.value.server.kill();
      }
      expect(
        result.value.server.process().exitCode !== null ||
          result.value.server.process().signalCode !== null,
      ).toBe(true);
    },
  );
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
