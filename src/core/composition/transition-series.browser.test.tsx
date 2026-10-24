import fc from 'fast-check';
import {
  Composition,
  createCompositionRuntime,
  createTimelineTime,
  createTransitionSeries,
  defineComposition,
  defineCompositions,
  Sequence,
  toSeconds,
  Transition,
  TransitionScene,
  TransitionSeries,
  useFrame,
  useSequence,
  useTime,
  useTimeline,
  useTransitionProgress,
  type RationalInput,
  type Result,
  type TransitionProps,
  type TransitionSceneProps,
  type TransitionSeriesProps,
} from 'motion-kit';
import { useLayoutEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

const unwrap = <T,>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const seconds = (value: number | RationalInput) => unwrap(createTimelineTime(value));
const Probe = ({ name }: { name: string }) => {
  const sequence = useSequence();
  const timeline = useTimeline();
  return (
    <output data-probe={name}>
      {JSON.stringify({
        sequence,
        time: useTime(),
        frame: useFrame(),
        globalTime: timeline.time,
      })}
    </output>
  );
};
const Progress = ({ name = 'overlap' }: { name?: string }) => {
  const progress = useTransitionProgress();
  expectTypeOf(progress).toEqualTypeOf<number>();
  return (
    <>
      <output data-progress={name}>{progress}</output>
      <Probe name={name} />
    </>
  );
};
const withScene = async (
  scene: () => ReactNode,
  check: (fixture: {
    seek: (frame: number) => Promise<void>;
    read: (name: string) => unknown;
    progress: (name?: string) => string | null;
    container: HTMLDivElement;
    runtime: ReturnType<typeof createCompositionRuntime>;
    errors: Error[];
  }) => Promise<void>,
  fps: RationalInput = { numerator: 4, denominator: 1 },
) => {
  const definition = unwrap(
    await unwrap(
      defineCompositions([
        defineComposition({
          id: 'transitions',
          width: 640,
          height: 480,
          durationInFrames: 300,
          fps,
          component: scene,
          schema: z.object({}),
        }),
      ]),
    ).mount({ revision: 'transitions' }),
  );
  const runtime = createCompositionRuntime({
    definition,
    instance: 'transitions',
    compositionRealm: 'transitions-page',
  });
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
    await check({
      container,
      runtime,
      errors,
      seek: async (frame) => {
        const result = await runtime.settleFrame(frame, {
          source: 'renderer',
          requestId: `transition-${request++}`,
        });
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') throw new Error('frame did not settle');
        expect(runtime.completeCapture(result.lease)).toEqual({ status: 'accepted' });
      },
      read: (name): unknown => {
        const text = container.querySelector(`[data-probe="${name}"]`)?.textContent;
        return text === null || text === undefined ? null : JSON.parse(text);
      },
      progress: (name = 'overlap') =>
        container.querySelector(`[data-progress="${name}"]`)?.textContent ?? null,
    });
  } finally {
    flushSync(() => root.unmount());
    expect(runtime.dispose().ok).toBe(true);
    container.remove();
  }
};

const ThreeScenes = () => (
  <TransitionSeries>
    <TransitionScene duration={2}>
      <Probe name="a" />
    </TransitionScene>
    <Transition duration={0.5}>
      <Progress />
    </Transition>
    <TransitionScene duration={3}>
      <Probe name="b" />
    </TransitionScene>
    <Transition duration={0.25}>
      <Progress name="second" />
    </Transition>
    <TransitionScene duration={1}>
      <Probe name="c" />
    </TransitionScene>
  </TransitionSeries>
);

