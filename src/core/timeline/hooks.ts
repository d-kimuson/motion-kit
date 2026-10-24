import { useCompositionDefinition, useCompositionFrame } from '../composition/composition.tsx';
import { useSequenceInterval } from '../sequence/context.ts';
import { sequenceLocalTime, type SequenceInterval } from '../sequence/interval.ts';
import {
  divideTime,
  framePosition,
  frameToTime,
  subtractTime,
  timeToFrameFloor,
  toSeconds,
  zeroTime,
  type FrameRate,
  type TimelineTime,
} from './time.ts';

/** Seconds and decimal values for expression libraries; progress is a dimensionless ratio. */
export type SequenceContext = Readonly<{
  time: number;
  duration: number;
  remaining: number;
  progress: number;
  localFramePosition: number;
  fps: number;
  globalTime: number;
  globalFrame: number;
}>;

/** Composition-scoped time, plus exact metadata. Unaffected by enclosing Sequences. */
export type TimelineContext = SequenceContext &
  Readonly<{
    id: string;
    width: number;
    height: number;
    durationInFrames: number;
    frameRate: FrameRate;
  }>;

const sample = (
  interval: SequenceInterval,
  presentationTime: TimelineTime,
  frameRate: FrameRate,
): SequenceContext => {
  const time = sequenceLocalTime(interval, presentationTime);
  const duration = subtractTime(interval.end, interval.start);
  return {
    time: toSeconds(time),
    duration: toSeconds(duration),
    remaining: toSeconds(subtractTime(interval.end, presentationTime)),
    progress: toSeconds(duration.numerator === 0n ? zeroTime : divideTime(time, duration)),
    localFramePosition: toSeconds(framePosition(time, frameRate)),
    fps: toSeconds(frameRate),
    globalTime: toSeconds(presentationTime),
    globalFrame: Number(timeToFrameFloor(presentationTime, frameRate)),
  };
};

/** Outside a Sequence, sample the whole Composition. Requires a Composition provider. */
export const useSequence = (): SequenceContext => {
  const { presentationTime } = useCompositionFrame();
  const { frameRate } = useCompositionDefinition();
  const interval = useSequenceInterval();
  return sample(interval, presentationTime, frameRate);
};

/** Local seconds in the nearest Sequence, or global seconds outside any Sequence. */
export const useTime = (): number => useSequence().time;

/** Global output frame, never a rounded local frame position. */
export const useFrame = (): number => {
  const { presentationTime } = useCompositionFrame();
  const { frameRate } = useCompositionDefinition();
  return Number(timeToFrameFloor(presentationTime, frameRate));
};

/** Current Presentation Time in seconds and the selected Composition's metadata. */
export const useTimeline = (): TimelineContext => {
  const { presentationTime } = useCompositionFrame();
  const { descriptor, frameRate } = useCompositionDefinition();
  return {
    ...sample(
      { start: zeroTime, end: frameToTime(BigInt(descriptor.durationInFrames), frameRate) },
      presentationTime,
      frameRate,
    ),
    id: descriptor.id,
    width: descriptor.width,
    height: descriptor.height,
    durationInFrames: descriptor.durationInFrames,
    frameRate,
  };
};
