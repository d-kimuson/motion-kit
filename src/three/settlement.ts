import { type FrameSnapshot } from '../core/runtime/composition-runtime.ts';
import { toSeconds } from '../core/timeline/time.ts';
import { type Diagnostic } from '../lib/diagnostic.ts';
import { type Result } from '../lib/result.ts';

/** The parts of the WebGL context settlement fences and checks. */
export type CanvasGlContext = Readonly<{
  finish: () => void;
  isContextLost: () => boolean;
}>;

/** The R3F root, reduced to what this integration reads and drives. An adapter keeps the
 * settlement logic testable without a real renderer and without casting a fake root. */
export type CanvasTarget = Readonly<{
  /** The renderer has been measured with a non-zero size; a capture before that is empty. */
  sized: () => boolean;
  /** Root-local Manual Advance; it never runs global effects or another canvas. */
  advance: (seconds: number) => void;
  context: () => CanvasGlContext;
  /** Live `useFrame` subscriber count, the input to `classifyCanvas`. */
  useFrameSubscribers: () => number;
}>;

const contextLost = (): Diagnostic => ({
  code: 'render.page-error',
  severity: 'error',
  message: 'The WebGL context was lost while settling the frame.',
  hint: 'Restart the renderer; context recovery is not implemented yet.',
});

const settled = { ok: true, value: undefined } as const;

/** Per-canvas settlement state. The root and the committed frame generation arrive from
 * separate React commits, so they are recorded here and every wait is woken by either of
 * them or by the request's abort signal.
 */
export type CanvasSettlement = Readonly<{
  target: () => CanvasTarget | undefined;
  generation: () => number | undefined;
  reportTarget: (target: CanvasTarget) => void;
  reportGeneration: (generation: number) => void;
  /** Resolves true once the predicate holds, or false when the request is aborted. */
  when: (predicate: () => boolean, signal: AbortSignal) => Promise<boolean>;
  settle: (snapshot: FrameSnapshot, signal: AbortSignal) => Promise<Result<undefined>>;
}>;

export const createCanvasSettlement = (): CanvasSettlement => {
  let target: CanvasTarget | undefined;
  let generation: number | undefined;
  const listeners = new Set<() => void>();
  const announce = () => {
    for (const listener of listeners) listener();
  };
  const when = async (predicate: () => boolean, signal: AbortSignal): Promise<boolean> => {
    while (!predicate()) {
      if (signal.aborted) return false;
      const resumed = Promise.withResolvers<void>();
      const wake = () => resumed.resolve();
      listeners.add(wake);
      signal.addEventListener('abort', wake, { once: true });
      await resumed.promise;
      listeners.delete(wake);
      signal.removeEventListener('abort', wake);
    }
    return true;
  };
  const draw = (snapshot: FrameSnapshot): Result<undefined> => {
    const current = target;
    if (current === undefined) return settled;
    current.advance(toSeconds(snapshot.presentationTime));
    const context = current.context();
    context.finish();
    return context.isContextLost() ? { ok: false, error: contextLost() } : settled;
  };
  return Object.freeze({
    target: () => target,
    generation: () => generation,
    reportTarget: (next: CanvasTarget) => {
      target = next;
      announce();
    },
    reportGeneration: (next: number) => {
      generation = next;
      announce();
    },
    when,
    // Aborting resolves with ok: the runtime has already terminated the request and only
    // reads the result of an integration that is still live; a Diagnostic here would be a
    // failure of a frame nobody will publish.
    settle: async (snapshot: FrameSnapshot, signal: AbortSignal): Promise<Result<undefined>> => {
      const sized = await when(() => target?.sized() === true, signal);
      if (!sized) return settled;
      const committed = await when(() => generation === snapshot.generation, signal);
      if (!committed) return settled;
      return draw(snapshot);
    },
  });
};
