import { type Diagnostic, type Location } from '../../lib/diagnostic.ts';
import { type PendingAsset } from '../../lib/frame-protocol.ts';
import { type AssetDescriptor, type AssetPhase } from './types.ts';

const REDACTED_SOURCE = '[asset source]';

const decodeRepeated = (value: string): string => {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current.includes('%')) return current;
    try {
      const next = decodeURIComponent(current);
      if (next === current) return current;
      current = next;
    } catch {
      return current;
    }
  }
  return current;
};

const isAbsoluteUrl = (value: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(value);

const hasUserinfo = (value: string): boolean => {
  if (isAbsoluteUrl(value)) {
    try {
      const url = new URL(value);
      if (url.username !== '' || url.password !== '') return true;
    } catch {
      /* Fall through to the textual userinfo check. */
    }
  }
  return /(?:^|\/\/)[^/?#\s@]*:[^/?#\s@]+@/.test(value);
};

/** Count only. A name or value here would re-open the query denylist. */
const queryMarker = (count: number): string => {
  if (count === 0) return '';
  const noun = count === 1 ? 'parameter' : 'parameters';
  return ` (+${count} query ${noun}, redacted)`;
};

/**
 * Reported source is scheme, host and path, plus a count marker when a query
 * was present. Parameter names and values are never copied. Relative sources
 * report the path plus the same marker. Fragments and userinfo are stripped.
 */
const redactSource = (source: string): string => {
  try {
    const absolute = isAbsoluteUrl(source);
    const url = new URL(source, 'http://assets.invalid');
    const queryCount = url.searchParams.size;
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    const reported = absolute ? url.toString() : `${url.pathname}${url.search}`;
    if (hasUserinfo(decodeRepeated(reported))) return REDACTED_SOURCE;
    return `${reported}${queryMarker(queryCount)}`;
  } catch {
    return REDACTED_SOURCE;
  }
};

/** Schema validation does not redact. Every asset Diagnostic must pass through here. */
export const redactAssetSource = (source: string): string => redactSource(source);

const loadFailedMessage = (kind: string): string => {
  if (kind === 'font') return 'The required font failed to load.';
  if (kind === 'image') return 'The required image failed to decode.';
  return 'The required asset failed to load.';
};

const loadFailedHint = (kind: string): string => {
  if (kind === 'font') return 'Check the font source, family, weight and style.';
  if (kind === 'image') return 'Check the image source and file format.';
  return 'Check the asset source and retry the frame.';
};

export type AssetDiagnosticInput = Readonly<{
  kind: string;
  phase: string;
  source: string;
  id?: string;
  sceneId?: string;
  relatedSources?: readonly string[];
}>;

const assetRecord = (asset: AssetDiagnosticInput): PendingAsset => {
  const source = redactAssetSource(asset.source);
  return {
    ...(asset.id === undefined ? {} : { id: asset.id }),
    kind: asset.kind,
    source,
    phase: asset.phase,
    ...(asset.sceneId === undefined ? {} : { sceneId: asset.sceneId }),
    ...(asset.relatedSources === undefined
      ? {}
      : { relatedSources: asset.relatedSources.map(redactAssetSource) }),
  };
};

const locationFor = (
  location: Location | undefined,
  assets: readonly AssetDiagnosticInput[],
): Location | undefined => {
  const scenes = [
    ...new Set(assets.flatMap((asset) => (asset.sceneId === undefined ? [] : [asset.sceneId]))),
  ];
  const ids = [...new Set(assets.flatMap((asset) => (asset.id === undefined ? [] : [asset.id])))];
  const sceneId = scenes.length === 1 ? scenes[0] : location?.sceneId;
  const elementId = ids.length === 1 ? ids[0] : location?.elementId;
  if (location === undefined && sceneId === undefined && elementId === undefined) return undefined;
  return {
    ...location,
    ...(sceneId === undefined ? {} : { sceneId }),
    ...(elementId === undefined ? {} : { elementId }),
  };
};

/** `cause` is accepted so callers have one place to discard loader exceptions. */
export const assetLoadFailed = (input: {
  assets: readonly AssetDiagnosticInput[];
  location?: Location;
  cause: unknown;
}): Diagnostic => {
  const kind = input.assets[0]?.kind ?? 'asset';
  const message = loadFailedMessage(kind);
  void input.cause;
  const location = locationFor(input.location, input.assets);
  return {
    code: 'asset.load-failed',
    severity: 'error',
    ...(location === undefined ? {} : { location }),
    message,
    hint: loadFailedHint(kind),
    details: { assets: input.assets.map(assetRecord) },
  };
};

export const assetNotReadyDiagnostic = (input: {
  assets: readonly AssetDiagnosticInput[];
  timeoutMs: number;
  location?: Location;
}): Diagnostic => {
  const location = locationFor(input.location, input.assets);
  return {
    code: 'asset.not-ready',
    severity: 'error',
    ...(location === undefined ? {} : { location }),
    message: 'Required assets were not ready before the frame deadline.',
    hint: 'Fix pending asset acquisition, decode or upload, or increase frameTimeoutMs.',
    details: {
      timeoutMs: input.timeoutMs,
      assets: input.assets.map(assetRecord),
    },
  };
};

export class AssetLoadError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super('Required asset failed to load.');
    this.name = 'AssetLoadError';
    this.diagnostic = diagnostic;
  }
}

export const isAssetLoadError = (error: unknown): error is AssetLoadError =>
  error instanceof AssetLoadError;

export class AssetLoaderFailure extends Error {
  readonly phase: AssetPhase;
  constructor(phase: AssetPhase, cause?: unknown) {
    super('Asset loader failed.');
    this.name = 'AssetLoaderFailure';
    this.phase = phase;
    void cause;
  }
}

export const failurePhase = (error: unknown, fallback: AssetPhase): AssetPhase =>
  error instanceof AssetLoaderFailure ? error.phase : fallback;

export const defaultPhase = (descriptor: AssetDescriptor): AssetPhase =>
  descriptor.kind === 'image' ? 'decode' : 'load';
