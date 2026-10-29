export const checkHistories = ['cold', 'after-earlier', 'after-later', 'pool'] as const;

/** A capture history relative to the sample frame: cold is the reference, the others are warm. */
export type CheckHistory = (typeof checkHistories)[number];

export type PlannedHistory = {
  readonly history: CheckHistory;
  readonly predecessor: number | null;
};

export type CheckHistoryErrorReason =
  /** No predecessor of the required side (or none at all for `pool`) exists. */
  | 'no-valid-predecessor'
  /** The history cannot run for this sample for a reason unrelated to predecessor choice. */
  | 'history-not-supported'
  /** Only the cold reference could run, so the sample would prove nothing. */
  | 'sample-without-comparison';

export type CheckHistoryPlanError = {
  readonly history: CheckHistory;
  readonly reason: CheckHistoryErrorReason;
};

export type CheckHistoryPlan = {
  readonly entries: readonly PlannedHistory[];
  readonly errors: readonly CheckHistoryPlanError[];
};

const invalidPlan = (message: string): never => {
  throw new Error(`The check history plan is invalid: ${message}`);
};

const assertSample = (frame: number, durationInFrames: number): void => {
  if (!Number.isSafeInteger(durationInFrames) || durationInFrames < 1)
    invalidPlan('durationInFrames must be a positive safe integer');
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= durationInFrames)
    invalidPlan('frame must be a safe integer inside [0, durationInFrames)');
};

const validatePredecessors = (
  predecessors: readonly number[],
  durationInFrames: number,
): readonly number[] => {
  const seen = new Set<number>();
  for (const predecessor of predecessors) {
    if (!Number.isSafeInteger(predecessor) || predecessor < 0 || predecessor >= durationInFrames)
      invalidPlan('predecessors must be safe integers inside [0, durationInFrames)');
    if (seen.has(predecessor)) invalidPlan('predecessors must not repeat');
    seen.add(predecessor);
  }
  return [...predecessors];
};

const validateHistories = (histories: readonly CheckHistory[]): readonly CheckHistory[] => {
  const seen = new Set<CheckHistory>();
  for (const history of histories) {
    if (!checkHistories.includes(history)) invalidPlan(`unknown history ${String(history)}`);
    if (seen.has(history)) invalidPlan('histories must not repeat');
    seen.add(history);
  }
  return [...histories];
};

export const defaultPredecessors = (frame: number, durationInFrames: number): readonly number[] =>
  [frame - 1, frame + 1].filter(
    (predecessor) =>
      Number.isSafeInteger(predecessor) && predecessor >= 0 && predecessor < durationInFrames,
  );

/**
 * Plan the capture histories for one sample. Cold is always the reference; a requested warm
 * history that cannot run becomes an error, while an unrequested one is silently absent.
 * The pool shares one window per sample, anchored on the first effective predecessor.
 */
export const planHistories = (options: {
  readonly frame: number;
  readonly durationInFrames: number;
  readonly predecessors?: readonly number[];
  readonly histories?: readonly CheckHistory[];
}): CheckHistoryPlan => {
  const { frame, durationInFrames } = options;
  assertSample(frame, durationInFrames);
  const predecessors =
    options.predecessors === undefined
      ? defaultPredecessors(frame, durationInFrames)
      : validatePredecessors(options.predecessors, durationInFrames);
  const requested =
    options.histories === undefined ? [...checkHistories] : validateHistories(options.histories);
  const requestedHistories = new Set(requested);
  const historiesWereExplicit = options.histories !== undefined;
  const entries: PlannedHistory[] = [{ history: 'cold', predecessor: null }];
  const errors: CheckHistoryPlanError[] = [];

  const addDirection = (history: CheckHistory, matching: readonly number[]): void => {
    if (!requestedHistories.has(history)) return;
    if (matching.length === 0) {
      if (historiesWereExplicit) errors.push({ history, reason: 'no-valid-predecessor' });
      return;
    }
    for (const predecessor of matching) entries.push({ history, predecessor });
  };
  addDirection(
    'after-earlier',
    predecessors.filter((predecessor) => predecessor < frame),
  );
  addDirection(
    'after-later',
    predecessors.filter((predecessor) => predecessor > frame),
  );
  if (requestedHistories.has('pool')) {
    const predecessor = predecessors[0];
    if (predecessor === undefined) {
      if (historiesWereExplicit) errors.push({ history: 'pool', reason: 'no-valid-predecessor' });
    } else entries.push({ history: 'pool', predecessor });
  }
  if (entries.length === 1 && errors.length === 0)
    errors.push({
      history: requested.find((history) => history !== 'cold') ?? 'cold',
      reason: 'sample-without-comparison',
    });
  return { entries, errors };
};
