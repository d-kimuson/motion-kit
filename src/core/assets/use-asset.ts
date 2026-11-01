import { useId, useLayoutEffect } from 'react';

import { useAssetRuntime, useCompositionFrame } from '../composition/composition.tsx';
import { assetsOf } from '../runtime/composition-runtime.ts';
import { toSeconds } from '../timeline/time.ts';
import { AssetLoadError } from './diagnostics.ts';
import { type AssetRegistry, type AssetRead } from './registry.ts';
import {
  assertAssetDescriptor,
  type AssetContext,
  type AssetDescriptor,
  type FontAssetDescriptor,
  type ImageAssetDescriptor,
} from './types.ts';

/** Synchronous registration. Suspense may throw only after this returns. */
export const openAssetRead = (
  registry: AssetRegistry,
  descriptor: AssetDescriptor,
  owner: string,
  context: AssetContext,
): AssetRead => registry.retain(descriptor, owner, context);

const loadedValue = (
  kind: AssetDescriptor['kind'],
  value: unknown,
): FontFace | HTMLImageElement => {
  if (kind === 'font') {
    if (!(value instanceof FontFace))
      throw new Error('Font asset loader returned an unexpected value.');
    return value;
  }
  if (!(value instanceof HTMLImageElement))
    throw new Error('Image asset loader returned an unexpected value.');
  return value;
};

// Overloads keep font and image results distinct.
export function useAsset(descriptor: FontAssetDescriptor): FontFace;
export function useAsset(descriptor: ImageAssetDescriptor): HTMLImageElement;
export function useAsset(descriptor: AssetDescriptor): FontFace | HTMLImageElement {
  assertAssetDescriptor(descriptor);
  const runtime = useAssetRuntime();
  const snapshot = useCompositionFrame();
  const owner = useId();
  const registry = assetsOf(runtime);
  const read = openAssetRead(registry, descriptor, owner, {
    compositionId: runtime.definition.descriptor.id,
    frame: snapshot.globalFrame,
    timeSeconds: toSeconds(snapshot.presentationTime),
    generation: snapshot.generation,
  });
  useLayoutEffect(() => {
    registry.markCommitted(owner);
    return () => registry.release(owner);
  }, [registry, owner]);
  if (read.status === 'pending') throw read.promise;
  if (read.status === 'failed') {
    if (read.diagnostic === undefined) throw new Error('Asset failure is missing a diagnostic.');
    throw new AssetLoadError(read.diagnostic);
  }
  return loadedValue(descriptor.kind, read.value);
}
