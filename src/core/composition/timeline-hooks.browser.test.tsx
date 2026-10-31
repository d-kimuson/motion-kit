import {
  Composition,
  createCompositionRuntime,
  createTimelineTime,
  defineComposition,
  defineCompositions,
  Sequence,
  toSeconds,
  TransitionScene,
  TransitionSeries,
  useFrame,
  useSequence,
  useTime,
  useTimeline,
  type FrameRate,
  type FrameSnapshot,
  type RationalInput,
  type Result,
  type SequenceContext,
  type SequenceSpan,
  type TimelineContext,
} from '@kimuson/motion-kit';
import fc from 'fast-check';
import { Component, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import { activeSequences } from '../sequence/directory.ts';

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const metadata = {
  id: 'timeline',
  width: 1920,
  height: 1080,
  fps: { numerator: 30000, denominator: 1001 },
  durationInFrames: 300,
};
const Probe = ({ name = 'probe' }: { name?: string }) => {
  const sequence = useSequence();
  const timeline = useTimeline();
  const time = useTime();
  const frame = useFrame();
  expectTypeOf(sequence).toEqualTypeOf<SequenceContext>();
  expectTypeOf(timeline).toEqualTypeOf<TimelineContext>();
  expectTypeOf(timeline.frameRate).toEqualTypeOf<FrameRate>();
  expectTypeOf(time).toEqualTypeOf<number>();
  expectTypeOf(frame).toEqualTypeOf<number>();
  return (
    <output data-probe={name}>
      {JSON.stringify({ time, frame, sequence, timeline }, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      )}
    </output>
  );
};

const withScene = async (
  scene: () => ReactNode,
  check: (fixture: {
    seek: (frame: number) => Promise<void>;
    read: (name?: string) => unknown;
    container: HTMLDivElement;
    runtime: ReturnType<typeof createCompositionRuntime>;
    errors: Error[];
  }) => Promise<void>,
  fps: RationalInput = metadata.fps,
  wrapRuntime: (
    runtime: ReturnType<typeof createCompositionRuntime>,
  ) => ReturnType<typeof createCompositionRuntime> = (runtime) => runtime,
) => {
  const definition = unwrap(
    await unwrap(
      defineCompositions([
        defineComposition({ ...metadata, fps, component: scene, schema: z.object({}) }),
      ]),
    ).mount({ revision: 'hooks' }),
  );
  const runtime = wrapRuntime(
    createCompositionRuntime({
      definition,
      instance: 'hooks',
      compositionRealm: 'hooks-page',
    }),
  );
  const container = document.createElement('div');
  document.body.append(container);
  const errors: Error[] = [];
  const root = createRoot(container, {
    onCaughtError: (error) => {
      if (error instanceof Error) errors.push(error);
    },
  });
  let request = 0;
  try {
    flushSync(() =>
      root.render(<Composition definition={definition} compositionRuntime={runtime} />),
    );
    expect(container.textContent).toBe('');
    await check({
      container,
      runtime,
      errors,
      seek: async (frame) => {
        const result = await runtime.settleFrame(frame, {
          source: 'renderer',
          requestId: `hooks-${request++}`,
        });
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') throw new Error('frame did not settle');
        expect(runtime.completeCapture(result.lease)).toEqual({ status: 'accepted' });
      },
      read: (name = 'probe'): unknown => {
        const text = container.querySelector(`[data-probe="${name}"]`)?.textContent;
        return text === undefined || text === null ? null : JSON.parse(text);
      },
    });
  } finally {
    flushSync(() => root.unmount());
    expect(runtime.dispose().ok).toBe(true);
    container.remove();
  }
};

const expectedGlobal = {
  time: 1.001,
  duration: 10.01,
  remaining: 9.009,
  progress: 0.1,
  localFramePosition: 30,
  fps: 30000 / 1001,
  globalTime: 1.001,
  globalFrame: 30,
};
const expectedTimeline = {
  ...expectedGlobal,
  id: 'timeline',
  width: 1920,
  height: 1080,
  durationInFrames: 300,
  frameRate: { numerator: '30000', denominator: '1001' },
};

// Decimal conversion is lossy, so assert numbers with tolerance, but every field/key is required.
const expectValues = (actual: unknown, expected: unknown): void => {
  if (typeof expected === 'number') {
    expect(actual).toBeTypeOf('number');
    expect(actual).toBeCloseTo(expected, 12);
  } else if (typeof expected === 'object' && expected !== null) {
    expect(actual).toBeTypeOf('object');
    if (typeof actual !== 'object' || actual === null) throw new Error('missing object');
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      expectValues(Object.getOwnPropertyDescriptor(actual, key)?.value, value);
    }
  } else expect(actual).toBe(expected);
};

