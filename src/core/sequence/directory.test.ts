import { describe, expect, it } from 'vitest';

import { type Result } from '../../lib/result.ts';
import { createFrameRate, createTimelineTime } from '../timeline/time.ts';
import {
  activeSequences,
  clipSequence,
  createSequenceDirectory,
  sequenceSpans,
} from './directory.ts';
import { createSequence, type SequenceInterval } from './interval.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const time = (numerator: number, denominator = 1) =>
  unwrap(createTimelineTime({ numerator, denominator }));
const interval = (start: number, duration: number, denominator = 1): SequenceInterval =>
  unwrap(createSequence(time(start, denominator), time(duration, denominator)));
const fps30 = unwrap(createFrameRate({ numerator: 30, denominator: 1 }));

describe('sequenceSpans', () => {
  it('reports the half-open frames whose presentation time lies in the interval', () => {
    expect(sequenceSpans([{ path: ['intro'], interval: interval(1, 1) }], fps30)).toEqual([
      { path: ['intro'], startFrame: 30, endFrame: 60 },
    ]);
  });

  it('rounds fractional endpoints up to the first frame at or after them', () => {
    const fps = unwrap(createFrameRate({ numerator: 30000, denominator: 1001 }));
    // 1001/30000 s is exactly frame 1; one tick later belongs to frame 2.
    expect(
      sequenceSpans(
        [
          { path: ['exact'], interval: interval(1001, 1001, 30000) },
          { path: ['late'], interval: interval(1002, 1001, 30000) },
        ],
        fps,
      ),
    ).toEqual([
      { path: ['exact'], startFrame: 1, endFrame: 2 },
      { path: ['late'], startFrame: 2, endFrame: 3 },
    ]);
  });

  it('keeps signed starts and ends past the composition without clamping', () => {
    expect(sequenceSpans([{ path: ['bleed'], interval: interval(-1, 12) }], fps30)).toEqual([
      { path: ['bleed'], startFrame: -30, endFrame: 330 },
    ]);
  });

  it('orders by start, then outer before inner, then path text', () => {
    const spans = sequenceSpans(
      [
        { path: ['b'], interval: interval(0, 1) },
        { path: ['a', 'inner'], interval: interval(0, 1) },
        { path: ['late'], interval: interval(2, 1) },
        { path: ['a'], interval: interval(0, 1) },
      ],
      fps30,
    );
    expect(spans.map(({ path }) => path.join(' > '))).toEqual(['a', 'b', 'a > inner', 'late']);
  });

  it('does not depend on registration order, including siblings that share a name', () => {
    const entries = [
      { path: ['shot'], interval: interval(0, 2) },
      { path: ['shot'], interval: interval(0, 1) },
      { path: ['shot', 'caption'], interval: interval(0, 1) },
      { path: ['other'], interval: interval(0, 1) },
    ];
    const expected = [
      { path: ['other'], startFrame: 0, endFrame: 30 },
      { path: ['shot'], startFrame: 0, endFrame: 30 },
      { path: ['shot'], startFrame: 0, endFrame: 60 },
      { path: ['shot', 'caption'], startFrame: 0, endFrame: 30 },
    ];
    expect(sequenceSpans(entries, fps30)).toEqual(expected);
    expect(sequenceSpans(entries.toReversed(), fps30)).toEqual(expected);
  });

  it('compares paths segment by segment, whatever characters a name holds', () => {
    const entries = [
      { path: ['a\u0000b', 'c'], interval: interval(0, 1) },
      { path: ['a', 'b\u0000c'], interval: interval(0, 1) },
    ];
    const paths = (order: typeof entries) => sequenceSpans(order, fps30).map(({ path }) => path);
    expect(paths(entries)).toEqual([
      ['a', 'b\u0000c'],
      ['a\u0000b', 'c'],
    ]);
    expect(paths(entries.toReversed())).toEqual(paths(entries));
  });
});

describe('activeSequences', () => {
  const spans = sequenceSpans(
    [
      { path: ['intro'], interval: interval(0, 1) },
      { path: ['intro', 'title'], interval: interval(15, 15, 30) },
      { path: ['body'], interval: interval(1, 1) },
      { path: ['empty'], interval: interval(1, 0) },
    ],
    fps30,
  );

  it('includes the start frame and excludes the end frame', () => {
    expect(activeSequences(spans, 29).map(({ path }) => path)).toEqual([
      ['intro'],
      ['intro', 'title'],
    ]);
    expect(activeSequences(spans, 30).map(({ path }) => path)).toEqual([['body']]);
    expect(activeSequences(spans, 60)).toEqual([]);
  });

  it('lists every enclosing named Sequence from outer to inner', () => {
    expect(activeSequences(spans, 14).map(({ path }) => path)).toEqual([['intro']]);
    expect(activeSequences(spans, 15).map(({ path }) => path)).toEqual([
      ['intro'],
      ['intro', 'title'],
    ]);
  });

  it('never reports a zero-length Sequence as active', () => {
    expect(activeSequences(spans, 30).some(({ path }) => path[0] === 'empty')).toBe(false);
  });
});

describe('clipSequence', () => {
  it('limits a child to the frames its ancestors can show', () => {
    expect(clipSequence(interval(1, 2), interval(0, 10))).toEqual(interval(1, 2));
    expect(clipSequence(interval(1, 2), interval(2, 4))).toEqual(interval(2, 1));
  });

  it('collapses a disjoint child to an empty interval at the nearer clip edge', () => {
    expect(clipSequence(interval(0, 1), interval(5, 1))).toEqual(interval(5, 0));
    expect(clipSequence(interval(8, 1), interval(5, 1))).toEqual(interval(6, 0));
  });
});

describe('createSequenceDirectory', () => {
  it('lists registrations until each one is released', () => {
    const directory = createSequenceDirectory();
    const intro = { path: ['intro'], interval: interval(0, 1) } as const;
    const body = { path: ['body'], interval: interval(1, 1) } as const;
    const releaseIntro = directory.register(intro);
    const releaseBody = directory.register(body);
    expect(directory.entries()).toEqual([intro, body]);
    releaseIntro();
    releaseIntro();
    expect(directory.entries()).toEqual([body]);
    releaseBody();
    expect(directory.entries()).toEqual([]);
  });
});