describe('TransitionSeries public components', () => {
  it('exports minimal typed props', () => {
    expectTypeOf<TransitionProps>().toEqualTypeOf<{
      duration: number | RationalInput;
      children?: ReactNode;
    }>();
    expectTypeOf<TransitionSceneProps>().toEqualTypeOf<{
      duration: number | RationalInput;
      children: ReactNode;
    }>();
    expectTypeOf<TransitionSeriesProps>().toEqualTypeOf<{ children?: ReactNode }>();
  });

  it('mounts both scenes during overlaps and ends at sum of scenes minus overlaps', async () => {
    const timing = unwrap(createTransitionSeries([2, 3, 1].map(seconds), [0.5, 0.25].map(seconds)));
    expect(toSeconds(timing.duration)).toBe(5.25); // CONTEXT.md: 2 + 3 + 1 - .5 - .25
    await withScene(ThreeScenes, async ({ seek, read, progress, container }) => {
      for (const [frame, names] of [
        [0, ['a']],
        [5, ['a']],
        [6, ['a', 'b']],
        [7, ['a', 'b']],
        [8, ['b']],
        [16, ['b']],
        [17, ['b', 'c']],
        [18, ['c']],
        [20, ['c']],
        [21, []],
        [22, []],
      ] as const) {
        await seek(frame);
        expect(['a', 'b', 'c'].filter((name) => read(name) !== null)).toEqual(names);
      }
      expect(container.textContent).toBe('');
      await seek(0);
      expect(read('a')).toEqual({
        time: 0,
        frame: 0,
        globalTime: 0,
        sequence: {
          time: 0,
          duration: 2,
          remaining: 2,
          progress: 0,
          localFramePosition: 0,
          fps: 4,
          globalTime: 0,
          globalFrame: 0,
        },
      });
      await seek(6);
      expect(progress()).toBe('0');
      expect(read('b')).toMatchObject({
        time: 0,
        frame: 6,
        sequence: { duration: 3, remaining: 3, progress: 0 },
      });
      await seek(7);
      expect(progress()).toBe('0.5');
      expect(read('a')).toMatchObject({
        time: 1.75,
        sequence: { progress: 0.875, remaining: 0.25 },
      });
      expect(read('b')).toMatchObject({
        time: 0.25,
        sequence: { localFramePosition: 1, remaining: 2.75 },
      });
      expect(read('overlap')).toMatchObject({
        time: 0.25,
        sequence: { duration: 0.5, progress: 0.5 },
      });
      await seek(8);
      expect(progress()).toBeNull();
      await seek(20);
      expect(read('c')).toMatchObject({
        time: 0.75,
        sequence: { duration: 1, remaining: 0.25, progress: 0.75 },
      });
    });
  });

  it('actually unmounts scene and transition children at the exclusive boundary', async () => {
    const events: string[] = [];
    const Mounted = ({ name }: { name: string }) => {
      useLayoutEffect(() => {
        events.push(`mount:${name}`);
        return () => {
          events.push(`unmount:${name}`);
        };
      }, [name]);
      return <Probe name={name} />;
    };
    await withScene(
      () => (
        <TransitionSeries>
          <TransitionScene duration={2}>
            <Mounted name="a" />
          </TransitionScene>
          <Transition duration={1}>
            <Mounted name="overlap" />
          </Transition>
          <TransitionScene duration={2}>
            <Mounted name="b" />
          </TransitionScene>
        </TransitionSeries>
      ),
      async ({ seek, read }) => {
        await seek(0);
        expect(events).toEqual(['mount:a']);
        await seek(4);
        expect(events).toEqual(['mount:a', 'mount:b', 'mount:overlap']);
        await seek(7);
        expect(events).toHaveLength(3);
        await seek(8);
        expect(events.slice(3).sort()).toEqual(['unmount:a', 'unmount:overlap']);
        expect(read('a')).toBeNull();
        expect(read('b')).toMatchObject({ time: 1 });
        await seek(12);
        expect(events.at(-1)).toBe('unmount:b');
        expect(read('b')).toBeNull();
      },
    );
  });

  it('places scenes absolutely under a non-grid parent and preserves nested hook values at rational FPS', async () => {
    await withScene(
      () => (
        <Sequence from={0.01} duration={2}>
          <TransitionSeries>
            <TransitionScene duration={1}>
              <Probe name="a" />
            </TransitionScene>
            <Transition duration={0.5}>
              <Progress />
            </Transition>
            <TransitionScene duration={1}>
              <Probe name="b" />
              <Sequence from={0.25} duration={0.5}>
                <Probe name="nested" />
              </Sequence>
            </TransitionScene>
          </TransitionSeries>
        </Sequence>
      ),
      async ({ seek, read, progress }) => {
        await seek(0);
        expect(read('a')).toBeNull();
        await seek(1);
        expect(read('a')).toMatchObject({
          time: toSeconds(seconds({ numerator: 701, denominator: 30000 })),
          sequence: {
            localFramePosition: toSeconds(seconds({ numerator: 701, denominator: 1001 })),
          },
        });
        await seek(15);
        expect(read('b')).toBeNull();
        await seek(16);
        expect(read('b')).toMatchObject({
          time: toSeconds(seconds({ numerator: 179, denominator: 7500 })),
        });
        await seek(22);
        expect(read('nested')).toBeNull();
        await seek(30); // t = 1.001, b starts .51, nested starts .76
        expect(read('nested')).toEqual({
          time: 0.241,
          frame: 30,
          globalTime: 1.001,
          sequence: {
            time: 0.241,
            duration: 0.5,
            remaining: 0.259,
            progress: toSeconds(seconds({ numerator: 241, denominator: 500 })),
            localFramePosition: toSeconds(seconds({ numerator: 7230, denominator: 1001 })),
            fps: toSeconds(seconds({ numerator: 30000, denominator: 1001 })),
            globalTime: 1.001,
            globalFrame: 30,
          },
        });
        expect(read('a')).toMatchObject({ time: 0.991 });
        expect(read('b')).toMatchObject({ time: 0.491 });
        expect(progress()).toBe('0.982');
        await seek(31);
        expect(read('a')).toBeNull();
        expect(progress()).toBeNull();
        await seek(38);
        expect(read('nested')).toBeNull();
        await seek(45);
        expect(read('b')).not.toBeNull();
        await seek(46);
        expect(read('b')).toBeNull();
      },
      { numerator: 30000, denominator: 1001 },
    );
  });

  it('keeps rational scene and overlap boundaries exact at 30000/1001 fps', async () => {
    const frameDuration = { numerator: 1001, denominator: 30000 };
    const twoFrames = { numerator: 1001, denominator: 15000 };
    await withScene(
      () => (
        <Sequence from={frameDuration} duration={1}>
          <TransitionSeries>
            <TransitionScene duration={twoFrames}>
              <Probe name="a" />
            </TransitionScene>
            <Transition duration={frameDuration}>
              <Progress />
            </Transition>
            <TransitionScene duration={twoFrames}>
              <Probe name="b" />
            </TransitionScene>
          </TransitionSeries>
        </Sequence>
      ),
      async ({ seek, read, progress }) => {
        await seek(0);
        expect(read('a')).toBeNull();
        await seek(1);
        expect(read('a')).toMatchObject({
          time: 0,
          sequence: { duration: toSeconds(seconds(twoFrames)), localFramePosition: 0 },
        });
        expect(read('b')).toBeNull();
        await seek(2);
        expect(read('a')).toMatchObject({
          time: toSeconds(seconds(frameDuration)),
          sequence: { localFramePosition: 1, progress: 0.5 },
        });
        expect(read('b')).toMatchObject({ time: 0 });
        expect(progress()).toBe('0');
        await seek(3);
        expect(read('a')).toBeNull();
        expect(progress()).toBeNull();
        expect(read('b')).toMatchObject({
          time: toSeconds(seconds(frameDuration)),
          sequence: { localFramePosition: 1 },
        });
        await seek(4);
        expect(read('b')).toBeNull();
      },
      { numerator: 30000, denominator: 1001 },
    );
  });

  it('allows an overlap equal to a scene duration and simultaneous overlaps', async () => {
    await withScene(
      () => (
        <TransitionSeries>
          <TransitionScene duration={1}>
            <Probe name="a" />
          </TransitionScene>
          <Transition duration={1}>
            <Progress name="first" />
          </Transition>
          <TransitionScene duration={1}>
            <Probe name="b" />
          </TransitionScene>
          <Transition duration={1}>
            <Progress name="second" />
          </Transition>
          <TransitionScene duration={2}>
            <Probe name="c" />
          </TransitionScene>
        </TransitionSeries>
      ),
      async ({ seek, read, progress }) => {
        await seek(0);
        for (const name of ['a', 'b', 'c']) expect(read(name)).toMatchObject({ time: 0 });
        expect(progress('first')).toBe('0');
        expect(progress('second')).toBe('0');
        await seek(3);
        expect(progress('first')).toBe('0.75');
        expect(progress('second')).toBe('0.75');
        await seek(4);
        expect(read('a')).toBeNull();
        expect(read('b')).toBeNull();
        expect(read('c')).toMatchObject({ time: 1, sequence: { duration: 2, progress: 0.5 } });
        expect(progress('first')).toBeNull();
        expect(progress('second')).toBeNull();
        await seek(7);
        expect(read('c')).toMatchObject({ time: 1.75 });
        await seek(8);
        expect(read('c')).toBeNull();
      },
    );
  });

  it('supports empty series, zero scenes, optional overlaps and zero overlaps without mounting empty children', async () => {
    const Empty = vi.fn(() => <Probe name="empty" />);
    await withScene(
      () => (
        <>
          <TransitionSeries />
          <TransitionSeries>
            {null}
            {false}
            <TransitionScene duration={0}>
              <Empty />
            </TransitionScene>
            <Transition duration={0}>
              <Empty />
            </Transition>
            {[
              <TransitionScene key="a" duration={1}>
                <Probe name="a" />
              </TransitionScene>,
              <TransitionScene key="b" duration={1}>
                <Probe name="b" />
              </TransitionScene>,
            ]}
          </TransitionSeries>
        </>
      ),
      async ({ seek, read }) => {
        await seek(0);
        expect(read('a')).toMatchObject({ time: 0 });
        await seek(4);
        expect(read('a')).toBeNull();
        expect(read('b')).toMatchObject({ time: 0 });
        await seek(8);
        expect(read('b')).toBeNull();
        expect(Empty).not.toHaveBeenCalled();
      },
    );
  });

  it('clips visibility to ancestors without changing scene timing and supports nested series', async () => {
    await withScene(
      () => (
        <Sequence from={1} duration={1}>
          <TransitionSeries>
            <TransitionScene duration={3}>
              <TransitionSeries>
                <TransitionScene duration={4}>
                  <Probe name="nested" />
                </TransitionScene>
              </TransitionSeries>
            </TransitionScene>
          </TransitionSeries>
        </Sequence>
      ),
      async ({ seek, read }) => {
        await seek(3);
        expect(read('nested')).toBeNull();
        await seek(4);
        expect(read('nested')).toMatchObject({ time: 0, sequence: { duration: 4 } });
        await seek(7);
        expect(read('nested')).toMatchObject({ time: 0.75, sequence: { remaining: 3.25 } });
        await seek(8);
        expect(read('nested')).toBeNull();
      },
    );
  });

  it('renders the same tree for sequential, seeded random, reverse and repeated seeks', async () => {
    await withScene(
      () => (
        <Sequence from={0.125} duration={10}>
          <ThreeScenes />
        </Sequence>
      ),
      async ({ seek, container }) => {
        const frames = Array.from({ length: 24 }, (_, index) => index);
        const sequential = new Map<number, string>();
        for (const frame of frames) {
          await seek(frame);
          sequential.set(frame, container.innerHTML);
        }
        const orders = fc.sample(
          fc.shuffledSubarray(frames, { minLength: frames.length, maxLength: frames.length }),
          { seed: 156, numRuns: 3 },
        );
        orders.push(frames.toReversed(), [7, 0, 7, 23, 7]);
        for (const order of orders)
          for (const frame of order) {
            await seek(frame);
            expect(container.innerHTML).toBe(sequential.get(frame));
          }
      },
    );
  });

  it.each([
    () => (
      <TransitionSeries>
        <Transition duration={1} />
        <TransitionScene duration={1}>x</TransitionScene>
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <TransitionScene duration={1}>x</TransitionScene>
        <Transition duration={1} />
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <TransitionScene duration={1}>x</TransitionScene>
        <Transition duration={0} />
        <Transition duration={0} />
        <TransitionScene duration={1}>y</TransitionScene>
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <div />
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <>
          <TransitionScene duration={1}>x</TransitionScene>
        </>
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <TransitionScene duration={-1}>x</TransitionScene>
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <TransitionScene duration={Number.NaN}>x</TransitionScene>
      </TransitionSeries>
    ),
    () => (
      <TransitionSeries>
        <TransitionScene duration={{ numerator: 1, denominator: 0 }}>x</TransitionScene>
      </TransitionSeries>
    ),
    ...[-1, 2, Number.POSITIVE_INFINITY].map((duration) => () => (
      <TransitionSeries>
        <TransitionScene duration={1}>x</TransitionScene>
        <Transition duration={duration} />
        <TransitionScene duration={1}>y</TransitionScene>
      </TransitionSeries>
    )),
    () => <TransitionScene duration={1}>x</TransitionScene>,
    () => (
      <Transition duration={1}>
        <Progress />
      </Transition>
    ),
    () => <Progress />,
  ])('reports invalid authoring through render.page-error (%#)', async (scene) => {
    await withScene(scene, async ({ runtime, errors, container }) => {
      expect(
        await runtime.settleFrame(0, { source: 'renderer', requestId: 'invalid' }),
      ).toMatchObject({
        status: 'failed',
        diagnostics: [{ code: 'render.page-error' }],
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(container.textContent).toBe('');
    });
  });
});
