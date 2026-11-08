import { frameToTime, toSeconds, type FrameRate } from '../../core/timeline/time.ts';
import { type AudioTrack, type SequenceSpan } from '../../lib/loading-protocol.ts';

// The pure half of `inspect`: the Composition's declared structure re-expressed as frames and
// seconds. The Time Module is the only frame-to-second conversion, exactly as in the encoder.

const secondsOf = (frame: number, rate: FrameRate): number =>
  toSeconds(frameToTime(BigInt(frame), rate));

/** A named Sequence as the half-open frames it is visible in, with the same interval in seconds. */
export type SequenceEntry = {
  /** The Sequence's own name: the last segment of `path`. */
  readonly name: string;
  /** Named ancestors outer to inner, ending with `name`; unnamed Sequences add no segment. */
  readonly path: readonly string[];
  readonly startFrame: number;
  readonly endFrame: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
};

export const sequenceEntries = (
  spans: readonly SequenceSpan[],
  rate: FrameRate,
): readonly SequenceEntry[] =>
  spans.map(({ path, startFrame, endFrame }) => ({
    name: path.at(-1) ?? '',
    path,
    startFrame,
    endFrame,
    startSeconds: secondsOf(startFrame, rate),
    endSeconds: secondsOf(endFrame, rate),
  }));

/** A declared audio clip with every default applied and its placement clipped to the Composition. */
export type AudioEntry = {
  readonly src: string;
  /** Timeline frame the clip starts at: `startInFrames`, or 0. */
  readonly startInFrames: number;
  /**
   * Exclusive timeline frame the clip stops at: `endInFrames`, or the Composition's end when none
   * is declared, and never past that end, where the mix is cut. Never before `startInFrames`: a
   * clip that starts at or after the Composition's end is never heard and has an empty span
   * (`endInFrames` equals `startInFrames`).
   */
  readonly endInFrames: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  /**
   * False when the clip plays to its source's natural end, which `inspect` does not measure: then
   * `endInFrames` is the latest the clip can still be heard, not where it stops.
   */
  readonly endDeclared: boolean;
  /** Source frame the clip reads from: `offsetInFrames`, or 0. */
  readonly offsetInFrames: number;
  /** Linear gain: `volume`, or 1. */
  readonly volume: number;
};

export const audioEntries = (
  tracks: readonly AudioTrack[],
  durationInFrames: number,
  rate: FrameRate,
): readonly AudioEntry[] =>
  tracks.map((track) => {
    const startInFrames = track.startInFrames ?? 0;
    const endInFrames = Math.max(
      startInFrames,
      Math.min(track.endInFrames ?? durationInFrames, durationInFrames),
    );
    return {
      src: track.src,
      startInFrames,
      endInFrames,
      startSeconds: secondsOf(startInFrames, rate),
      endSeconds: secondsOf(endInFrames, rate),
      endDeclared: track.endInFrames !== undefined,
      offsetInFrames: track.offsetInFrames ?? 0,
      volume: track.volume ?? 1,
    };
  });
