import { describe, expect, it } from 'vitest';

import { planHistories } from './history.ts';

describe('planHistories', () => {
  it('plans the first frame with only a later predecessor', () => {
    expect(planHistories({ frame: 0, durationInFrames: 10 })).toEqual({
      entries: [
        { history: 'cold', predecessor: null },
        { history: 'after-later', predecessor: 1 },
        { history: 'pool', predecessor: 1 },
      ],
      errors: [],
    });
  });

  it('plans the last frame with only an earlier predecessor', () => {
    expect(planHistories({ frame: 9, durationInFrames: 10 })).toEqual({
      entries: [
        { history: 'cold', predecessor: null },
        { history: 'after-earlier', predecessor: 8 },
        { history: 'pool', predecessor: 8 },
      ],
      errors: [],
    });
  });

  it('plans both directions and anchors the pool on the first predecessor', () => {
    expect(planHistories({ frame: 5, durationInFrames: 10 })).toEqual({
      entries: [
        { history: 'cold', predecessor: null },
        { history: 'after-earlier', predecessor: 4 },
        { history: 'after-later', predecessor: 6 },
        { history: 'pool', predecessor: 4 },
      ],
      errors: [],
    });
  });

  it('uses explicit predecessors instead of the defaults', () => {
    expect(planHistories({ frame: 5, durationInFrames: 10, predecessors: [7, 2] })).toEqual({
      entries: [
        { history: 'cold', predecessor: null },
        { history: 'after-earlier', predecessor: 2 },
        { history: 'after-later', predecessor: 7 },
        { history: 'pool', predecessor: 7 },
      ],
      errors: [],
    });
    expect(planHistories({ frame: 5, durationInFrames: 10, predecessors: [1] })).toEqual({
      entries: [
        { history: 'cold', predecessor: null },
        { history: 'after-earlier', predecessor: 1 },
        { history: 'pool', predecessor: 1 },
      ],
      errors: [],
    });
  });

  it('plans one entry per explicit predecessor of a direction', () => {
    expect(
      planHistories({
        frame: 5,
        durationInFrames: 10,
        predecessors: [1, 3],
        histories: ['after-earlier'],
      }),
    ).toEqual({
      entries: [
        { history: 'cold', predecessor: null },
        { history: 'after-earlier', predecessor: 1 },
        { history: 'after-earlier', predecessor: 3 },
      ],
      errors: [],
    });
  });

  it('reports a requested history that has no valid predecessor', () => {
    expect(planHistories({ frame: 0, durationInFrames: 10, histories: ['after-earlier'] })).toEqual(
      {
        entries: [{ history: 'cold', predecessor: null }],
        errors: [{ history: 'after-earlier', reason: 'no-valid-predecessor' }],
      },
    );
    expect(
      planHistories({
        frame: 5,
        durationInFrames: 10,
        predecessors: [],
        histories: ['pool'],
      }),
    ).toEqual({
      entries: [{ history: 'cold', predecessor: null }],
      errors: [{ history: 'pool', reason: 'no-valid-predecessor' }],
    });
  });

  it('reports a sample whose only possible history is cold', () => {
    expect(planHistories({ frame: 0, durationInFrames: 1 })).toEqual({
      entries: [{ history: 'cold', predecessor: null }],
      errors: [{ history: 'after-earlier', reason: 'sample-without-comparison' }],
    });
    expect(planHistories({ frame: 5, durationInFrames: 10, histories: ['cold'] })).toEqual({
      entries: [{ history: 'cold', predecessor: null }],
      errors: [{ history: 'cold', reason: 'sample-without-comparison' }],
    });
  });

  it('rejects duplicate and out-of-range input before planning', () => {
    expect(() => planHistories({ frame: -1, durationInFrames: 10 })).toThrow(/frame/);
    expect(() => planHistories({ frame: 10, durationInFrames: 10 })).toThrow(/frame/);
    expect(() => planHistories({ frame: 0, durationInFrames: 0 })).toThrow(/durationInFrames/);
    expect(() => planHistories({ frame: 5, durationInFrames: 10, predecessors: [3, 3] })).toThrow(
      /repeat/,
    );
    expect(() => planHistories({ frame: 5, durationInFrames: 10, predecessors: [10] })).toThrow(
      /predecessors/,
    );
    expect(() =>
      planHistories({ frame: 5, durationInFrames: 10, histories: ['pool', 'pool'] }),
    ).toThrow(/repeat/);
  });
});
