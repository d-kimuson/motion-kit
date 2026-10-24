import { type Diagnostic, type Location } from '../../lib/diagnostic.ts';
import { type PendingAsset } from '../../lib/frame-protocol.ts';
import { type AssetDescriptor, type AssetPhase } from './types.ts';

const SENSITIVE_EXACT = new Set([
  'sig',
  'auth',
  'authorization',
  'key',
  'apikey',
  'jwt',
  'session',
  'sessionid',
  'sid',
  'passwd',
  'pwd',
  'policy',
  'keypairid',
]);

/** Schema validation does not redact. Every asset Diagnostic must pass through here. */
export const redactAssetSource = (source: string): string => {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(source);
    const url = new URL(source, 'http://assets.invalid');
    url.username = '';
    url.password = '';
    url.hash = '';
    const kept = new URLSearchParams();
    for (const [name, value] of url.searchParams)
      if (!sensitiveParameter(name)) kept.append(name, value);
    url.search = kept.toString();
    const redacted = absolute ? url.toString() : `${url.pathname}${url.search}`;
    if (source.includes('@') && redacted.includes('@')) return '[asset source]';
    return redacted;
  } catch {
    return '[asset source]';
  }
};

const sensitiveParameter = (name: string): boolean => {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    SENSITIVE_EXACT.has(compact) ||
    compact.includes('token') ||
    compact.includes('secret') ||
    compact.includes('signature') ||
    compact.includes('password') ||
    compact.includes('credential')
  );
};

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
