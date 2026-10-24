import { type Diagnostic, type Location } from '../../lib/diagnostic.ts';
import {
  type AssetReadinessSnapshot,
  type AssetSettlement,
  type PendingAsset,
} from '../../lib/frame-protocol.ts';
import {
  assetLoadFailed,
  assetNotReadyDiagnostic,
  defaultPhase,
  redactAssetSource,
} from './diagnostics.ts';
import { phaseFor, type AssetLoader } from './loaders.ts';
import {
  assertAssetDescriptor,
  type AssetContext,
  type AssetDescriptor,
  type AssetPhase,
} from './types.ts';

export type AssetRead = Readonly<{
  key: string;
  status: 'pending' | 'ready' | 'failed';
  promise: Promise<void>;
  value: unknown;
  attempt: number;
  diagnostic?: Diagnostic;
}>;

export type ReadinessRequest = Readonly<{
  signal: AbortSignal;
  /** Enforced here when set. Omit when the caller owns the frame deadline. */
  timeoutMs?: number;
  /** Value recorded in `details.timeoutMs`; defaults to `timeoutMs`. */
  configuredTimeoutMs?: number;
  location: Location;
  generation: number;
  committed: () => boolean;
}>;

type Owner = {
  assetId: string;
  sceneId?: string;
  context: AssetContext;
  seen: boolean;
  committed: boolean;
};

type Entry = {
  key: string;
  descriptor: AssetDescriptor;
  owners: Map<string, Owner>;
  attempt: number;
  status: 'idle' | 'pending' | 'ready' | 'failed';
  phase: AssetPhase;
  value: unknown;
  failureCause?: unknown;
  controller?: AbortController;
  done: Promise<void>;
  resolve: () => void;
};

const resolved = Promise.withResolvers<void>();
resolved.resolve();

const freshDone = (): Pick<Entry, 'done' | 'resolve'> => {
  const gate = Promise.withResolvers<void>();
  return { done: gate.promise, resolve: gate.resolve };
};

/** Exact source identity. Redaction is not applied; credentials stay out of serialized output. */
export const assetCacheKey = (descriptor: AssetDescriptor): string => {
  if (descriptor.kind === 'image') return `image\u0000${descriptor.source}`;
  return `font\u0000${descriptor.family}\u0000${String(descriptor.weight ?? 400)}\u0000${descriptor.style ?? 'normal'}\u0000${descriptor.source}`;
};

