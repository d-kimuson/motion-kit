import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRenderer, type Renderer } from '../renderer.ts';
import {
  byteMismatchMessage,
  pngBytesMatch,
  randomOrder,
  repeatedOrder,
  reverseOrder,
  type CrossEnvironmentTolerance,
  type DeterminismMode,
  type RequiredDeterminismMode,
} from './compare.ts';

const require = createRequire(import.meta.url);
const holdMs = 150;

export type DeterminismComposition = {
  readonly name: string;
  /** Absolute path of a module that exports `compositions` from `defineCompositions`. */
  readonly modulePath: string;
  readonly compositionId: string;
  readonly props?: Record<string, string | number | boolean | null>;
  /** Files copied into the temporary project's `public/` directory. `to` is relative. */
  readonly staticFiles?: readonly { readonly from: string; readonly to: string }[];
};

export type DeterminismSuite = {
  readonly composition: DeterminismComposition & { readonly focus: number };
  readonly frames: readonly number[];
  readonly tolerance?: CrossEnvironmentTolerance;
  readonly sustainedPasses?: number;
};

export type DeterminismModeResult = {
  readonly composition: string;
  readonly mode: DeterminismMode;
  readonly equal: boolean;
  readonly message: string;
};

export type DeterminismCompositionResult = {
  readonly name: string;
  readonly passed: boolean;
  readonly framesDiffer: boolean;
  readonly modes: readonly DeterminismModeResult[];
  readonly focusPng: Buffer | undefined;
};

export type DeterminismReport = {
  readonly passed: boolean;
  readonly compositions: readonly DeterminismCompositionResult[];
};

export type DeterminismRunOptions = {
  /** Return the loading service PID around fresh-realm re-selection. A change fails that mode. */
  readonly servicePid?: () => number;
};

const invalidSuite = (message: string): Error => new Error(`Determinism suite: ${message}`);

/** Register one reference Composition. Exact bytes unless `tolerance.purpose` is cross-environment. */
export const defineDeterminismSuite = (input: {
  composition: DeterminismComposition;
  frames: readonly number[];
  tolerance?: CrossEnvironmentTolerance;
  sustainedPasses?: number;
}): DeterminismSuite => {
  const frames = [...input.frames];
  if (frames.length < 2)
    throw invalidSuite('provide at least two frames so a constant capture cannot pass.');
  if (frames.some((frame) => !Number.isSafeInteger(frame) || frame < 0))
    throw invalidSuite('frames must be nonnegative safe integers.');
  const focus = Math.max(...frames);
  if (!frames.includes(focus)) throw invalidSuite('the focus frame N must be in the frame list.');
  if (
    input.tolerance !== undefined &&
    (input.tolerance.purpose !== 'cross-environment' ||
      !Number.isSafeInteger(input.tolerance.maxDifferentBytes) ||
      input.tolerance.maxDifferentBytes < 1)
  )
    throw invalidSuite(
      'a tolerance is only valid for cross-environment runs and must set purpose: "cross-environment" with a positive maxDifferentBytes.',
    );
  if (
    input.sustainedPasses !== undefined &&
    (!Number.isSafeInteger(input.sustainedPasses) || input.sustainedPasses < 2)
  )
    throw invalidSuite('sustainedPasses must be an integer of at least 2.');
  for (const file of input.composition.staticFiles ?? []) {
    if (file.to.length === 0 || file.to.includes('..') || file.to.startsWith('/'))
      throw invalidSuite('static file destinations must be relative public paths.');
  }
  return {
    composition: { ...input.composition, focus },
    frames,
    ...(input.tolerance === undefined ? {} : { tolerance: input.tolerance }),
    ...(input.sustainedPasses === undefined ? {} : { sustainedPasses: input.sustainedPasses }),
  };
};