describe('public timeline hooks', () => {
  it('returns every composition-scoped value outside a Sequence at rational FPS', async () => {
    await withScene(
      () => <Probe />,
      async ({ seek, read, runtime }) => {
        await seek(30);
        expectValues(read(), {
          time: 1.001,
          frame: 30,
          sequence: expectedGlobal,
          timeline: expectedTimeline,
        });
        expect(runtime.getSnapshot()?.presentationTime).toMatchObject({
          numerator: 1001n,
          denominator: 1000n,
        });
        await seek(0);
        expect(read()).toMatchObject({
          time: 0,
          frame: 0,
          sequence: { progress: 0, remaining: 10.01 },
        });
        await seek(299);
        expect(read()).toMatchObject({ frame: 299, sequence: { globalFrame: 299 } });
      },
    );
  });

  it('reads the runtime Presentation Time snapshot rather than reconstructing it from globalFrame', async () => {
    await withScene(
      () => (
        <>
          <Probe name="global" />
          <Sequence from={0.5} duration={3}>
            <Sequence from={0.25} duration={2}>
              <Probe />
            </Sequence>
          </Sequence>
        </>
      ),
      async ({ seek, read, runtime }) => {
        await seek(30);
        // Deliberately disagree with globalFrame: only the runtime's time is authoritative.
        expect(runtime.getSnapshot()?.globalFrame).toBe(30);
        expect(read('global')).toMatchObject({
          time: 2.002,
          frame: 60,
          sequence: { time: 2.002, globalTime: 2.002, globalFrame: 60 },
          timeline: { time: 2.002, globalTime: 2.002, globalFrame: 60 },
        });
        expect(read()).toMatchObject({
          time: 1.252,
          frame: 60,
          sequence: { time: 1.252, globalTime: 2.002, globalFrame: 60 },
          timeline: { time: 2.002, globalTime: 2.002, globalFrame: 60 },
        });
      },
      metadata.fps,
      (runtime) => {
        const getSnapshot = runtime.getSnapshot;
        const snapshots = new WeakMap<FrameSnapshot, FrameSnapshot>();
        const presentationTime = unwrap(createTimelineTime({ numerator: 1001, denominator: 500 }));
        return {
          ...runtime,
          getSnapshot: () => {
            const snapshot = getSnapshot();
            if (snapshot === null) return null;
            // useSyncExternalStore requires stable identity until the owned snapshot changes.
            let overridden = snapshots.get(snapshot);
            if (overridden === undefined) {
              overridden = Object.freeze({ ...snapshot, presentationTime });
              snapshots.set(snapshot, overridden);
            }
            return overridden;
          },
        };
      },
    );
  });

  it.each([
    { fps: { numerator: 1, denominator: 1 }, frame: 0, framePosition: 0.5 },
    {
      fps: metadata.fps,
      frame: 14,
      framePosition: toSeconds(unwrap(createTimelineTime({ numerator: 15000, denominator: 1001 }))),
    },
  ])(
    'preserves non-grid Presentation Time at $fps.numerator/$fps.denominator fps',
    async ({ fps, frame, framePosition }) => {
      await withScene(
        () => <Probe />,
        async ({ seek, read, runtime }) => {
          await seek(30);
          // The public runtime contract supplies time independently of the requested frame.
          expect(runtime.getSnapshot()?.globalFrame).toBe(30);
          expect(read()).toMatchObject({
            time: 0.5,
            frame,
            sequence: {
              time: 0.5,
              globalTime: 0.5,
              globalFrame: frame,
              localFramePosition: framePosition,
            },
            timeline: {
              time: 0.5,
              globalTime: 0.5,
              globalFrame: frame,
              localFramePosition: framePosition,
            },
          });
        },
        fps,
        (runtime) => {
          const snapshots = new WeakMap<FrameSnapshot, FrameSnapshot>();
          const presentationTime = unwrap(createTimelineTime(0.5));
          return {
            ...runtime,
            getSnapshot: () => {
              const snapshot = runtime.getSnapshot();
              if (snapshot === null) return null;
              // Keep useSyncExternalStore snapshots stable until the runtime advances.
              let overridden = snapshots.get(snapshot);
              if (overridden === undefined) {
                overridden = Object.freeze({ ...snapshot, presentationTime });
                snapshots.set(snapshot, overridden);
              }
              return overridden;
            },
          };
        },
      );
    },
  );

  it('converts local time to seconds and rational fps to decimal without rounding localFramePosition', async () => {
    await withScene(
      () => (
        <Sequence from={0.5} duration={2}>
          <Probe />
        </Sequence>
      ),
      async ({ seek, read }) => {
        await seek(30);
        expectValues(read(), {
          time: 0.501,
          frame: 30,
          sequence: {
            time: 0.501,
            duration: 2,
            remaining: 1.499,
            progress: 0.2505,
            localFramePosition: 15030 / 1001,
            fps: 30000 / 1001,
            globalTime: 1.001,
            globalFrame: 30,
          },
          timeline: expectedTimeline,
        });
        expect(read()).toMatchObject({
          sequence: {
            localFramePosition: toSeconds(
              unwrap(createTimelineTime({ numerator: 15030, denominator: 1001 })),
            ),
          },
        });
      },
    );
  });

  it('composes nested Sequence offsets while keeping useTimeline and useFrame global', async () => {
    await withScene(
      () => (
        <Sequence from={0.5} duration={2}>
          <Sequence from={0.25} duration={1}>
            <Probe />
          </Sequence>
        </Sequence>
      ),
      async ({ seek, read }) => {
        await seek(30);
        expectValues(read(), {
          time: 0.251,
          frame: 30,
          sequence: {
            time: 0.251,
            duration: 1,
            remaining: 0.749,
            progress: 0.251,
            localFramePosition: 7530 / 1001,
            fps: 30000 / 1001,
            globalTime: 1.001,
            globalFrame: 30,
          },
          timeline: expectedTimeline,
        });
        // .251 * (30000/1001) = 7530/1001; convert this exact result only once.
        expect(read()).toMatchObject({
          sequence: {
            localFramePosition: toSeconds(
              unwrap(createTimelineTime({ numerator: 7530, denominator: 1001 })),
            ),
          },
        });
      },
    );
  });

  it('matches sequential values under seeded random, reverse and repeated frame requests', async () => {
    await withScene(
      () => (
        <>
          <Probe name="global" />
          <Sequence from={0.5} duration={2}>
            <Probe name="outer" />
            <Sequence from={0.25} duration={0.75}>
              <Probe name="inner" />
            </Sequence>
          </Sequence>
        </>
      ),
      async ({ seek, container }) => {
        const frames = Array.from({ length: 90 }, (_, index) => index);
        const sequential = new Map<number, string>();
        for (const frame of frames) {
          await seek(frame);
          sequential.set(frame, container.textContent ?? '');
        }
        expect(new Set(sequential.values()).size).toBe(90);
        const orders = fc.sample(
          fc.shuffledSubarray(frames, { minLength: frames.length, maxLength: frames.length }),
          { seed: 154, numRuns: 3 },
        );
        orders.push(frames.toReversed(), [30, 0, 30, 89, 30]);
        for (const order of orders)
          for (const frame of order) {
            await seek(frame);
            expect(container.textContent).toBe(sequential.get(frame));
          }
      },
    );
  });
});

