/** Library-neutral asset identity. Cache keys use kind, source and font face, never the caller id. */

export type AssetPhase = 'load' | 'decode' | 'font-set';

export type FontAssetDescriptor = Readonly<{
  kind: 'font';
  id: string;
  family: string;
  source: string;
  weight?: number | string;
  style?: string;
  sceneId?: string;
  /** Sample passed to `document.fonts.check`. Defaults to a short ASCII probe. */
  text?: string;
}>;

export type ImageAssetDescriptor = Readonly<{
  kind: 'image';
  id: string;
  source: string;
  sceneId?: string;
}>;

export type AssetDescriptor = FontAssetDescriptor | ImageAssetDescriptor;

export type AssetContext = Readonly<{
  compositionId?: string;
  frame?: number;
  timeSeconds?: number;
  generation?: number;
}>;

export const assertAssetDescriptor = (descriptor: AssetDescriptor): void => {
  if (descriptor.id.length === 0 || descriptor.source.length === 0)
    throw new Error('useAsset requires a non-empty id and source.');
  if (descriptor.kind === 'font' && descriptor.family.length === 0)
    throw new Error('useAsset requires a font family.');
};
