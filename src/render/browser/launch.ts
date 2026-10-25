import { chromium, type Browser, type BrowserServer, type LaunchOptions } from 'playwright';

import { type Result } from '../../lib/result.ts';

export type BrowserOptions = {
  disableSandbox?: boolean;
  softwareWebGL?: boolean;
  executablePath?: string;
};
export const chromiumOptions = (options: BrowserOptions = {}): LaunchOptions => ({
  headless: true,
  chromiumSandbox: options.disableSandbox !== true,
  // Cancellation belongs to the caller, not to the browser launcher. Playwright installs its own
  // `SIGINT`/`SIGTERM`/`SIGHUP` handlers on the first launch (`addProcessHandlerIfNeeded`), and
  // its `SIGINT` handler exits the process with 130 as soon as its browsers have closed — inside
  // the same signal dispatch, ahead of the asynchronous cleanup that has to kill the encoder,
  // remove its temporary file and report the cancellation. Its `exit` handler still kills the
  // processes it tracks, so nothing it started outlives the process.
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
  ignoreDefaultArgs: options.softwareWebGL === true ? [] : ['--enable-unsafe-swiftshader'],
  args:
    options.softwareWebGL === true
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [],
  ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
});
export type OwnedBrowser = { browser: Browser; server: BrowserServer };
export const launchBrowser = async (
  options: BrowserOptions = {},
  timeoutMs = 30_000,
): Promise<Result<OwnedBrowser>> => {
  let server: BrowserServer | undefined;
  try {
    server = await chromium.launchServer({ ...chromiumOptions(options), timeout: timeoutMs });
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: timeoutMs });
    return { ok: true, value: { browser, server } };
  } catch {
    await server?.kill();
    return {
      ok: false,
      error: {
        code: 'render.browser-launch-failed',
        severity: 'error',
        message: 'Chromium could not be launched.',
        hint: 'Install the matching browser with pnpm exec playwright install chromium; check sandbox support and the explicit launch options.',
      },
    };
  }
};
