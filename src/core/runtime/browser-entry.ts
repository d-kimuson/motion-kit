import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { z } from 'zod';

import { DiagnosticSchema } from '../../lib/diagnostic.ts';
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
import { createCompositionRuntime, type CompositionRuntime } from './composition-runtime.ts';

type Registry = CompositionRegistry<readonly Result<CompositionEntry>[]>;
const failure = () =>
  compositionFailure(
    'render.page-error',
    'Composition registry bootstrap failed.',
    'Export the named compositions Result from defineCompositions.',
  );

/** Browser-only loading bootstrap; no frame transport or implicit initial seek. */
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
  const validated = new Set<number>();
  const api: LoadingPage = {
    protocolVersion: loadingProtocolVersion,
    listCompositions: () =>
      registry === undefined
        ? (declaration ?? failure())
        : { ok: true, value: registry.listCompositions() },
    validateDefault: async (index, revision, timeoutMs) => {
      if (disposed || registry === undefined) return failure();
      if (validated.has(index)) return { ok: true, value: undefined };
      const definition = registry.definitions[index];
      if (definition === undefined || !definition.ok) return failure();
      const prepared = await definition.value.prepare({}, revision, timeoutMs);
      if (!prepared.ok) return prepared;
      if (disposed) return failure();
      validated.add(index);
      return { ok: true, value: undefined };
    },
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
        );
      const index = descriptors.findIndex((item) => item.id === id);
      if (index === -1)
        return compositionFailure(
          'cli.composition-not-found',
          'The selected Composition does not exist.',
          'Use an exact case-sensitive id returned by listCompositions.',
        );
      if (validated.size !== descriptors.length) return failure();
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
        value: { instance: request.instance, descriptor: prepared.value.descriptor },
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
