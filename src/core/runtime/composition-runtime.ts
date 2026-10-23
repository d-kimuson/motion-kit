import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type PreparedComposition } from '../composition/registry.ts';
import {
  frameToTime,
  validateOutputFrame,
  type RationalInput,
  type TimelineTime,
} from '../timeline/time.ts';

export type HostSource = 'renderer' | 'preview';
export type FrameSnapshot = Readonly<{
  instance: string;
  revision: string;
  source: HostSource;
  generation: number;
  globalFrame: number;
  fps: RationalInput;
  presentationTime: TimelineTime;
  resourceRevision: number;
}>;
export type CaptureLease = Readonly<
  Omit<FrameSnapshot, 'presentationTime'> & {
    presentationTime: Readonly<{ numerator: string; denominator: string }>;
    resourceVersions: readonly Readonly<{ id: string; version: string }>[];
  }
>;
export type FrameOutcome =
  | { status: 'ready'; lease: CaptureLease }
  | { status: 'failed'; diagnostics: [Diagnostic, ...Diagnostic[]] }
  | { status: 'aborted' };
export type CaptureValidation =
  | Exclude<FrameOutcome, { status: 'ready' }>
  | { status: 'valid' }
  | { status: 'resettle' };
export type CaptureCompletion =
  | Exclude<CaptureValidation, { status: 'valid' }>
  | { status: 'accepted' };
export type ContentRegistration = Readonly<{
  id: string;
  getVersion: () => string;
  acknowledge: (generation: number, version: string) => boolean;
  update: (version: string) => void;
  dispose: () => void;
}>;
export type IntegrationRegistration = Readonly<{
  id: string;
  version: string;
  seekability: 'A' | 'B' | 'C';
  settle: (snapshot: FrameSnapshot, signal: AbortSignal) => Promise<Result<undefined>>;
  dispose?: () => void;
}>;
export type CompositionRuntimeOptions = {
  definition: PreparedComposition;
  compositionRealm: string;
  instance: string;
  frameTimeoutMs?: number;
  queueTimeoutMs?: number;
  /** Resolve only on confirmed host ownership; host starts its independent deadline here.
   * A canceled grant must be revoked. No page mutation occurs before resolution.
   */
  acquire?: (snapshot: FrameSnapshot, signal: AbortSignal) => Promise<void>;
  /** Confirm old host/React work cannot mutate this realm before the next grant. */
  quiesce?: (snapshot: FrameSnapshot) => Promise<void>;
};

type Content = { version: string; generation: number | undefined };
type Request = {
  requestId: string;
  snapshot: FrameSnapshot;
  controller: AbortController;
  result: ReturnType<typeof Promise.withResolvers<FrameOutcome>>;
  queueTimer: ReturnType<typeof setTimeout>;
  frameTimer?: ReturnType<typeof setTimeout>;
  terminal?: Exclude<FrameOutcome, { status: 'ready' }> | { status: 'accepted' };
  settledRevision?: number;
  running?: Promise<void>;
  releasing: boolean;
  draining: boolean;
};

const failed = (
  message: string,
  code: 'render.page-error' | 'render.frame-timeout' = 'render.page-error',
): FrameOutcome & { status: 'failed' } => ({
  status: 'failed',
  diagnostics: [
    {
      code,
      severity: 'error',
      message,
      hint:
        code === 'render.frame-timeout'
          ? 'Check required content acknowledgements and integration settlement or increase the frame budget.'
          : 'Check the frame request and the Composition or integration implementation.',
    },
  ],
});

/** Realm-local state machine. Timers bound cooperative work, never establish readiness.
 * TASK-157's external host must also enforce the deadline against blocked JS/GPU/RPC work.
 */
