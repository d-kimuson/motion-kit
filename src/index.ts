export {
  defineComposition,
  defineCompositions,
  type CompositionDefinition,
  type CompositionDescriptor,
  type CompositionRegistry,
  type PreparedComposition,
  type MountCompositionOptions,
} from './core/composition/registry.ts';
export type { Clock } from './lib/clock.ts';
export type { Result } from './lib/result.ts';
export {
  addTime,
  compareTime,
  createFrameRate,
  createTimelineTime,
  durationFromFrameCount,
  frameCount,
  framePosition,
  frameToTime,
  subtractTime,
  timeToFrameCeil,
  timeToFrameFloor,
  timeToFrameNearest,
  toSeconds,
  validateOutputFrame,
  type FrameRate,
  type RationalInput,
  type TimelineTime,
} from './core/timeline/time.ts';
export {
  createSequence,
  sequenceContains,
  sequenceLocalTime,
  type SequenceInterval,
} from './core/sequence/interval.ts';
export {
  createTransitionSeries,
  sampleTransition,
  type TransitionSample,
  type TransitionSeriesTiming,
} from './core/transition/overlap.ts';

export {
  createFixedClock,
  currentDate,
  currentTimestamp,
  dateFromIsoString,
  systemClock,
} from './lib/clock.ts';
export { typedIncludes } from './lib/typedIncludes.ts';
export {
  DiagnosticCodeSchema,
  DiagnosticSchema,
  LocationSchema,
  type DiagnosticCode,
  type Diagnostic,
  type Location,
} from './lib/diagnostic.ts';
