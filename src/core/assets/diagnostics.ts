import { type Diagnostic, type Location } from '../../lib/diagnostic.ts';
import { type PendingAsset } from '../../lib/frame-protocol.ts';
import { type AssetDescriptor, type AssetPhase } from './types.ts';

const REDACTED_SOURCE = '[asset source]';
const MAX_REDACTION_DEPTH = 4;

/** Exact compact names. `key` stays exact so unrelated words are not dropped. */
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

/**
 * Compact-name fragments. A query parameter is dropped when its alphanumeric
 * name contains one of these, is an exact denylist hit, has a `key` segment
 * (`access_key`), or contains `keyid` (`AWSAccessKeyId`).
 * Deliberately kept non-sensitive parameters are every other name, including
 * cache and dimension queries such as `v`, `w`, `h`, `width`, and `format`.
 */
const SENSITIVE_FRAGMENTS = [
  'accesskey',
  'apikey',
  'token',
  'signature',
  'secret',
  'password',
  'credential',
  'session',
  'auth',
] as const;

const compactName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const sensitiveParameter = (name: string): boolean => {
  const compact = compactName(name);
  return (
    SENSITIVE_EXACT.has(compact) ||
    SENSITIVE_FRAGMENTS.some((fragment) => compact.includes(fragment)) ||
    /(?:^|[^a-z0-9])key(?:[^a-z0-9]|$)/i.test(name) ||
    compact.includes('keyid')
  );
};

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

const credentialValue = (value: string): boolean =>
  hasUserinfo(value) || /^(?:AKIA|ASIA)[0-9A-Z]{16}$/.test(value);

const redactQueryValue = (value: string, depth: number): string | undefined => {
  const decoded = decodeRepeated(value);
  if (isAbsoluteUrl(decoded)) {
    const nested = redactSource(decoded, depth + 1);
    if (nested === REDACTED_SOURCE || hasUserinfo(decodeRepeated(nested))) return undefined;
    return nested;
  }
  if (credentialValue(decoded)) return undefined;
  return value;
};

const redactSource = (source: string, depth: number): string => {
  if (depth > MAX_REDACTION_DEPTH) return REDACTED_SOURCE;
  try {
    const absolute = isAbsoluteUrl(source);
    const url = new URL(source, 'http://assets.invalid');
    url.username = '';
    url.password = '';
    url.hash = '';
    const kept = new URLSearchParams();
    for (const [name, value] of url.searchParams) {
      if (sensitiveParameter(name)) continue;
      const redactedValue = redactQueryValue(value, depth);
      if (redactedValue === undefined) continue;
      kept.append(name, redactedValue);
    }
    url.search = kept.toString();
    const redacted = absolute ? url.toString() : `${url.pathname}${url.search}`;
    if (hasUserinfo(decodeRepeated(redacted))) return REDACTED_SOURCE;
    return redacted;
  } catch {
    return REDACTED_SOURCE;
  }
};

/** Schema validation does not redact. Every asset Diagnostic must pass through here. */
export const redactAssetSource = (source: string): string => redactSource(source, 0);

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