export const createCompositionRuntime = (options: CompositionRuntimeOptions) => {
  const {
    definition,
    compositionRealm,
    instance,
    frameTimeoutMs = 30_000,
    queueTimeoutMs = 30_000,
  } = options;
  if (![frameTimeoutMs, queueTimeoutMs].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Runtime budgets must be finite and positive.');
  const contents = new Map<string, Content>([
    ['composition-root', { version: '1', generation: undefined }],
  ]);
  const integrations = new Map<string, IntegrationRegistration>();
  const listeners = new Set<() => void>();
  const requests = new Map<string, Request>();
  const terminalGenerations = new Map<number, Exclude<FrameOutcome, { status: 'ready' }>>();
  let generation = 0;
  let resourceRevision = 0;
  let active: Request | undefined;
  let snapshot: FrameSnapshot | null = null;
  let disposed = false;
  let rootAttached = false;
  let wake = Promise.withResolvers<void>();
  const queue: Request[] = [];

  const signalChange = () => {
    wake.resolve();
    wake = Promise.withResolvers<void>();
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const changed = () => {
    resourceRevision++;
    if (active !== undefined && active.terminal === undefined && snapshot !== null) {
      snapshot = Object.freeze({ ...snapshot, resourceRevision });
      active.snapshot = snapshot;
      emit();
    }
    signalChange();
  };
  const live = (request: Request) =>
    !disposed && active === request && request.terminal === undefined;
  const leaseFor = (request: Request): CaptureLease =>
    Object.freeze({
      ...request.snapshot,
      resourceRevision,
      presentationTime: Object.freeze({
        numerator: request.snapshot.presentationTime.numerator.toString(),
        denominator: request.snapshot.presentationTime.denominator.toString(),
      }),
      resourceVersions: Object.freeze([
        ...[...contents].map(([id, value]) =>
          Object.freeze({ id: `content:${id}`, version: value.version }),
        ),
        ...[...integrations].map(([id, value]) =>
          Object.freeze({ id: `integration:${id}`, version: value.version }),
        ),
      ]),
    });

  const release = async (request: Request) => {
    if (request.releasing) return;
    request.releasing = true;
    try {
      await request.running;
      await options.quiesce?.(request.snapshot);
    } catch {
      // An unsafe realm cannot hand ownership to another operation.
      dispose();
    }
    if (active === request) active = undefined;
    pump();
  };
  const terminate = (request: Request, outcome: Exclude<FrameOutcome, { status: 'ready' }>) => {
    if (request.terminal !== undefined) return;
    request.terminal = outcome;
    terminalGenerations.set(request.snapshot.generation, outcome);
    request.controller.abort();
    clearTimeout(request.queueTimer);
    clearTimeout(request.frameTimer);
    request.result.resolve(outcome);
    if (active === request) {
      snapshot = null;
      emit();
    }
    signalChange();
    if (active === request) void release(request);
  };

  const drain = async (request: Request) => {
    request.draining = true;
    try {
      const settled = new Map<IntegrationRegistration, number>();
      while (live(request)) {
        if (
          [...contents.values()].some(
            (content) => content.generation !== request.snapshot.generation,
          )
        ) {
          await wake.promise;
          continue;
        }
        const revision = resourceRevision;
        for (const integration of integrations.values()) {
          if (settled.get(integration) === revision) continue;
          try {
            const result = await integration.settle(request.snapshot, request.controller.signal);
            if (!live(request)) return;
            if (integrations.get(integration.id) !== integration) continue;
            if (!result.ok) {
              terminate(request, { status: 'failed', diagnostics: [result.error] });
              return;
            }
            settled.set(integration, revision);
          } catch {
            if (live(request))
              terminate(request, failed('Composition integration settlement failed.'));
            return;
          }
        }
        if (!live(request)) return;
        if (revision !== resourceRevision) continue;
        if (
          [...contents.values()].some(
            (content) => content.generation !== request.snapshot.generation,
          )
        )
          continue;
        request.settledRevision = resourceRevision;
        request.result.resolve({ status: 'ready', lease: leaseFor(request) });
        return;
      }
    } finally {
      request.draining = false;
    }
  };

  const acquire = async (request: Request) => {
    try {
      await options.acquire?.(request.snapshot, request.controller.signal);
    } catch {
      if (live(request)) terminate(request, failed('Composition ownership grant failed.'));
      return;
    }
    if (!live(request)) return;
    clearTimeout(request.queueTimer);
    // This budget is never restarted by readiness, capture, or resource re-settlement.
    request.frameTimer = setTimeout(
      () =>
        terminate(
          request,
          failed('Composition frame settlement or capture timed out.', 'render.frame-timeout'),
        ),
      frameTimeoutMs,
    );
    snapshot = Object.freeze({ ...request.snapshot, resourceRevision });
    request.snapshot = snapshot;
    emit();
    await drain(request);
  };
  const pump = () => {
    if (disposed || active !== undefined) return;
    let next = queue.shift();
    while (next !== undefined && next.terminal !== undefined) next = queue.shift();
    if (next === undefined) return;
    active = next;
    next.running = acquire(next);
  };
  const cancel = (requestId: string) => {
    const request = requests.get(requestId);
    if (request !== undefined) terminate(request, { status: 'aborted' });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const request of requests.values()) terminate(request, { status: 'aborted' });
    for (const registration of integrations.values()) registration.dispose?.();
    integrations.clear();
    contents.clear();
    snapshot = null;
    emit();
    listeners.clear();
    signalChange();
  };
  const acknowledgeContent = (
    id: string,
    acknowledgedGeneration: number,
    version: string,
  ): boolean => {
    const registration = contents.get(id);
    if (
      active === undefined ||
      !live(active) ||
      snapshot === null ||
      active.snapshot.generation !== acknowledgedGeneration ||
      registration?.version !== version
    )
      return false;
    registration.generation = acknowledgedGeneration;
    signalChange();
    return true;
  };
  const registerContent = (id: string, version: string): ContentRegistration => {
    if (disposed || contents.has(id))
      throw new Error('Content registration requires a live runtime and a unique id.');
    const content: Content = { version, generation: undefined };
    contents.set(id, content);
    changed();
    return Object.freeze({
      id,
      getVersion: () => content.version,
      acknowledge: (acknowledgedGeneration: number, capturedVersion: string) =>
        contents.get(id) === content &&
        acknowledgeContent(id, acknowledgedGeneration, capturedVersion),
      update: (nextVersion: string) => {
        if (contents.get(id) !== content || content.version === nextVersion) return;
        content.version = nextVersion;
        content.generation = undefined;
        changed();
      },
      dispose: () => {
        if (contents.get(id) === content) {
          contents.delete(id);
          changed();
        }
      },
    });
  };
  const registerIntegration = (registration: IntegrationRegistration) => {
    if (disposed || integrations.has(registration.id))
      throw new Error('Integration registration requires a live runtime and a unique id.');
    const entry = Object.freeze({ ...registration });
    integrations.set(entry.id, entry);
    changed();
    return () => {
      if (integrations.get(entry.id) !== entry) return;
      integrations.delete(entry.id);
      entry.dispose?.();
      changed();
    };
  };
  const validateCapture = (lease: CaptureLease): CaptureValidation => {
    if (lease.instance !== instance || lease.revision !== definition.revision)
      return { status: 'aborted' };
    const terminal = terminalGenerations.get(lease.generation);
    if (terminal !== undefined) return terminal;
    if (
      active === undefined ||
      !live(active) ||
      active.snapshot.generation !== lease.generation ||
      active.snapshot.source !== lease.source ||
      active.snapshot.globalFrame !== lease.globalFrame
    )
      return { status: 'aborted' };
    const current = leaseFor(active);
    if (
      lease.fps.numerator !== current.fps.numerator ||
      lease.fps.denominator !== current.fps.denominator ||
      lease.presentationTime.numerator !== current.presentationTime.numerator ||
      lease.presentationTime.denominator !== current.presentationTime.denominator
    )
      return { status: 'aborted' };
    if (
      active.settledRevision !== resourceRevision ||
      lease.resourceRevision !== resourceRevision ||
      JSON.stringify(lease.resourceVersions) !== JSON.stringify(current.resourceVersions)
    )
      return { status: 'resettle' };
    return { status: 'valid' };
  };
  const completeCapture = (lease: CaptureLease): CaptureCompletion => {
    const validation = validateCapture(lease);
    if (validation.status !== 'valid') return validation;
    if (active === undefined) return { status: 'aborted' };
    const request = active;
    request.terminal = { status: 'accepted' };
    clearTimeout(request.frameTimer);
    void release(request);
    return { status: 'accepted' };
  };
  const resettle = (lease: CaptureLease): Promise<FrameOutcome> => {
    const validation = validateCapture(lease);
    if (validation.status === 'aborted' || validation.status === 'failed')
      return Promise.resolve(validation);
    if (active === undefined) return Promise.resolve({ status: 'aborted' });
    if (validation.status === 'valid')
      return Promise.resolve({ status: 'ready', lease: leaseFor(active) });
    if (active.draining) return active.result.promise;
    active.result = Promise.withResolvers<FrameOutcome>();
    active.running = drain(active);
    return active.result.promise;
  };
  const settleFrame = (
    frame: number,
    { source, requestId }: { source: HostSource; requestId: string },
  ): Promise<FrameOutcome> => {
    if (disposed) return Promise.resolve({ status: 'aborted' });
    if (requests.has(requestId))
      return Promise.resolve(failed('A frame request id must be unique in its realm.'));
    const checked = validateOutputFrame(frame, BigInt(definition.descriptor.durationInFrames));
    if (!checked.ok)
      return Promise.resolve(failed('Output frame is outside the Composition frame range.'));
    if (source === 'preview')
      for (const request of requests.values())
        if (request.snapshot.source === 'preview') terminate(request, { status: 'aborted' });
    const requestSnapshot: FrameSnapshot = Object.freeze({
      instance,
      revision: definition.revision,
      source,
      generation: ++generation,
      globalFrame: frame,
      fps: definition.descriptor.fps,
      presentationTime: frameToTime(checked.value, definition.frameRate),
      resourceRevision,
    });
    const request: Request = {
      requestId,
      snapshot: requestSnapshot,
      controller: new AbortController(),
      result: Promise.withResolvers<FrameOutcome>(),
      releasing: false,
      draining: false,
      queueTimer: setTimeout(() => terminate(request, { status: 'aborted' }), queueTimeoutMs),
    };
    requests.set(requestId, request);
    queue.push(request);
    pump();
    return request.result.promise;
  };
  return Object.freeze({
    definition,
    compositionRealm,
    instance,
    attachRoot: () => {
      if (rootAttached || disposed)
        throw new Error('A live Composition runtime owns exactly one root.');
      rootAttached = true;
      return () => {
        rootAttached = false;
        if (active !== undefined) cancel(active.requestId);
        snapshot = null;
        emit();
      };
    },
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settleFrame,
    acknowledgeContent,
    registerContent,
    registerIntegration,
    validateCapture,
    completeCapture,
    resettle,
    cancel,
    dispose,
    fail: (diagnostic: Diagnostic) => {
      if (active !== undefined) terminate(active, { status: 'failed', diagnostics: [diagnostic] });
    },
  });
};
export type CompositionRuntime = ReturnType<typeof createCompositionRuntime>;
