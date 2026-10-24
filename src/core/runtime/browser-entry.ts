import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { z } from 'zod';

import { DiagnosticSchema } from '../../lib/diagnostic.ts';
import { captureLeaseSchema, frameRequestSchema } from '../../lib/frame-protocol.ts';
import {
  loadingProtocolVersion,
  mountRequestSchema,
  type LoadingPage,
} from '../../lib/loading-protocol.ts';
import { type Result } from '../../lib/result.ts';
import { Composition } from '../composition/composition.tsx';
import {
  compositionFailure,
  type CompositionEntry,
  type CompositionRegistry,
} from '../composition/registry.ts';
import { toSeconds } from '../timeline/time.ts';
import {
  assetsOf,
  createCompositionRuntime,
  type CompositionRuntime,
} from './composition-runtime.ts';

type Registry = CompositionRegistry<readonly Result<CompositionEntry>[]>;
const failure = () =>
  compositionFailure(
    'render.page-error',
    'Composition registry bootstrap failed.',
    'Export the named compositions Result from defineCompositions.',
  );

/** Browser-only bootstrap; mount never implies an initial seek or readiness. */
export const bootstrapComposition = (input: unknown): void => {
  let registry: Registry | undefined;
  let declaration: Result<never> | undefined;
  const parsed = z
    .discriminatedUnion('ok', [
      z.object({ ok: z.literal(false), error: DiagnosticSchema }),
      z.object({
        ok: z.literal(true),
        value: z.custom<Registry>(
          (value: unknown) =>
            typeof value === 'object' &&
            value !== null &&
            'listCompositions' in value &&
            typeof value.listCompositions === 'function' &&
            'definitions' in value &&
            Array.isArray(value.definitions) &&
            value.definitions.length > 0,
        ),
      }),
    ])
    .safeParse(input);
  if (parsed.success) {
    if (parsed.data.ok) registry = parsed.data.value;
    else declaration = parsed.data;
  }
  let root: Root | undefined;
  let runtime: CompositionRuntime | undefined;
  let disposed = false;
  const api: LoadingPage = {
    protocolVersion: loadingProtocolVersion,
    settleFrame: async (frame, request) => {
      const checked = frameRequestSchema.safeParse(request);
      if (!checked.success || runtime === undefined) return { status: 'aborted' };
      return runtime.settleFrame(frame, checked.data);
    },
    resettle: async (lease) => {
      const checked = captureLeaseSchema.safeParse(lease);
      return checked.success && checked.data.source === 'renderer' && runtime !== undefined
        ? runtime.resettle(checked.data)
        : { status: 'aborted' };
    },
    validateCapture: (lease) => {
      const checked = captureLeaseSchema.safeParse(lease);
      return checked.success && checked.data.source === 'renderer' && runtime !== undefined
        ? runtime.validateCapture(checked.data)
        : { status: 'aborted' };
    },
    completeCapture: (lease) => {
      const checked = captureLeaseSchema.safeParse(lease);
      return checked.success && checked.data.source === 'renderer' && runtime !== undefined
        ? runtime.completeCapture(checked.data)
        : { status: 'aborted' };
    },
    cancel: (requestId) => runtime?.cancel(requestId),
    pendingAssets: (requestId) => runtime?.pendingAssets(requestId) ?? [],
    warnings: () => runtime?.warnings() ?? [],
    assetReadiness: () =>
      runtime === undefined ? { pending: [], failed: [], ready: [] } : assetsOf(runtime).snapshot(),
    whenReady: (timeoutMs) => {
      if (runtime === undefined) return Promise.resolve({ ok: false, aborted: true });
      const current = runtime;
      const snapshot = current.getSnapshot();
      return assetsOf(current).whenReady({
        signal: new AbortController().signal,
        timeoutMs,
        configuredTimeoutMs: timeoutMs,
        location: {
          compositionId: current.definition.descriptor.id,
          ...(snapshot === null
            ? {}
            : {
                frame: snapshot.globalFrame,
                timeSeconds: toSeconds(snapshot.presentationTime),
              }),
        },
        generation: snapshot?.generation ?? 0,
        committed: () => current.getSnapshot() !== null,
      });
    },
    listCompositions: () =>
      registry === undefined
        ? (declaration ?? failure())
        : { ok: true, value: registry.listCompositions() },
    mount: async (raw) => {
      const checked = mountRequestSchema.safeParse(raw);
      if (!checked.success || disposed || registry === undefined || root !== undefined)
        return failure();
      const request = checked.data;
      const descriptors = registry.listCompositions();
      const id =
        request.compositionId ?? (descriptors.length === 1 ? descriptors[0]?.id : undefined);
      if (id === undefined)
        return compositionFailure(
          'cli.invalid-arguments',
          'Select a Composition from this registry.',
          `Supply a composition id from: ${descriptors.map((item) => item.id).join(', ')}.`,
          undefined,
          { ids: descriptors.map((item) => item.id) },
        );
      const index = descriptors.findIndex((item) => item.id === id);
      if (index === -1)
        return compositionFailure(
          'cli.composition-not-found',
          'The selected Composition does not exist.',
          'Use an exact case-sensitive id returned by listCompositions.',
        );
      const definition = registry.definitions[index];
      if (definition === undefined || !definition.ok) return failure();
      const prepared = await definition.value.prepare(
        request.props,
        request.revision,
        request.loadingTimeoutMs,
      );
      if (!prepared.ok) return prepared;
      if (disposed) return failure();
      const container = document.getElementById('motion-kit-root');
      if (container === null) return failure();
      container.style.width = `${prepared.value.descriptor.width}px`;
      container.style.height = `${prepared.value.descriptor.height}px`;
      const selectedRuntime = createCompositionRuntime({
        definition: prepared.value,
        compositionRealm: request.instance,
        instance: request.instance,
        frameTimeoutMs: request.frameTimeoutMs,
        queueTimeoutMs: request.queueTimeoutMs,
        externalDeadline: true,
        acquire: async (snapshot, signal, requestId) => {
          const granted = await window.__motionKitOwnership?.({
            requestId,
            source: 'renderer',
            instance: snapshot.instance,
            revision: snapshot.revision,
            generation: snapshot.generation,
            globalFrame: snapshot.globalFrame,
          });
          if (granted !== true || signal.aborted) selectedRuntime.cancel(requestId);
        },
      });
      runtime = selectedRuntime;
      root = createRoot(container);
      flushSync(() =>
        root?.render(
          createElement(Composition, {
            definition: prepared.value,
            compositionRuntime: selectedRuntime,
          }),
        ),
      );
      return {
        ok: true,
        value: {
          instance: request.instance,
          revision: request.revision,
          descriptor: prepared.value.descriptor,
        },
      };
    },
    dispose: () => {
      if (disposed) return runtime?.dispose() ?? { ok: true, value: undefined };
      disposed = true;
      const result = runtime?.dispose() ?? { ok: true as const, value: undefined };
      root?.unmount();
      return result;
    },
  };
  window.__motionKit = api;
  void window.__motionKitLoadingEvent?.({ protocolVersion: loadingProtocolVersion });
};