describe('Sequence membership', () => {
  it('includes start, excludes end, and switches adjacent sequences at the exact boundary', async () => {
    await withScene(
      () => (
        <>
          <Sequence from={1} duration={1}>
            <Probe name="first" />
          </Sequence>
          <Sequence from={2} duration={1}>
            <Probe name="second" />
          </Sequence>
        </>
      ),
      async ({ seek, read }) => {
        for (const [frame, first, second] of [
          [29, false, false],
          [30, true, false],
          [59, true, false],
          [60, false, true],
          [90, false, false],
        ] as const) {
          await seek(frame);
          expect(read('first') !== null).toBe(first);
          expect(read('second') !== null).toBe(second);
        }
        await seek(30);
        expect(read('first')).toMatchObject({
          time: 0,
          sequence: { progress: 0, remaining: 1 },
        });
      },
      { numerator: 30, denominator: 1 },
    );
  });

  it('preserves exact rational boundaries at 30000/1001 fps', async () => {
    await withScene(
      () => (
        <Sequence
          from={{ numerator: 1001, denominator: 30000 }}
          duration={{ numerator: 1001, denominator: 30000 }}
        >
          <Probe />
        </Sequence>
      ),
      async ({ seek, read }) => {
        for (const [frame, active] of [
          [0, false],
          [1, true],
          [2, false],
        ] as const) {
          await seek(frame);
          expect(read() !== null).toBe(active);
        }
        await seek(1);
        expect(read()).toMatchObject({
          time: 0,
          sequence: { localFramePosition: 0, progress: 0 },
        });
      },
    );
  });

  it('clips nested membership to the parent without changing the child duration or offset', async () => {
    await withScene(
      () => (
        <Sequence from={1} duration={2}>
          <Sequence from={-0.5} duration={4}>
            <Probe />
          </Sequence>
          <Sequence from={0.5} duration={0.5}>
            <Probe name="inner" />
          </Sequence>
        </Sequence>
      ),
      async ({ seek, read }) => {
        for (const [frame, outer, inner] of [
          [29, false, false],
          [30, true, false],
          [45, true, true],
          [60, true, false],
          [89, true, false],
          [90, false, false],
        ] as const) {
          await seek(frame);
          expect(read() !== null).toBe(outer);
          expect(read('inner') !== null).toBe(inner);
        }
        await seek(30);
        expect(read()).toMatchObject({
          time: 0.5,
          sequence: { duration: 4, remaining: 3.5, localFramePosition: 15 },
        });
      },
      { numerator: 30, denominator: 1 },
    );
  });

  it('never renders children of a zero-length Sequence, including at its start', async () => {
    const Empty = vi.fn(() => <Probe />);
    await withScene(
      () => (
        <Sequence from={1} duration={0}>
          <Empty />
        </Sequence>
      ),
      async ({ seek, read }) => {
        for (const frame of [29, 30, 31]) {
          await seek(frame);
          expect(read()).toBeNull();
        }
        expect(Empty).not.toHaveBeenCalled();
      },
      { numerator: 30, denominator: 1 },
    );
  });

  it('allows signed starts and ends past composition duration, clipping only visibility', async () => {
    await withScene(
      () => (
        <Sequence from={-1} duration={12}>
          <Probe />
        </Sequence>
      ),
      async ({ seek, read, runtime }) => {
        await seek(0);
        expect(read()).toMatchObject({
          time: 1,
          sequence: { duration: 12, remaining: 11, globalFrame: 0 },
        });
        await seek(299);
        expectValues(read(), {
          time: 329 / 30,
          frame: 299,
          sequence: {
            time: 329 / 30,
            duration: 12,
            remaining: 31 / 30,
            progress: 329 / 360,
            localFramePosition: 329,
            fps: 30,
            globalTime: 299 / 30,
            globalFrame: 299,
          },
          timeline: {
            time: 299 / 30,
            duration: 10,
            remaining: 1 / 30,
            progress: 299 / 300,
            localFramePosition: 299,
            fps: 30,
            globalTime: 299 / 30,
            globalFrame: 299,
            id: 'timeline',
            width: 1920,
            height: 1080,
            durationInFrames: 300,
            frameRate: { numerator: '30', denominator: '1' },
          },
        });
        expect(
          await runtime.settleFrame(300, { source: 'renderer', requestId: 'past-end' }),
        ).toMatchObject({ status: 'failed' });
      },
      { numerator: 30, denominator: 1 },
    );
  });

  it.each([
    { from: 0, duration: -1 },
    { from: Number.NaN, duration: 1 },
    { from: 0, duration: Number.POSITIVE_INFINITY },
    { from: { numerator: 1, denominator: 0 }, duration: 1 },
    { from: 0, duration: 1, name: '' },
  ])('rejects invalid authored range %j rather than rendering children', async (props) => {
    const Invalid = vi.fn(() => <Probe />);
    await withScene(
      () => (
        <Sequence {...props}>
          <Invalid />
        </Sequence>
      ),
      async ({ runtime, errors }) => {
        const result = await runtime.settleFrame(0, { source: 'renderer', requestId: 'invalid' });
        expect(result).toMatchObject({
          status: 'failed',
          diagnostics: [{ code: 'render.page-error' }],
        });
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]?.message).toContain('Sequence');
        expect(Invalid).not.toHaveBeenCalled();
      },
    );
  });
});

