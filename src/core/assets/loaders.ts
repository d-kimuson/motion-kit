import { AssetLoaderFailure, defaultPhase, failurePhase } from './diagnostics.ts';
import {
  type AssetDescriptor,
  type FontAssetDescriptor,
  type ImageAssetDescriptor,
} from './types.ts';

export type AssetLoader = (
  descriptor: AssetDescriptor,
  signal: AbortSignal,
  attempt: number,
) => Promise<unknown>;

const abortError = (): DOMException =>
  new DOMException('The asset load was cancelled.', 'AbortError');

const raceSignal = async <T>(work: Promise<T>, signal: AbortSignal): Promise<T> => {
  let settled = false;
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => {
      if (!settled) reject(abortError());
    };
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener('abort', fail, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    settled = true;
  }
};

const fontSource = (source: string): string => `url(${JSON.stringify(source)})`;

const fontShorthand = (descriptor: FontAssetDescriptor): string => {
  const family = /[\s"]/u.test(descriptor.family)
    ? JSON.stringify(descriptor.family)
    : descriptor.family;
  return `${descriptor.style ?? 'normal'} ${descriptor.weight ?? 400} 16px ${family}`;
};

export const loadFont = async (
  descriptor: FontAssetDescriptor,
  signal: AbortSignal,
): Promise<FontFace> => {
  if (signal.aborted) throw abortError();
  const face = new FontFace(descriptor.family, fontSource(descriptor.source), {
    weight: String(descriptor.weight ?? 400),
    style: descriptor.style ?? 'normal',
    display: 'swap',
  });
  try {
    await raceSignal(face.load(), signal);
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw new AssetLoaderFailure('load', error);
  }
  if (signal.aborted) throw abortError();
  if (face.status === 'error') throw new AssetLoaderFailure('load');
  document.fonts.add(face);
  try {
    await raceSignal(document.fonts.ready, signal);
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw new AssetLoaderFailure('font-set', error);
  }
  if (signal.aborted) throw abortError();
  if (!document.fonts.check(fontShorthand(descriptor), descriptor.text ?? 'Abc123'))
    throw new AssetLoaderFailure('font-set');
  return face;
};

export const loadImage = async (
  descriptor: ImageAssetDescriptor,
  signal: AbortSignal,
): Promise<HTMLImageElement> => {
  if (signal.aborted) throw abortError();
  const image = new Image();
  image.decoding = 'async';
  const failed = new Promise<never>((_resolve, reject) => {
    image.addEventListener('error', () => reject(new AssetLoaderFailure('decode')), { once: true });
  });
  image.src = descriptor.source;
  try {
    await raceSignal(Promise.race([image.decode(), failed]), signal);
  } catch (error) {
    image.removeAttribute('src');
    if (signal.aborted) throw abortError();
    throw error instanceof AssetLoaderFailure ? error : new AssetLoaderFailure('decode', error);
  }
  if (signal.aborted) {
    image.removeAttribute('src');
    throw abortError();
  }
  return image;
};

export const loadRegisteredAsset: AssetLoader = (descriptor, signal) => {
  if (descriptor.kind === 'font') return loadFont(descriptor, signal);
  return loadImage(descriptor, signal);
};

/**
 * Stands in for a font or image without loading it: a realm that only reads which Sequences and
 * assets its frames use (a dry realm) gets a value at once and fetches and decodes nothing.
 */
export const standInAsset: AssetLoader = (descriptor) =>
  Promise.resolve(
    descriptor.kind === 'font'
      ? new FontFace(descriptor.family, fontSource(descriptor.source), {
          weight: String(descriptor.weight ?? 400),
          style: descriptor.style ?? 'normal',
        })
      : new Image(),
  );

export const phaseFor = (descriptor: AssetDescriptor, error: unknown) =>
  failurePhase(error, defaultPhase(descriptor));
