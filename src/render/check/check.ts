import { validateOutputFrame } from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type FrameCaptureResult, type RenderedFrame } from '../capture/frame.ts';
import { createRendererPool, type RendererPool } from '../pool.ts';
import { createRenderer, type Renderer, type RendererOptions } from '../renderer.ts';
import {
  checkComparisonDiagnostic,
  comparePng,
  defaultCheckComparison,
  type CheckComparison,
  type CheckDifference,
  type CheckStatus,
} from './compare.ts';
import {
  checkHistories,
  planHistories,
  type CheckHistory,
  type CheckHistoryPlanError,
  type PlannedHistory,
} from './history.ts';

export type CheckCompositionOptions = RendererOptions & {
  readonly frames: readonly number[];
  readonly predecessors?: readonly number[];
  readonly histories?: readonly CheckHistory[];
  readonly comparison?: CheckComparison;
};

export type CheckHistoryResult = {
  readonly history: CheckHistory;
  readonly predecessor: number | null;
  /** This capture's dimensions, not the descriptor's. */
  readonly width: number;
  readonly height: number;
  readonly status: 'reference' | CheckStatus;
  /** `null` only for the cold reference capture. */
  readonly difference: CheckDifference | null;
};

export type CheckSampleResult = {
  readonly frame: number;
  /** The cold reference capture's dimensions. */
  readonly width: number;
  readonly height: number;
  readonly histories: readonly CheckHistoryResult[];
};

export type CheckReport = {
  readonly composition: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly fps: { readonly numerator: number; readonly denominator: number };
    readonly durationInFrames: number;
  };
  readonly comparison: CheckComparison;
  readonly samples: readonly CheckSampleResult[];
  /** Capture warnings and the checker's own findings; never empty on a failed check. */
  readonly diagnostics: readonly Diagnostic[];
};

type Aborted = { readonly ok: false; readonly aborted: true };
type CheckOutcome = Result<CheckReport, readonly Diagnostic[]> | Aborted;

/** A pass means no error diagnostic; the report keeps the warnings for the caller. */
export const checkReportPassed = (report: CheckReport): boolean =>
  !report.diagnostics.some((diagnostic) => diagnostic.severity === 'error');

const aborted = (): Aborted => ({ ok: false, aborted: true });

const invalidArguments = (message: string, hint: string): Diagnostic => ({
  code: 'cli.invalid-arguments',
  severity: 'error',
  message,
  hint,
});

const isAborted = (result: { readonly ok: false }): result is Aborted => 'aborted' in result;

const captureOutcome = (
  result: Aborted | { readonly ok: false; readonly error: readonly Diagnostic[] },
): CheckOutcome => (isAborted(result) ? aborted() : { ok: false, error: result.error });

const openOutcome = (
  result: Aborted | { readonly ok: false; readonly error: Diagnostic },
): CheckOutcome => (isAborted(result) ? aborted() : { ok: false, error: [result.error] });

/**
 * Validate everything the caller supplies before any browser opens. `planHistories` treats bad
 * arguments as programmer errors (it throws), so the boundary must reject them first.
 */
