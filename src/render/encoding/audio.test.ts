import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type AudioTrack } from '../../lib/loading-protocol.ts';
import { clipAudioTracks } from './audio.ts';

/** A track whose three frame numbers are all explicit, so a failure names the value it got. */
const track = (input: {
  readonly startInFrames: number;
  readonly offsetInFrames: number;
  readonly endInFrames?: number;
}): AudioTrack => ({ src: 'clip.wav', ...input });

describe('clipAudioTracks', () => {
  it('returns the declared tracks unchanged for a range that covers them', () => {
    const tracks = [
      track({ startInFrames: 0, offsetInFrames: 0 }),
      track({ startInFrames: 10, offsetInFrames: 5, endInFrames: 20 }),
    ];
    expect(clipAudioTracks(tracks, { from: 0, to: 60 })).toEqual([
      { src: 'clip.wav', startInFrames: 0, offsetInFrames: 0 },
      { src: 'clip.wav', startInFrames: 10, offsetInFrames: 5, endInFrames: 20 },
    ]);
  });

  it('moves a clip that starts inside the range to its offset from the range start', () => {
    expect(
      clipAudioTracks([track({ startInFrames: 30, offsetInFrames: 0, endInFrames: 50 })], {
        from: 10,
        to: 40,
      }),
    ).toEqual([{ src: 'clip.wav', startInFrames: 20, offsetInFrames: 0, endInFrames: 30 }]);
  });

  it('trims the head of a clip that starts before the range, keeping its remaining source', () => {
    // The clip plays timeline frames 0..40 from source frames 100..140. The range starts at 10,
    // so the output plays source frame 110 at its own frame 0, for 30 frames.
    expect(
      clipAudioTracks([track({ startInFrames: 0, offsetInFrames: 100, endInFrames: 40 })], {
        from: 10,
        to: 45,
      }),
    ).toEqual([{ src: 'clip.wav', startInFrames: 0, offsetInFrames: 110, endInFrames: 30 }]);
  });

  it('advances the source offset of a natural-end clip the range cuts into', () => {
    expect(
      clipAudioTracks([track({ startInFrames: 5, offsetInFrames: 20 })], { from: 15, to: 40 }),
    ).toEqual([{ src: 'clip.wav', startInFrames: 0, offsetInFrames: 30 }]);
  });

  it('drops the clips that fall entirely outside the range', () => {
    const tracks = [
      track({ startInFrames: 0, offsetInFrames: 0, endInFrames: 10 }),
      track({ startInFrames: 10, offsetInFrames: 0, endInFrames: 20 }),
      track({ startInFrames: 40, offsetInFrames: 0, endInFrames: 50 }),
      track({ startInFrames: 50, offsetInFrames: 0 }),
    ];
    expect(clipAudioTracks(tracks, { from: 10, to: 40 })).toEqual([
      { src: 'clip.wav', startInFrames: 0, offsetInFrames: 0, endInFrames: 10 },
    ]);
  });

  it('keeps the declared gain and source of every kept clip', () => {
    const tracks = [{ src: 'voice.mp3', startInFrames: 0, volume: 0.5 }];
    expect(clipAudioTracks(tracks, { from: 10, to: 20 })).toEqual([
      { src: 'voice.mp3', startInFrames: 0, offsetInFrames: 10, volume: 0.5 },
    ]);
  });

  it('plays exactly the frames of the range from the source, over generated tracks and ranges', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 500 }),
        (start, offset, length, from) => {
          const end = start + length;
          const to = from + 1 + ((length * 3) % 500);
          const [kept] = clipAudioTracks(
            [track({ startInFrames: start, offsetInFrames: offset, endInFrames: end })],
            {
              from,
              to,
            },
          );
          const overlapStart = Math.max(start, from);
          const overlapEnd = Math.min(end, to);
          // No timeline overlap means no audio in this range, so the clip is not declared.
          if (overlapStart >= overlapEnd) {
            if (kept !== undefined) throw new Error('a clip with no overlap was kept');
            return;
          }
          if (kept === undefined) throw new Error('the overlapping clip was dropped');
          const newStart = kept.startInFrames ?? 0;
          const newOffset = kept.offsetInFrames ?? 0;
          const newEnd = kept.endInFrames ?? Number.NaN;
          // The clip is silent before its new start, and the output is exactly the overlap long.
          expect(newStart).toBe(overlapStart - from);
          expect(newEnd - newStart).toBe(overlapEnd - overlapStart);
          // The source position the clip resumes from is where the overlap begins.
          expect(newOffset).toBe(offset + (overlapStart - start));
        },
      ),
    );
  });
});
