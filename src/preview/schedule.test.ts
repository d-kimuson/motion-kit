import { describe, expect, it } from 'vitest';

import { createFrameRate, frameToTime, toSeconds, type FrameRate } from '../core/timeline/time.ts';
import {
  audioSchedule,
  frameAnswered,
  idlePresenter,
  packLanes,
  playheadFrame,
  timecode,
  wantFrame,
} from './schedule.ts';

const rate = (numerator: number, denominator = 1): FrameRate => {
  const result = createFrameRate({ numerator, denominator });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const fps30 = rate(30);

describe('playheadFrame', () => {
  it('shows the paused frame', () => {
    expect(playheadFrame({ kind: 'paused', frame: 7 }, 99, fps30, 60)).toBe(7);
  });

  it('advances from the anchor by elapsed audio-clock seconds, floored', () => {
    const playing = { kind: 'playing', anchorFrame: 10, anchorTime: 2 } as const;
    expect(playheadFrame(playing, 2, fps30, 600)).toBe(10);
    expect(playheadFrame(playing, 2.0333, fps30, 600)).toBe(10);
    expect(playheadFrame(playing, 2.034, fps30, 600)).toBe(11);
    expect(playheadFrame(playing, 3, fps30, 600)).toBe(40);
  });

  it('keeps NTSC rates exact', () => {
    const playing = { kind: 'playing', anchorFrame: 0, anchorTime: 0 } as const;
    // 1001 s at 30000/1001 is exactly frame 30000.
    expect(playheadFrame(playing, 1001, rate(30000, 1001), 100_000)).toBe(30000);
    expect(playheadFrame(playing, 1000.999, rate(30000, 1001), 100_000)).toBe(29999);
  });

  it('clamps to the Composition', () => {
    const playing = { kind: 'playing', anchorFrame: 50, anchorTime: 0 } as const;
    expect(playheadFrame(playing, 10, fps30, 60)).toBe(59);
    expect(playheadFrame(playing, -10, fps30, 60)).toBe(0);
    expect(playheadFrame({ kind: 'paused', frame: 80 }, 0, fps30, 60)).toBe(59);
  });
});

describe('audioSchedule', () => {
  it('starts a later clip after a delay, from its offset', () => {
    expect(
      audioSchedule([{ src: 'voice.wav', startInFrames: 60, offsetInFrames: 15 }], 30, fps30, 300),
    ).toEqual([{ src: 'voice.wav', delay: 1, offset: 0.5, duration: 8, gain: 1 }]);
  });

  it('joins a clip already playing at the playhead', () => {
    expect(
      audioSchedule(
        [{ src: 'bgm.mp3', startInFrames: 30, endInFrames: 150, volume: 0.5 }],
        90,
        fps30,
        300,
      ),
    ).toEqual([{ src: 'bgm.mp3', delay: 0, offset: 2, duration: 2, gain: 0.5 }]);
  });

  it('caps every clip at the Composition duration, as the encoder does', () => {
    expect(audioSchedule([{ src: 'a.wav', endInFrames: 900 }], 0, fps30, 90)).toEqual([
      { src: 'a.wav', delay: 0, offset: 0, duration: 3, gain: 1 },
    ]);
  });

  it('drops clips that are over or empty, and keeps declaration order', () => {
    expect(
      audioSchedule(
        [
          { src: 'over.wav', endInFrames: 30 },
          { src: 'empty.wav', startInFrames: 60, endInFrames: 60 },
          { src: 'late.wav', startInFrames: 120 },
          { src: 'past-end.wav', startInFrames: 300 },
          { src: 'now.wav' },
        ],
        30,
        fps30,
        300,
      ).map(({ src }) => src),
    ).toEqual(['late.wav', 'now.wav']);
  });

  it('derives seconds from frames through the Time Module', () => {
    const ntsc = rate(30000, 1001);
    const oneFrame = toSeconds(frameToTime(1n, ntsc));
    const [clip] = audioSchedule([{ src: 'a.wav', startInFrames: 1 }], 0, ntsc, 2);
    expect(clip?.delay).toBe(oneFrame);
    expect(clip?.duration).toBe(oneFrame);
  });
});

describe('timecode', () => {
  it('formats minutes, seconds and floored centiseconds', () => {
    expect(timecode(0, fps30)).toBe('00:00.00');
    expect(timecode(1, fps30)).toBe('00:00.03');
    expect(timecode(30 * 75 + 15, fps30)).toBe('01:15.50');
    expect(timecode(30 * 3600, fps30)).toBe('60:00.00');
    expect(timecode(1, rate(30000, 1001))).toBe('00:00.03');
  });
});

describe('presenter', () => {
  it('sends a wanted frame when nothing is in flight', () => {
    expect(wantFrame(idlePresenter, 4)).toEqual({ state: { inFlight: 4, wanted: 4 }, send: 4 });
  });

  it('keeps one show in flight and sends the latest wanted frame when it answers', () => {
    const first = wantFrame(idlePresenter, 4).state;
    const second = wantFrame(first, 5);
    expect(second).toEqual({ state: { inFlight: 4, wanted: 5 } });
    const third = wantFrame(second.state, 6);
    expect(frameAnswered(third.state)).toEqual({ state: { inFlight: 6, wanted: 6 }, send: 6 });
  });

  it('goes idle when the answer is the latest wanted frame', () => {
    const pending = wantFrame(idlePresenter, 4).state;
    expect(frameAnswered(pending)).toEqual({ state: { inFlight: undefined, wanted: 4 } });
    expect(frameAnswered(wantFrame(wantFrame(pending, 9).state, 4).state)).toEqual({
      state: { inFlight: undefined, wanted: 4 },
    });
  });
});

describe('lanes', () => {
  it('packs intervals that do not overlap into the first free lane, in order', () => {
    const a = { start: 0, end: 10 };
    const b = { start: 10, end: 20 };
    const c = { start: 5, end: 15 };
    const d = { start: 15, end: 30 };
    const e = { start: 0, end: 40 };
    expect(packLanes([a, b, c, d, e])).toEqual([[a, b], [c, d], [e]]);
  });

  it('has no lanes for no intervals', () => {
    expect(packLanes([])).toEqual([]);
  });
});