const validateInput = (options: {
  readonly frames: readonly number[];
  readonly predecessors: readonly number[] | undefined;
  readonly histories: readonly CheckHistory[] | undefined;
  readonly comparison: CheckComparison;
}): readonly Diagnostic[] => {
  const { frames, predecessors, histories, comparison } = options;
  const problems: Diagnostic[] = [];
  if (frames.length === 0)
    problems.push(
      invalidArguments(
        'The check has no sample frames.',
        'Request at least one frame so the check has evidence.',
      ),
    );
  if (frames.some((frame) => !Number.isSafeInteger(frame) || frame < 0))
    problems.push(
      invalidArguments(
        'Sample frames must be nonnegative safe integers.',
        'Request frames as nonnegative safe integers.',
      ),
    );
  if (new Set(frames).size !== frames.length)
    problems.push(
      invalidArguments('Sample frames must not repeat.', 'Remove duplicate frames from the check.'),
    );
  if (predecessors !== undefined) {
    if (predecessors.some((predecessor) => !Number.isSafeInteger(predecessor) || predecessor < 0))
      problems.push(
        invalidArguments(
          'Predecessor frames must be nonnegative safe integers.',
          'Request predecessors as nonnegative safe integers.',
        ),
      );
    if (new Set(predecessors).size !== predecessors.length)
      problems.push(
        invalidArguments(
          'Predecessor frames must not repeat.',
          'Remove duplicate predecessors from the check.',
        ),
      );
    if (predecessors.some((predecessor) => frames.includes(predecessor)))
      problems.push(
        invalidArguments(
          'A predecessor frame must differ from every sample frame.',
          'Choose predecessors that are not also requested samples.',
        ),
      );
  }
  if (histories !== undefined) {
    if (histories.length === 0)
      problems.push(
        invalidArguments(
          'The check requests no capture history.',
          'Request at least one history or omit the option for the defaults.',
        ),
      );
    if (histories.some((history) => !checkHistories.includes(history)))
      problems.push(
        invalidArguments(
          'The check requests an unknown capture history.',
          `Use one of: ${checkHistories.join(', ')}.`,
        ),
      );
    if (new Set(histories).size !== histories.length)
      problems.push(
        invalidArguments(
          'Capture histories must not repeat.',
          'Remove duplicate histories from the check.',
        ),
      );
  }
  const comparisonProblem = checkComparisonDiagnostic(comparison);
  if (comparisonProblem !== undefined) problems.push(comparisonProblem);
  return problems;
};

const predecessorRangeDiagnostic = (predecessor: number): Diagnostic => ({
  code: 'composition.props-invalid',
  severity: 'error',
  location: { frame: predecessor },
  message: 'The predecessor frame is outside the composition frame range.',
  hint: 'Request a safe integer predecessor that is at least zero and less than the frame count.',
});

const historyNotRunDiagnostic = (
  frame: number,
  compositionId: string,
  error: CheckHistoryPlanError,
): Diagnostic => ({
  code: 'check.history-not-run',
  severity: 'error',
  location: { compositionId, frame },
  message:
    error.reason === 'sample-without-comparison'
      ? `Frame ${frame} has no comparable capture, so the sample proves nothing.`
      : `The ${error.history} history cannot run for frame ${frame}.`,
  hint:
    error.reason === 'no-valid-predecessor'
      ? 'Request a predecessor inside the composition frame range or drop the history.'
      : 'Request a comparable history so the sample captures a warm predecessor.',
  details: { frame, history: error.history, reason: error.reason },
});

const uncontrolledTimeDiagnostic = (frame: number, compositionId: string): Diagnostic => ({
  code: 'check.uncontrolled-time',
  severity: 'error',
  location: { compositionId, frame },
  message: `A capture of frame ${frame} emitted seek.uncontrolled, so the check cannot certify it.`,
  hint: 'Drive every animation from the frame clock; an externally controlled seek cannot be compared.',
});

const frameDiffersDiagnostic = (
  frame: number,
  compositionId: string,
  histories: readonly CheckHistoryResult[],
): Diagnostic => ({
  code: 'check.frame-differs',
  severity: 'error',
  location: { compositionId, frame },
  message: `A warm capture of frame ${frame} differs from its cold reference.`,
  hint: 'Make the frame a pure function of its time; a warm realm must not carry state into later frames.',
  details: {
    frame,
    histories: histories
      .filter((history) => history.status === 'differs')
      .map(({ history, predecessor, status, difference }) => ({
        history,
        predecessor,
        status,
        difference,
      })),
  },
});

const internalDiagnostic = (frame: number, message: string): Diagnostic => ({
  code: 'internal.unexpected',
  severity: 'error',
  location: { frame },
  message,
  hint: 'Report this as a motion-kit bug: the pool window did not include the sample frame.',
});

