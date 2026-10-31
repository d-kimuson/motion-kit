import type { CDPSession, Page } from 'playwright';

import { defineBrowserCommand } from '@vitest/browser-playwright';
import fc from 'fast-check';

import type { Fault, Mechanism } from './fixture.tsx';

const wall = () => Number(process.hrtime.bigint()) / 1e6;
const requireThat = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const bounded = async <T>(promise: Promise<T>, label: string, deadline = 10_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${deadline}ms deadline: ${label}`)), deadline);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const advance = async (cdp: CDPSession, budget: number) => {
  if (budget <= 0) return;
  const expired = new Promise<void>((resolve) =>
    cdp.once('Emulation.virtualTimeBudgetExpired', () => resolve()),
  );
  await cdp.send('Emulation.setVirtualTimePolicy', {
    policy: 'advance',
    budget,
    maxVirtualTimeTaskStarvationCount: 100,
  });
  await bounded(expired, 'virtual time budget');
};
const statistics = (values: number[]) => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    n: values.length,
    meanMs: mean,
    varianceMs2: variance,
    stddevMs: Math.sqrt(variance),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
};
const open = async (parent: Page, mechanism: Mechanism) => {
  const page = await parent.context().newPage();
  page.setDefaultTimeout(10_000);
  try {
    await page.goto(
      new URL(`/spikes/c-clock/index.html?mechanism=${mechanism}`, parent.url()).href,
    );
    await page.waitForFunction(() => window.clockFixture !== undefined);
    await bounded(
      page.evaluate(() => window.clockFixture.ready()),
      'fixture ready',
    );
    const cdp = await page.context().newCDPSession(page);
    if (mechanism === 'cdp') {
      await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
      await page.evaluate(() => window.clockFixture.resetOrigin());
    }
    let virtualElapsed = 0;
    const seek = async (time: number, adapted = true, fault: Fault = 'none') => {
      const start = wall();
      const reverseUnsupported = mechanism === 'cdp' && time < virtualElapsed;
      if (mechanism === 'cdp') {
        await advance(cdp, Math.max(0, time - virtualElapsed));
        virtualElapsed = Math.max(time, virtualElapsed);
      }
      const immediate = await page.evaluate(
        ({ time, adapted, fault }) => window.clockFixture.prepare(time, adapted, fault),
        { time, adapted, fault },
      );
      if (mechanism === 'cdp') {
        // Start the awaited expression while paused, then explicitly service its pending timer.
        const evaluation = cdp.send('Runtime.evaluate', {
          expression: `window.clockFixture.settle(${time}, ${String(adapted)})`,
          awaitPromise: true,
          returnByValue: true,
        });
        let completed = false;
        const observed = evaluation.then((result) => {
          completed = true;
          return result;
        });
        // Decoding posts work from another thread: one budget can expire before seeked is queued.
        // Pump bounded virtual budgets until the explicitly registered readiness promise resolves.
        const pumpDeadline = wall() + 10_000;
        for (let attempts = 0; !completed && attempts < 1000; attempts++) {
          requireThat(wall() < pumpDeadline, 'CDP settlement budget-pump deadline');
          await advance(cdp, 10);
          virtualElapsed += 10;
        }
        const result = await bounded(
          observed,
          `Runtime.evaluate awaitPromise time=${time} adapted=${String(adapted)}`,
        );
        requireThat(result.exceptionDetails === undefined, 'CDP settlement exception');
      } else
        await bounded(
          page.evaluate(({ time, adapted }) => window.clockFixture.settle(time, adapted), {
            time,
            adapted,
          }),
          'page settlement',
        );
      const state = await page.evaluate(() => window.clockFixture.inspect());
      const dom = await page.evaluate(() => window.clockFixture.snapshot());
      // Fixed clip avoids locator stability/rAF waits under paused virtual time.
      const png = await page.screenshot({
        clip: { x: 0, y: 0, width: 320, height: 240 },
        animations: 'allow',
        timeout: 10_000,
      });
      return {
        dom,
        png,
        state,
        immediate,
        reverseUnsupported,
        virtualElapsed,
        costMs: wall() - start,
      };
    };
    return { page, cdp, seek, close: () => page.close() };
  } catch (error) {
    await page.close();
    throw error;
  }
};
type Capture = Awaited<ReturnType<Awaited<ReturnType<typeof open>>['seek']>>;
const equal = (left: Capture, right: Capture) => ({
  dom: left.dom === right.dom,
  png: left.png.equals(right.png),
});
const frames = [0, 100, 250, 500, 750, 1000, 1500, 2000];
const seed = 145;
const shuffled =
  fc.sample(fc.shuffledSubarray(frames, { minLength: frames.length, maxLength: frames.length }), {
    seed,
    numRuns: 1,
  })[0] ?? [];
const order = [...shuffled, 2000, 0, 500, 500];

const runComparison = async (parent: Page) => {
  const start = wall();
  const results = [];
  for (const mechanism of ['own', 'raf', 'cdp'] satisfies Mechanism[]) {
    let fixture = await open(parent, mechanism);
    const baseline = new Map<number, Capture>();
    const costs: number[] = [];
    let raw;
    let injectedReact = -1;
    try {
      injectedReact = await fixture.page.evaluate(() => window.clockFixture.injectReact(500));
      requireThat(injectedReact === 500, `${mechanism}: explicit React state injection`);
      raw = (await fixture.seek(500, false)).state;
      await fixture.close();
      fixture = await open(parent, mechanism);
      for (const frame of frames) {
        const capture = await fixture.seek(frame);
        baseline.set(frame, capture);
        costs.push(capture.costMs);
        requireThat(
          capture.state.microtask === frame && capture.state.timer === frame,
          `${mechanism}: pending work not settled`,
        );
        requireThat(
          !capture.state.seeking && capture.state.mediaReady >= 2,
          `${mechanism}: video not ready`,
        );
        requireThat(
          Math.abs(capture.state.video - frame / 1000) < 1e-6,
          `${mechanism}: video time`,
        );
        requireThat(
          capture.state.css.every((value) => value === frame),
          `${mechanism}: CSS adapter`,
        );
      }
      const first = baseline.get(0);
      const last = baseline.get(2000);
      requireThat(
        first !== undefined && last !== undefined && !first.png.equals(last.png),
        `${mechanism}: blank/constant output`,
      );
      await fixture.close();
      fixture = await open(parent, mechanism);
      const random = [];
      for (const frame of order) {
        const capture = await fixture.seek(frame);
        costs.push(capture.costMs);
        const reference = baseline.get(frame);
        if (reference === undefined) throw new Error('Missing baseline');
        random.push({
          time: frame,
          ...equal(capture, reference),
          reverseUnsupported: capture.reverseUnsupported,
        });
      }
      await fixture.close();
      const fresh = [];
      for (const frame of frames) {
        fixture = await open(parent, mechanism);
        const capture = await fixture.seek(frame);
        costs.push(capture.costMs);
        const reference = baseline.get(frame);
        if (reference === undefined) throw new Error('Missing baseline');
        fresh.push({ time: frame, ...equal(capture, reference) });
        await fixture.close();
      }
      fixture = await open(parent, mechanism);
      const held = await fixture.seek(500);
      const screenshotPath = process.env['SPIKE_CLOCK_SCREENSHOT'];
      if (mechanism === 'own' && screenshotPath !== undefined)
        await fixture.page.screenshot({
          path: screenshotPath,
          clip: { x: 0, y: 0, width: 320, height: 240 },
          animations: 'allow',
        });
      // Real host wait measures whether holding timeline time freezes output; it is not a readiness barrier.
      await new Promise<void>((resolve) => setTimeout(resolve, 80));
      const heldDom = await fixture.page.evaluate(() => window.clockFixture.snapshot());
      const heldPng = await fixture.page.screenshot({
        clip: { x: 0, y: 0, width: 320, height: 240 },
        animations: 'allow',
      });
      const heldState = await fixture.page.evaluate(() => window.clockFixture.inspect());
      const hold = {
        dom: held.dom === heldDom,
        png: held.png.equals(heldPng),
        extraRafCalls: heldState.rafCalls - held.state.rafCalls,
      };
      if (mechanism === 'own') {
        // Name the comparisons that failed, not just that one did: the failure is the only output a
        // failing run keeps, and DOM versus PNG decides whether the clock or the pixels drifted.
        const mismatches = [
          ...random.map((result) => ({ stage: 'order', ...result })),
          ...fresh.map((result) => ({ stage: 'fresh', ...result })),
          { stage: 'hold', time: 500, dom: hold.dom, png: hold.png },
        ].filter((result) => !result.dom || !result.png);
        requireThat(
          mismatches.length === 0,
          `Own clock failed order/hold equality: ${JSON.stringify(mismatches)}`,
        );
        for (const frame of frames) {
          const state = baseline.get(frame)?.state;
          requireThat(
            state?.react === frame &&
              state.now === frame &&
              state.date === frame &&
              state.rafTime === frame &&
              state.rafClock === frame,
            'Own clock not injected into every JS consumer',
          );
        }
      }
      results.push({
        mechanism,
        injectedReact,
        rawAt500: raw,
        adaptedAt500: baseline.get(500)?.state,
        sequential: [...baseline].map(([time, capture]) => ({
          time,
          state: capture.state,
          virtualElapsed: capture.virtualElapsed,
        })),
        random,
        fresh,
        hold,
        cost: statistics(costs),
        costsMs: costs,
      });
    } finally {
      await fixture.close();
    }
  }
  const asyncProbes = [];
  for (const mechanism of ['own', 'raf', 'cdp'] satisfies Mechanism[]) {
    const fixture = await open(parent, mechanism);
    try {
      const microtasks = await fixture.cdp.send('Runtime.evaluate', {
        expression: 'Promise.resolve().then(() => Promise.resolve(42))',
        awaitPromise: true,
        returnByValue: true,
      });
      requireThat(
        microtasks.exceptionDetails === undefined && microtasks.result.value === 42,
        'Microtask probe failed',
      );
      const rejection = await fixture.cdp.send('Runtime.evaluate', {
        expression: 'Promise.reject(new Error("expected readiness rejection"))',
        awaitPromise: true,
      });
      requireThat(rejection.exceptionDetails !== undefined, 'Readiness rejection swallowed');
      let timerWhilePaused: boolean | null = null;
      if (mechanism === 'cdp') {
        let completed = false;
        const waiting = fixture.cdp
          .send('Runtime.evaluate', {
            expression: 'new Promise(resolve => setTimeout(() => resolve(42), 5))',
            awaitPromise: true,
          })
          .then((value) => {
            completed = true;
            return value;
          });
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        timerWhilePaused = completed;
        requireThat(!completed, 'Paused CDP timer unexpectedly progressed');
        await advance(fixture.cdp, 10);
        await bounded(waiting, 'resumed timer');
      }
      const timeoutStart = wall();
      let timedOut = false;
      try {
        await bounded(
          fixture.page.evaluate(() => new Promise<void>(() => {})),
          'never-ready negative control',
          50,
        );
      } catch (error) {
        timedOut = error instanceof Error && error.message.includes('50ms deadline');
      }
      requireThat(timedOut, 'Missing host-side timeout');
      asyncProbes.push({
        mechanism,
        microtaskAwaited: true,
        rejectionDetected: true,
        neverReadyTimedOut: true,
        timeoutWallMs: wall() - timeoutStart,
        timerWhilePaused,
      });
    } finally {
      await fixture.close();
    }
  }
  // Faults compare against the valid reference, rather than blessing consistently wrong adapters.
  const negative = [];
  for (const fault of ['skip-css', 'skip-video', 'accumulate', 'skip-barrier'] satisfies Fault[]) {
    let fixture = await open(parent, 'own');
    try {
      const reference = await fixture.seek(500);
      await fixture.close();
      fixture = await open(parent, 'own');
      await fixture.seek(0, true, fault);
      await fixture.seek(2000, true, fault);
      const bad = await fixture.seek(500, true, fault);
      const match = equal(bad, reference);
      if (fault === 'skip-barrier')
        requireThat(bad.state.timer !== 500, 'Missing barrier not detected before screenshot');
      requireThat(!match.dom && !match.png, `${fault}: negative control not detected`);
      let recoveredAfterRelease: boolean | null = null;
      if (fault === 'skip-barrier') {
        await bounded(
          fixture.page.evaluate(() => window.clockFixture.release()),
          'released readiness gate',
        );
        const dom = await fixture.page.evaluate(() => window.clockFixture.snapshot());
        const png = await fixture.page.screenshot({
          clip: { x: 0, y: 0, width: 320, height: 240 },
          animations: 'allow',
        });
        recoveredAfterRelease = dom === reference.dom && png.equals(reference.png);
        requireThat(
          recoveredAfterRelease,
          `Readiness gate did not recover reference frame: ${JSON.stringify({ dom: dom === reference.dom, png: png.equals(reference.png) })}`,
        );
      }
      negative.push({
        fault,
        ...match,
        timerBeforeCapture: bad.state.timer,
        recoveredAfterRelease,
      });
    } finally {
      await fixture.close();
    }
  }
  const report = {
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      chromium: parent.context().browser()?.version(),
      headless: true,
      viewport: '640x480',
      crop: '320x240',
      dpr: 1,
    },
    seed,
    order,
    results,
    asyncProbes,
    negative,
    wallMs: wall() - start,
  };
  return report;
};
const runRepetitions = async (parent: Page) => {
  // Repeat the unchanged comparison serially; do not treat frames as independent runs.
  const repetitions: Awaited<ReturnType<typeof runComparison>>[] = [];
  for (let repetition = 0; repetition < 3; repetition++)
    repetitions.push(await runComparison(parent));
  const costRanges = (['own', 'raf', 'cdp'] satisfies Mechanism[]).map((mechanism) => {
    const meansMs = repetitions.map((repetition) => {
      const result = repetition.results.find((candidate) => candidate.mechanism === mechanism);
      if (result === undefined) throw new Error(`Missing mechanism: ${mechanism}`);
      return result.cost.meanMs;
    });
    return {
      mechanism,
      repetitions: meansMs.length,
      meansMs,
      minMeanMs: Math.min(...meansMs),
      maxMeanMs: Math.max(...meansMs),
    };
  });
  const report = { repetitions, costRanges };
  console.log(JSON.stringify(report));
  return report;
};
export type ComparisonReport = Awaited<ReturnType<typeof runRepetitions>>;
export const compareClocks = defineBrowserCommand(({ page }) => runRepetitions(page));
