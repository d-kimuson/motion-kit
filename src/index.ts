export {
  defineComposition,
  defineCompositions,
  type CompositionDefinition,
  type CompositionDescriptor,
  type CompositionRegistry,
  type PreparedComposition,
  type MountCompositionOptions,
} from './core/composition/registry.ts';
/** An audio clip a Composition declares; the render muxes it onto the frame timeline. */
export type { AudioTrack } from './lib/loading-protocol.ts';
export {
  createCompositionRuntime,
  type CompositionRuntime,
  type CompositionRuntimeOptions,
  type FrameSnapshot,
  type CaptureLease,
  type FrameOutcome,
  type CaptureValidation,
  type CaptureCompletion,
  type ContentRegistration,
  type IntegrationRegistration,
  type HostSource,
} from './core/runtime/composition-runtime.ts';
export {
  Composition,
  CompositionContent,
  useCompositionFrame,
} from './core/composition/composition.tsx';
export {
  useTimeline,
  useTime,
  useFrame,
  useSequence,
  type TimelineContext,
  type SequenceContext,
} from './core/timeline/hooks.ts';
export { Sequence, type SequenceProps } from './core/sequence/sequence.tsx';
export {
  TransitionSeries,
  TransitionScene,
  Transition,
  useTransitionProgress,
  type TransitionSeriesProps,
  type TransitionSceneProps,
  type TransitionProps,
} from './core/transition/transition-series.tsx';
export { useAsset } from './core/assets/use-asset.ts';
export type {
  AssetDescriptor,
  FontAssetDescriptor,
  ImageAssetDescriptor,
} from './core/assets/types.ts';
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