const historyResult = (
  entry: PlannedHistory,
  capture: RenderedFrame,
  reference: Uint8Array,
  comparison: CheckComparison,
): CheckHistoryResult => {
  const compared = comparePng(capture.image, reference, comparison);
  return {
    history: entry.history,
    predecessor: entry.predecessor,
    width: capture.width,
    height: capture.height,
    status: compared.status,
    difference: compared.difference,
  };
};

const hasUncontrolledTime = (capture: RenderedFrame): boolean =>
  capture.diagnostics.some((diagnostic) => diagnostic.code === 'seek.uncontrolled');

/**
 * Capture one sample across its planned histories. The cold capture opens a fresh realm and is
 * the reference; every warm history gets its own realm (a predecessor pair) or the run's shared
 * pool, so no warm realm ever leaks into another history.
 */
const checkComposition = async (options: CheckCompositionOptions): Promise<CheckOutcome> => {
  const { frames, predecessors, histories } = options;
  const comparison = options.comparison ?? defaultCheckComparison;
  const signal = options.signal;
  const problems = validateInput({ frames, predecessors, histories, comparison });
  if (problems.length > 0) return { ok: false, error: problems };
  const rendererOptions: RendererOptions = {
    projectRoot: options.projectRoot,
    entry: options.entry,
    ...(options.viteConfig === undefined ? {} : { viteConfig: options.viteConfig }),
    ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
    ...(options.disableSandbox === undefined ? {} : { disableSandbox: options.disableSandbox }),
    ...(options.softwareWebGL === undefined ? {} : { softwareWebGL: options.softwareWebGL }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.loadingTimeoutMs === undefined
      ? {}
      : { loadingTimeoutMs: options.loadingTimeoutMs }),
    ...(options.frameTimeoutMs === undefined ? {} : { frameTimeoutMs: options.frameTimeoutMs }),
    ...(options.queueTimeoutMs === undefined ? {} : { queueTimeoutMs: options.queueTimeoutMs }),
    ...(options.compositionId === undefined ? {} : { compositionId: options.compositionId }),
    ...(options.props === undefined ? {} : { props: options.props }),
  };

  const diagnostics: Diagnostic[] = [];
  const samples: CheckSampleResult[] = [];
  const renderers: Renderer[] = [];
  let pool: RendererPool | undefined;

  const openRenderer = async () => {
    if (signal?.aborted === true) return aborted();
    const opened = await createRenderer(rendererOptions);
    if (opened.ok) renderers.push(opened.value);
    return opened;
  };
  const disposeRenderer = async (renderer: Renderer): Promise<void> => {
    const index = renderers.indexOf(renderer);
    if (index >= 0) renderers.splice(index, 1);
    await renderer.dispose();
  };
  const captureFrame = async (renderer: Renderer, frame: number): Promise<FrameCaptureResult> => {
    if (signal?.aborted === true) return aborted();
    return renderer.renderFrame({ frame, ...(signal === undefined ? {} : { signal }) });
  };
  const forward = (capture: RenderedFrame): void => {
    diagnostics.push(...capture.diagnostics);
  };

  try {
    const first = await openRenderer();
    if (!first.ok) return openOutcome(first);
    let cold: Renderer | undefined = first.value;
    const descriptor = first.value.descriptor();
    const durationInFrames = descriptor.durationInFrames;

    // The frame count only exists after a realm is mounted; reject impossible samples here so a
    // check never closes with a partial pass.
    const rangeProblems = frames.flatMap((frame) => {
      const checked = validateOutputFrame(frame, BigInt(durationInFrames));
      return checked.ok ? [] : [checked.error];
    });
    for (const predecessor of predecessors ?? []) {
      if (predecessor >= durationInFrames)
        rangeProblems.push(predecessorRangeDiagnostic(predecessor));
    }
    if (rangeProblems.length > 0) return { ok: false, error: rangeProblems };

    for (const frame of frames) {
      if (cold === undefined) {
        const opened = await openRenderer();
        if (!opened.ok) return openOutcome(opened);
        cold = opened.value;
      }
      const referenceRenderer = cold;
      cold = undefined;
      try {
        const plan = planHistories({
          frame,
          durationInFrames,
          ...(predecessors === undefined ? {} : { predecessors }),
          ...(histories === undefined ? {} : { histories }),
        });
        for (const planError of plan.errors)
          diagnostics.push(historyNotRunDiagnostic(frame, descriptor.id, planError));

        const referenceCapture = await captureFrame(referenceRenderer, frame);
        if (!referenceCapture.ok) return captureOutcome(referenceCapture);
        forward(referenceCapture.value);
        const reference = referenceCapture.value;
        let uncontrolled = hasUncontrolledTime(reference);
        const historyResults: CheckHistoryResult[] = [
          {
            history: 'cold',
            predecessor: null,
            width: reference.width,
            height: reference.height,
            status: 'reference',
            difference: null,
          },
        ];

        for (const entry of plan.entries) {
          if (entry.history === 'cold') continue;
          const predecessor = entry.predecessor;
          // `planHistories` always pairs a warm history with a predecessor.
          if (predecessor === null)
            throw new Error('A warm check history must name a predecessor.');
          if (entry.history === 'pool') {
            if (pool === undefined) {
              const opened = await createRendererPool({ ...rendererOptions, concurrency: 2 });
              if (!opened.ok) return openOutcome(opened);
              pool = opened.value;
            }
            // D6: the ascending window keeps the pool's own predecessor adjacent to the sample.
            const from = Math.max(0, Math.min(frame, predecessor) - 1);
            const to = Math.min(durationInFrames, Math.max(frame, predecessor) + 2);
            let actual: RenderedFrame | undefined;
            for await (const result of pool.renderFrames({
              from,
              to,
              ...(signal === undefined ? {} : { signal }),
            })) {
              if (!result.ok) return captureOutcome(result);
              forward(result.value);
              // A frame captured after the sample cannot influence it, so it does not make the
              // sample uncertifiable; its diagnostics are still forwarded above.
              if (result.value.frame <= frame && hasUncontrolledTime(result.value))
                uncontrolled = true;
              if (result.value.frame === frame) actual = result.value;
            }
            if (actual === undefined)
              return {
                ok: false,
                error: [
                  internalDiagnostic(
                    frame,
                    `The pool window [${from}, ${to}) did not capture frame ${frame}.`,
                  ),
                ],
              };
            historyResults.push(historyResult(entry, actual, reference.image, comparison));
            continue;
          }
          const opened = await openRenderer();
          if (!opened.ok) return openOutcome(opened);
          const pair = opened.value;
          try {
            const earlier = await captureFrame(pair, predecessor);
            if (!earlier.ok) return captureOutcome(earlier);
            forward(earlier.value);
            if (hasUncontrolledTime(earlier.value)) uncontrolled = true;
            const later = await captureFrame(pair, frame);
            if (!later.ok) return captureOutcome(later);
            forward(later.value);
            if (hasUncontrolledTime(later.value)) uncontrolled = true;
            historyResults.push(historyResult(entry, later.value, reference.image, comparison));
          } finally {
            await disposeRenderer(pair);
          }
        }

        // One diagnostic per uncertifiable sample: several uncontrolled captures of the same
        // frame would otherwise repeat the same finding.
        if (uncontrolled) diagnostics.push(uncontrolledTimeDiagnostic(frame, descriptor.id));
        if (historyResults.some((history) => history.status === 'differs'))
          diagnostics.push(frameDiffersDiagnostic(frame, descriptor.id, historyResults));
        samples.push({
          frame,
          width: reference.width,
          height: reference.height,
          histories: historyResults,
        });
      } finally {
        await disposeRenderer(referenceRenderer);
      }
    }

    return {
      ok: true,
      value: {
        composition: {
          id: descriptor.id,
          width: descriptor.width,
          height: descriptor.height,
          fps: descriptor.fps,
          durationInFrames: descriptor.durationInFrames,
        },
        comparison,
        samples,
        diagnostics,
      },
    };
  } finally {
    for (const renderer of renderers.splice(0)) await renderer.dispose();
    await pool?.dispose();
  }
};

export { checkComposition };
