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

/**
 * A font family the page's own `@font-face` rules declare, split by `unicode-range` as fontsource
 * ships one family. The faces that cover `text` must be loaded before the frame is captured.
 */
export type FontFamilyAssetDescriptor = Readonly<{
  kind: 'font-family';
  id: string;
  /** The CSS family the loaded stylesheets declare. */
  family: string;
  weight?: number | string;
  style?: string;
  /** The text the frame renders: the faces covering its characters are required. */
  text: string;
  sceneId?: string;
}>;

export type AssetDescriptor =
  | FontAssetDescriptor
  | FontFamilyAssetDescriptor
  | ImageAssetDescriptor;

export type AssetContext = Readonly<{
  compositionId?: string;
  frame?: number;
  timeSeconds?: number;
  generation?: number;
}>;

export const assertAssetDescriptor = (descriptor: AssetDescriptor): void => {
  if (descriptor.id.length === 0) throw new Error('useAsset requires a non-empty id.');
  if (descriptor.kind === 'font-family') {
    if (descriptor.family.length === 0) throw new Error('useAsset requires a font family.');
    if (descriptor.text.length === 0)
      throw new Error('useAsset requires the text a CSS-declared font family must cover.');
    return;
  }
  if (descriptor.source.length === 0)
    throw new Error('useAsset requires a non-empty id and source.');
  if (descriptor.kind === 'font' && descriptor.family.length === 0)
    throw new Error('useAsset requires a font family.');
};