const prepareProject = (composition: DeterminismComposition): string => {
  const directory = mkdtempSync(join(tmpdir(), 'motion-kit-determinism-'));
  mkdirSync(join(directory, 'node_modules'));
  mkdirSync(join(directory, 'public'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(composition.modulePath)};`,
  );
  for (const file of composition.staticFiles ?? []) {
    const target = join(directory, 'public', file.to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.from, target);
  }
  return directory;
};

const captureFailure = (result: {
  ok: false;
  error?: readonly { code: string; message: string }[];
  aborted?: true;
}): string =>
  result.error === undefined
    ? 'capture aborted'
    : result.error.map((item) => `${item.code}: ${item.message}`).join('; ');

const readFrame = async (
  renderer: Renderer,
  frame: number,
): Promise<{ ok: true; png: Buffer } | { ok: false; message: string }> => {
  const result = await renderer.renderFrame({ frame });
  if (!result.ok) return { ok: false, message: captureFailure(result) };
  if (result.value.diagnostics.some((item) => item.code === 'seek.uncontrolled'))
    return {
      ok: false,
      message: 'capture emitted seek.uncontrolled and is not certified deterministic',
    };
  return { ok: true, png: result.value.png };
};

const modeResult = (
  composition: string,
  mode: DeterminismMode,
  equal: boolean,
  message: string,
): DeterminismModeResult => ({ composition, mode, equal, message });

const compareOrder = async (
  renderer: Renderer,
  baseline: ReadonlyMap<number, Buffer>,
  order: readonly number[],
  composition: string,
  mode: DeterminismMode,
  tolerance: CrossEnvironmentTolerance | undefined,
): Promise<DeterminismModeResult> => {
  for (const frame of order) {
    const expected = baseline.get(frame);
    if (expected === undefined)
      return modeResult(
        composition,
        mode,
        false,
        `${composition}/${mode}: frame ${frame} has no sequential 0..N capture`,
      );
    const actual = await readFrame(renderer, frame);
    if (!actual.ok)
      return modeResult(
        composition,
        mode,
        false,
        `${composition}/${mode}: frame ${frame} ${actual.message}`,
      );
    const comparison = pngBytesMatch(actual.png, expected, tolerance);
    if (!comparison.equal)
      return modeResult(
        composition,
        mode,
        false,
        byteMismatchMessage(
          composition,
          mode,
          frame,
          comparison,
          actual.png.length,
          expected.length,
        ),
      );
  }
  const focus = order.at(-1) ?? 0;
  return modeResult(
    composition,
    mode,
    true,
    `${composition}/${mode}: frame ${focus} PNG bytes match the sequential 0..N capture`,
  );
};

const openRenderer = async (
  directory: string,
  composition: DeterminismSuite['composition'],
): Promise<Renderer> => {
  const opened = await createRenderer({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId: composition.compositionId,
    ...(composition.props === undefined ? {} : { props: composition.props }),
    frameTimeoutMs: 10_000,
  });
  if (!opened.ok)
    throw new Error(
      `Determinism suite could not open a renderer: ${'error' in opened ? opened.error.message : 'creation aborted.'}`,
    );
  return opened.value;
};

/** Capture one registered Composition across the seven traversal modes. */
export const runDeterminismSuite = async (
  suite: DeterminismSuite,
  options: DeterminismRunOptions = {},
): Promise<DeterminismReport> => {
  const directory = prepareProject(suite.composition);
  const renderers: Renderer[] = [];
  try {
    const renderer = await openRenderer(directory, suite.composition);
    renderers.push(renderer);
    const name = suite.composition.name;
    const focus = suite.composition.focus;
    const baseline = new Map<number, Buffer>();
    for await (const result of renderer.renderFrames({ from: 0, to: focus + 1 })) {
      if (!result.ok) {
        const message = `${name}/sequential-then-n: frame ${focus} ${captureFailure(result)}`;
        return {
          passed: false,
          compositions: [
            {
              name,
              passed: false,
              framesDiffer: false,
              focusPng: undefined,
              modes: [modeResult(name, 'sequential-then-n', false, message)],
            },
          ],
        };
      }
      if (result.value.diagnostics.some((item) => item.code === 'seek.uncontrolled'))
        return {
          passed: false,
          compositions: [
            {
              name,
              passed: false,
              framesDiffer: false,
              focusPng: undefined,
              modes: [
                modeResult(
                  name,
                  'sequential-then-n',
                  false,
                  `${name}/sequential-then-n: frame ${result.value.frame} capture emitted seek.uncontrolled and is not certified deterministic`,
                ),
              ],
            },
          ],
        };
      baseline.set(result.value.frame, result.value.png);
    }
    const captures = [...baseline.values()];
    const framesDiffer = captures.some((png) => captures.some((other) => !png.equals(other)));
    const modes: DeterminismModeResult[] = [];
    const record = async (mode: RequiredDeterminismMode, order: readonly number[]) => {
      modes.push(await compareOrder(renderer, baseline, order, name, mode, suite.tolerance));
    };
    await record('sequential-then-n', [focus]);
    await record('random', randomOrder(suite.frames, focus));
    await record('reverse', reverseOrder(focus));
    await record('repeated', repeatedOrder(focus));
    const pidBefore = options.servicePid?.();
    const selected = await renderer.select({
      compositionId: suite.composition.compositionId,
      ...(suite.composition.props === undefined ? {} : { props: suite.composition.props }),
    });
    const pidAfter = options.servicePid?.();
    if (!selected.ok) {
      modes.push(
        modeResult(
          name,
          'fresh-realm',
          false,
          `${name}/fresh-realm: frame ${focus} ${'error' in selected ? selected.error.message : 're-selection aborted'}`,
        ),
      );
    } else if (pidBefore !== undefined && pidAfter !== pidBefore) {
      modes.push(
        modeResult(
          name,
          'fresh-realm',
          false,
          `${name}/fresh-realm: frame ${focus} re-selection restarted the loading service`,
        ),
      );
    } else {
      modes.push(
        await compareOrder(renderer, baseline, [focus], name, 'fresh-realm', suite.tolerance),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    modes.push(
      await compareOrder(renderer, baseline, [focus], name, 'held-session', suite.tolerance),
    );
    if (suite.sustainedPasses !== undefined) {
      let sustained: DeterminismModeResult | undefined;
      for (let pass = 1; pass < suite.sustainedPasses; pass += 1) {
        sustained = await compareOrder(
          renderer,
          baseline,
          reverseOrder(focus).toReversed(),
          name,
          'sustained-session',
          suite.tolerance,
        );
        if (!sustained.equal) break;
      }
      if (sustained !== undefined) modes.push(sustained);
    }
    const fresh = await openRenderer(directory, suite.composition);
    renderers.push(fresh);
    modes.push(
      await compareOrder(fresh, baseline, [focus], name, 'fresh-renderer', suite.tolerance),
    );
    const constantMessage = `${name}: sequential 0..N captures are identical; a constant composition cannot prove traversal independence`;
    if (!framesDiffer) modes.push(modeResult(name, 'sequential-then-n', false, constantMessage));
    const passed = framesDiffer && modes.every((mode) => mode.equal);
    return {
      passed,
      compositions: [
        {
          name,
          passed,
          framesDiffer,
          modes,
          focusPng: baseline.get(focus),
        },
      ],
    };
  } finally {
    for (const renderer of renderers.splice(0)) await renderer.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
};