describe('named Sequences', () => {
  const fps30 = { numerator: 30, denominator: 1 };
  const path = (spans: readonly SequenceSpan[]) => spans.map((span) => span.path.join(' > '));

  it('reports mounted spans clipped to their ancestors, skipping unnamed Sequences', async () => {
    await withScene(
      () => (
        <>
          <Sequence name="intro" from={0} duration={2}>
            <Sequence from={0.5} duration={1}>
              <Sequence name="title" from={0} duration={2}>
                <Probe name="title" />
              </Sequence>
            </Sequence>
          </Sequence>
          <Sequence name="body" from={2} duration={1}>
            <Probe name="body" />
          </Sequence>
          <Sequence from={3} duration={1}>
            <Probe name="unnamed" />
          </Sequence>
        </>
      ),
      async ({ seek, runtime }) => {
        expectTypeOf(runtime.sequences()).toEqualTypeOf<readonly SequenceSpan[]>();
        await seek(0);
        expect(runtime.sequences()).toEqual([
          { path: ['intro'], startFrame: 0, endFrame: 60 },
          { path: ['body'], startFrame: 60, endFrame: 90 },
        ]);
        await seek(15);
        expect(runtime.sequences()).toEqual([
          { path: ['intro'], startFrame: 0, endFrame: 60 },
          { path: ['intro', 'title'], startFrame: 15, endFrame: 45 },
          { path: ['body'], startFrame: 60, endFrame: 90 },
        ]);
        for (const [frame, active] of [
          [14, ['intro']],
          [15, ['intro', 'intro > title']],
          [44, ['intro', 'intro > title']],
          [59, ['intro']],
          [60, ['body']],
          [90, []],
        ] as const) {
          await seek(frame);
          expect(path(activeSequences(runtime.sequences(), frame))).toEqual(active);
        }
        await seek(45);
        expect(path(runtime.sequences())).toEqual(['intro', 'body']);
      },
      fps30,
    );
  });

  it('names TransitionSeries scenes on the same path', async () => {
    await withScene(
      () => (
        <Sequence name="part" from={1} duration={4}>
          <TransitionSeries>
            <TransitionScene name="a" duration={1}>
              <Probe name="a" />
            </TransitionScene>
            <TransitionScene duration={1}>
              <Probe name="b" />
            </TransitionScene>
          </TransitionSeries>
        </Sequence>
      ),
      async ({ seek, runtime }) => {
        await seek(30);
        expect(runtime.sequences()).toEqual([
          { path: ['part'], startFrame: 30, endFrame: 150 },
          { path: ['part', 'a'], startFrame: 30, endFrame: 60 },
        ]);
      },
      fps30,
    );
  });

  it('renders the same output with and without names', async () => {
    const scene = (named: boolean) => () => (
      <Sequence from={1} duration={1} {...(named ? { name: 'shot' } : {})}>
        <Sequence from={0.5} duration={0.5} {...(named ? { name: 'caption' } : {})}>
          <Probe />
        </Sequence>
      </Sequence>
    );
    const outputs = new Map<boolean, unknown[]>();
    const spans = new Map<boolean, readonly SequenceSpan[]>();
    for (const named of [false, true]) {
      await withScene(
        scene(named),
        async ({ seek, read, runtime }) => {
          const seen: unknown[] = [];
          for (const frame of [0, 30, 45, 59, 60]) {
            await seek(frame);
            seen.push(read());
          }
          outputs.set(named, seen);
          spans.set(named, runtime.sequences());
        },
        fps30,
      );
    }
    expect(outputs.get(true)).toEqual(outputs.get(false));
    expect(spans.get(false)).toEqual([]);
    expect(path(spans.get(true) ?? [])).toEqual(['shot']);
  });
});

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

it.each([useTime, useFrame, useSequence, useTimeline])(
  '%s rejects use outside Composition',
  (hook) => {
    const errors: unknown[] = [];
    const container = document.createElement('div');
    const root = createRoot(container, {
      onCaughtError: (error) => {
        errors.push(error);
      },
    });
    const Invalid = () => {
      hook();
      return <output>unexpected fallback</output>;
    };
    try {
      flushSync(() =>
        root.render(
          <ErrorBoundary>
            <Invalid />
          </ErrorBoundary>,
        ),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(Error);
      expect(errors[0]).toHaveProperty(
        'message',
        'useCompositionFrame requires a Composition provider.',
      );
      expect(container.childNodes).toHaveLength(0);
    } finally {
      flushSync(() => root.unmount());
    }
  },
);