const fingerprint = (source: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export type AssetRegistry = Readonly<{
  retain: (descriptor: AssetDescriptor, owner: string, context: AssetContext) => AssetRead;
  release: (owner: string) => void;
  retry: (key: string) => void;
  markCommitted: (owner: string) => void;
  beginPass: () => void;
  endPass: () => void;
  whenReady: (request: ReadinessRequest) => Promise<AssetSettlement>;
  pending: () => readonly PendingAsset[];
  snapshot: () => AssetReadinessSnapshot;
  versions: () => readonly Readonly<{ id: string; version: string }>[];
  poke: () => void;
  dispose: () => void;
}>;

export const createAssetRegistry = (options: {
  load: AssetLoader;
  onChange?: () => void;
}): AssetRegistry => {
  const entries = new Map<string, Entry>();
  const ownerKey = new Map<string, string>();
  let disposed = false;
  let passOpen = false;
  let revision = 0;
  let wakeVersion = 0;
  let wake = Promise.withResolvers<void>();
  const poke = () => {
    wakeVersion += 1;
    wake.resolve();
    wake = Promise.withResolvers<void>();
  };
  const changed = () => {
    revision += 1;
    options.onChange?.();
    poke();
  };
  const liveEntries = (): Entry[] =>
    [...entries.values()].filter((entry) => entry.owners.size > 0 && !disposed);

  const recordsFor = (entry: Entry): PendingAsset[] =>
    [...entry.owners.values()].map((owner) => ({
      id: owner.assetId,
      kind: entry.descriptor.kind,
      source: entry.descriptor.source,
      phase: entry.phase,
      ...(owner.sceneId === undefined ? {} : { sceneId: owner.sceneId }),
    }));

  const pendingRegistrations = (): PendingAsset[] =>
    liveEntries()
      .filter((entry) => entry.status !== 'ready')
      .flatMap(recordsFor);

  const contextLocation = (entry: Entry): Location => {
    const context = entry.owners.values().next().value?.context;
    return {
      ...(context?.compositionId === undefined ? {} : { compositionId: context.compositionId }),
      ...(context?.frame === undefined ? {} : { frame: context.frame }),
      ...(context?.timeSeconds === undefined ? {} : { timeSeconds: context.timeSeconds }),
    };
  };
  const diagnosticFor = (entry: Entry, location?: Location): Diagnostic =>
    assetLoadFailed({
      assets: recordsFor(entry),
      location: location ?? contextLocation(entry),
      cause: entry.failureCause,
    });
  const readOf = (entry: Entry): AssetRead => ({
    key: entry.key,
    status: entry.status === 'idle' ? 'pending' : entry.status,
    promise: entry.done,
    value: entry.value,
    attempt: entry.attempt,
    ...(entry.status === 'failed' ? { diagnostic: diagnosticFor(entry) } : {}),
  });

  const settleAttempt = (
    entry: Entry,
    attempt: number,
    controller: AbortController,
    outcome: 'ready' | 'failed',
    value: unknown,
    error: unknown,
  ) => {
    if (entry.attempt !== attempt || entry.controller?.signal.aborted === true) return;
    if (entries.get(entry.key) !== entry) return;
    if (outcome === 'ready') {
      entry.status = 'ready';
      entry.value = value;
    } else {
      entry.phase = phaseFor(entry.descriptor, error);
      entry.status = 'failed';
      entry.value = undefined;
      entry.failureCause = error;
    }
    entry.resolve();
    changed();
  };

  const startAttempt = (entry: Entry) => {
    const controller = new AbortController();
    const gate = freshDone();
    entry.attempt += 1;
    entry.controller = controller;
    entry.status = 'pending';
    entry.phase = defaultPhase(entry.descriptor);
    entry.value = undefined;
    entry.failureCause = undefined;
    entry.done = gate.done;
    entry.resolve = gate.resolve;
    const attempt = entry.attempt;
    void Promise.resolve()
      .then(() => options.load(entry.descriptor, controller.signal, attempt))
      .then(
        (value) => settleAttempt(entry, attempt, controller, 'ready', value, undefined),
        (error: unknown) => settleAttempt(entry, attempt, controller, 'failed', undefined, error),
      );
    poke();
  };
  const beginRetryAttempt = (entry: Entry) => {
    startAttempt(entry);
    options.onChange?.();
  };
  const publishRecord = (asset: PendingAsset): PendingAsset => ({
    ...asset,
    source: redactAssetSource(asset.source),
  });

  const releaseOwner = (owner: string, key: string) => {
    const entry = entries.get(key);
    ownerKey.delete(owner);
    if (entry === undefined || !entry.owners.delete(owner)) return;
    if (entry.owners.size > 0) {
      poke();
      return;
    }
    entry.controller?.abort();
    entry.attempt += 1;
    entry.resolve();
    entries.delete(key);
    poke();
  };

  const retain = (descriptor: AssetDescriptor, owner: string, context: AssetContext): AssetRead => {
    if (disposed) throw new Error('Asset registry has been disposed.');
    assertAssetDescriptor(descriptor);
    const key = assetCacheKey(descriptor);
    const previous = ownerKey.get(owner);
    if (previous !== undefined && previous !== key) releaseOwner(owner, previous);
    let entry = entries.get(key);
    if (entry === undefined) {
      const gate = freshDone();
      entry = {
        key,
        descriptor,
        owners: new Map(),
        attempt: 0,
        status: 'idle',
        phase: defaultPhase(descriptor),
        value: undefined,
        done: gate.done,
        resolve: gate.resolve,
      };
      entries.set(key, entry);
    }
    entry.descriptor = descriptor;
    const previousOwner = entry.owners.get(owner);
    const unchanged =
      previousOwner !== undefined &&
      previousOwner.assetId === descriptor.id &&
      previousOwner.sceneId === descriptor.sceneId;
    entry.owners.set(owner, {
      assetId: descriptor.id,
      ...(descriptor.sceneId === undefined ? {} : { sceneId: descriptor.sceneId }),
      context,
      seen: passOpen,
      committed: previousOwner?.committed === true,
    });
    ownerKey.set(owner, key);
    if (entry.status === 'idle') startAttempt(entry);
    else if (!unchanged) poke();
    return readOf(entry);
  };

  const waitFor = async (seen: number, pending: readonly Entry[]): Promise<void> => {
    if (wakeVersion !== seen) return;
    const gates = pending.map((entry) =>
      entry.done.then(
        () => undefined,
        () => undefined,
      ),
    );
    await Promise.race([wake.promise, ...gates]);
  };

  const timeoutResult = (request: ReadinessRequest): AssetSettlement => {
    const assets = pendingRegistrations();
    const timeoutMs = request.configuredTimeoutMs ?? request.timeoutMs ?? 0;
    if (assets.length === 0)
      return {
        ok: false,
        error: [
          {
            code: 'render.frame-timeout',
            severity: 'error',
            location: request.location,
            message: 'Frame settlement exceeded the frame deadline before an asset was pending.',
            hint: 'Check content acknowledgements or increase the frame budget.',
          },
        ],
      };
    return {
      ok: false,
      error: [
        assetNotReadyDiagnostic({
          assets,
          timeoutMs,
          location: request.location,
        }),
      ],
    };
  };

  const failureResult = (request: ReadinessRequest, failed: readonly Entry[]): AssetSettlement => ({
    ok: false,
    error: failed.map((entry) => diagnosticFor(entry, request.location)),
  });

  const drainUntilStable = async (request: ReadinessRequest): Promise<AssetSettlement> => {
    let timedOut = false;
    const timer =
      request.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            poke();
          }, request.timeoutMs);
    try {
      let confirmedRevision: number | undefined;
      while (!request.signal.aborted) {
        if (timedOut) return timeoutResult(request);
        const required = liveEntries();
        const failed = required.filter((entry) => entry.status === 'failed');
        if (failed.length > 0) return failureResult(request, failed);
        const pending = required.filter((entry) => entry.status !== 'ready');
        if (pending.length === 0 && request.committed()) {
          if (confirmedRevision === revision) return { ok: true, value: undefined };
          confirmedRevision = revision;
          const seen = wakeVersion;
          await Promise.resolve();
          if (request.signal.aborted) return { ok: false, aborted: true };
          if (timedOut) return timeoutResult(request);
          if (
            revision === confirmedRevision &&
            liveEntries().every((entry) => entry.status === 'ready')
          )
            return { ok: true, value: undefined };
          await waitFor(seen, []);
          continue;
        }
        confirmedRevision = undefined;
        const seen = wakeVersion;
        await waitFor(seen, pending);
      }
      return { ok: false, aborted: true };
    } finally {
      clearTimeout(timer);
    }
  };

  const whenReady = (request: ReadinessRequest): Promise<AssetSettlement> =>
    drainUntilStable(request);

  return {
    retain,
    release: (owner) => {
      const key = ownerKey.get(owner);
      if (key === undefined) return;
      releaseOwner(owner, key);
      options.onChange?.();
    },
    retry: (key) => {
      const entry = entries.get(key);
      if (entry === undefined || entry.owners.size === 0 || disposed) return;
      entry.controller?.abort();
      entry.resolve();
      beginRetryAttempt(entry);
    },
    markCommitted: (owner) => {
      const key = ownerKey.get(owner);
      const ownerState = key === undefined ? undefined : entries.get(key)?.owners.get(owner);
      if (ownerState !== undefined) ownerState.committed = true;
    },
    beginPass: () => {
      passOpen = true;
      for (const entry of entries.values())
        for (const owner of entry.owners.values()) owner.seen = false;
    },
    endPass: () => {
      // A suspended child does not re-render on the next pass. Dropping unseen
      // owners here both leaks a false removal and re-registers forever.
      passOpen = false;
    },
    whenReady,
    pending: () => pendingRegistrations().map(publishRecord),
    snapshot: () => ({
      pending: liveEntries()
        .filter((entry) => entry.status === 'pending' || entry.status === 'idle')
        .flatMap(recordsFor)
        .map(publishRecord),
      failed: liveEntries()
        .filter((entry) => entry.status === 'failed')
        .flatMap(recordsFor)
        .map(publishRecord),
      ready: liveEntries()
        .filter((entry) => entry.status === 'ready')
        .flatMap(recordsFor)
        .map(publishRecord),
    }),
    versions: () =>
      liveEntries().map((entry) => ({
        id: `asset:${fingerprint(entry.key)}`,
        version: `${entry.attempt}:${entry.status}`,
      })),
    poke,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        entry.controller?.abort();
        entry.attempt += 1;
        entry.resolve();
      }
      entries.clear();
      ownerKey.clear();
      poke();
    },
  };
};
