import { describe, expect, it } from 'vitest';

import { createFrameRate } from '../../core/timeline/time.ts';
import { audioEntries, sequenceEntries } from './timeline.ts';

const created = createFrameRate({ numerator: 30000, denominator: 1001 });
if (!created.ok) throw new Error('the test rate must be valid');
const ntsc = created.value;
const fps30 = (() => {
  const rate = createFrameRate({ numerator: 30, denominator: 1 });
  if (!rate.ok) throw new Error('the test rate must be valid');
  return rate.value;
})();

describe('sequenceEntries', () => {
  it('names a Sequence by the last segment of its path and converts frames to seconds', () => {
    expect(
      sequenceEntries([{ path: ['intro', 'title'], startFrame: 15, endFrame: 45 }], fps30),
    ).toEqual([
      {
        name: 'title',
        path: ['intro', 'title'],
        startFrame: 15,
        endFrame: 45,
        startSeconds: 0.5,
        endSeconds: 1.5,
      },
    ]);
  });

  it('converts through the rational rate, never a rounded one', () => {
    const [entry] = sequenceEntries([{ path: ['a'], startFrame: 0, endFrame: 30000 }], ntsc);
    expect(entry?.endSeconds).toBeCloseTo(1001, 9);
  });
});

describe('audioEntries', () => {
  it('applies every default and clips an open end to the Composition', () => {
    expect(audioEntries([{ src: 'a.wav' }], 90, fps30)).toEqual([
      {
        src: 'a.wav',
        startInFrames: 0,
        endInFrames: 90,
        startSeconds: 0,
        endSeconds: 3,
        endDeclared: false,
        offsetInFrames: 0,
        volume: 1,
      },
    ]);
  });

  it('keeps a declared window and its trim and gain', () => {
    expect(
      audioEntries(
        [{ src: 'a.wav', startInFrames: 15, endInFrames: 45, offsetInFrames: 3, volume: 0 }],
        90,
        fps30,
      ),
    ).toEqual([
      {
        src: 'a.wav',
        startInFrames: 15,
        endInFrames: 45,
        startSeconds: 0.5,
        endSeconds: 1.5,
        endDeclared: true,
        offsetInFrames: 3,
        volume: 0,
      },
    ]);
  });

  it('cuts a clip at the Composition end and gives an unheard clip an empty span', () => {
    const [past, unheard] = audioEntries(
      [
        { src: 'a.wav', startInFrames: 80, endInFrames: 200 },
        { src: 'b.wav', startInFrames: 120 },
      ],
      90,
      fps30,
    );
    expect(past).toMatchObject({ startInFrames: 80, endInFrames: 90, endDeclared: true });
    expect(unheard).toMatchObject({ startInFrames: 120, endInFrames: 120, endDeclared: false });
  });

  it('keeps declaration order', () => {
    expect(audioEntries([{ src: 'b.wav' }, { src: 'a.wav' }], 10, fps30).map((c) => c.src)).toEqual(
      ['b.wav', 'a.wav'],
    );
  });
});
