import { DiagnosticSchema, type Diagnostic, type DiagnosticCode } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { createFrameRate, type FrameRate, type RationalInput } from '../timeline/time.ts';
import { type CompositionDescriptor } from './registry.ts';

/**
 * The metadata a resolver derives from the props of one mount. Every field it omits keeps the
 * declaration's value, so a Composition that only derives its length returns `{ durationInFrames }`.
 * Fields are optional but never `undefined`: omit a field to keep it.
 */
export type CompositionMetadataOverride = Readonly<{
  durationInFrames?: number;
  width?: number;
  height?: number;
  fps?: RationalInput;
}>;

/** What a resolver reads: the declaration's static metadata and the validated props. */
export type CompositionMetadataInput<TProps extends object> = Readonly<{
  declared: CompositionDescriptor;
  props: TProps;
}>;

/**
 * Derives a Composition's metadata from its validated props (TASK-236). It runs once per mount,
 * after the schema and before anything renders, and may be asynchronous. It must be deterministic:
 * the same props and the same project data must produce the same metadata, so a resolver that reads
 * a wall clock or unseeded randomness would make frames differ between renderers.
 */
export type MetadataResolver<TProps extends object> = (
  input: CompositionMetadataInput<TProps>,
) => Result<CompositionMetadataOverride> | Promise<Result<CompositionMetadataOverride>>;

/** The metadata one mount runs with: the declaration with the resolver's overrides applied. */
export type ResolvedCompositionMetadata = Readonly<{
  descriptor: CompositionDescriptor;
  frameRate: FrameRate;
}>;

export type ResolveCompositionMetadataOptions<TProps extends object> = {
  id: string;
  descriptor: CompositionDescriptor;
  frameRate: FrameRate;
  props: TProps;
  /** Absent when the Composition declares no resolver; the declaration is then the metadata. */
  resolveMetadata: MetadataResolver<TProps> | undefined;
  timeoutMs: number;
};

const overrideFields: ReadonlySet<string> = new Set(['durationInFrames', 'width', 'height', 'fps']);

/** Same code mapping as the declaration: invalid duration is `composition.duration-invalid`, any
 * other invalid metadata is `render.page-error`, never the Time Module's `composition.props-invalid`.
 */
const failure = (
  id: string,
  code: DiagnosticCode,
  message: string,
  hint: string,
): Result<never> => ({
  ok: false,
  error: { code, severity: 'error', message, hint, location: { compositionId: id } },
});

const malformedResult = (id: string) =>
  failure(
    id,
    'render.page-error',
    'The resolveMetadata callback did not return a metadata Result.',
    'Return { ok: true, value: { durationInFrames?, width?, height?, fps? } } or { ok: false, error: <Diagnostic> } from resolveMetadata.',
  );
const malformedFailure = (id: string) =>
  failure(
    id,
    'render.page-error',
    'The resolveMetadata failure is not a valid Diagnostic.',
    'Return { ok: false, error: <Diagnostic with a known code, a message and a hint> } from resolveMetadata.',
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFrameCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isRational = (value: unknown): value is RationalInput =>
  isRecord(value) &&
  typeof value['numerator'] === 'number' &&
  typeof value['denominator'] === 'number';

/** Applies one resolver result to the declaration without keeping any reference to the resolver's
 * object: the resolver may mutate what it returned afterwards.
 */
const applyOverride = (options: {
  id: string;
  descriptor: CompositionDescriptor;
  frameRate: FrameRate;
  override: Record<string, unknown>;
}): Result<ResolvedCompositionMetadata> => {
  const { id, descriptor, frameRate, override } = options;
  const entries = Object.entries(override);
  if (entries.length === 0) return { ok: true, value: { descriptor, frameRate } };
  let durationInFrames = descriptor.durationInFrames;
  let width = descriptor.width;
  let height = descriptor.height;
  let rate = frameRate;
  for (const [key, value] of entries) {
    if (!overrideFields.has(key))
      return failure(
        id,
        'render.page-error',
        `Composition metadata override cannot set "${key}".`,
        'Return only durationInFrames, width, height or fps from resolveMetadata.',
      );
    if (key === 'durationInFrames') {
      if (!isFrameCount(value))
        return failure(
          id,
          'composition.duration-invalid',
          'The resolved Composition duration must be a nonnegative safe integer frame count.',
          'Return durationInFrames as a nonnegative safe integer from resolveMetadata, or omit it to keep the declaration.',
        );
      durationInFrames = value;
      continue;
    }
    if (key === 'width' || key === 'height') {
      if (!isPositiveInteger(value))
        return failure(
          id,
          'render.page-error',
          `The resolved Composition ${key} must be a positive safe integer.`,
          `Return ${key} as a positive safe integer from resolveMetadata, or omit it to keep the declaration.`,
        );
      if (key === 'width') width = value;
      else height = value;
      continue;
    }
    const resolved = isRational(value) ? createFrameRate(value) : undefined;
    if (resolved === undefined || !resolved.ok)
      return failure(
        id,
        'render.page-error',
        'The resolved Composition frame rate is invalid.',
        'Return fps as positive safe-integer numerator and denominator from resolveMetadata, or omit it to keep the declaration.',
      );
    rate = resolved.value;
  }
  const descriptorResolved: CompositionDescriptor = Object.freeze({
    id: descriptor.id,
    width,
    height,
    durationInFrames,
    fps: Object.freeze({
      numerator: Number(rate.numerator),
      denominator: Number(rate.denominator),
    }),
    ...(descriptor.audio === undefined ? {} : { audio: descriptor.audio }),
  });
  return { ok: true, value: { descriptor: descriptorResolved, frameRate: rate } };
};

/** Interprets one callback return value: a `Result` whose failure is a public Diagnostic. */
const applyResult = (options: {
  id: string;
  descriptor: CompositionDescriptor;
  frameRate: FrameRate;
  returned: unknown;
}): Result<ResolvedCompositionMetadata> => {
  const { id, descriptor, frameRate, returned } = options;
  if (!isRecord(returned) || !('ok' in returned)) return malformedResult(id);
  if (returned['ok'] === false) {
    const reported =
      'error' in returned ? DiagnosticSchema.safeParse(returned['error']) : undefined;
    if (reported === undefined || !reported.success) return malformedFailure(id);
    const diagnostic: Diagnostic = {
      ...reported.data,
      location: { ...reported.data.location, compositionId: id },
    };
    return { ok: false, error: diagnostic };
  }
  if (returned['ok'] !== true || !('value' in returned)) return malformedResult(id);
  const override = returned['value'];
  if (!isRecord(override)) return malformedResult(id);
  return applyOverride({ id, descriptor, frameRate, override });
};

/**
 * Resolves the metadata one mount runs with (core ADR: metadata from props). Hook it to the same
 * loading budget as the props parse: an expired resolver is `render.page-error`, never an abort,
 * and a result that lands after the deadline is ignored. Absent resolver or absent overrides keep
 * the declared descriptor, so an undeclared resolver changes nothing.
 */
export const resolveCompositionMetadata = async <TProps extends object>(
  options: ResolveCompositionMetadataOptions<TProps>,
): Promise<Result<ResolvedCompositionMetadata>> => {
  const { id, descriptor, frameRate, props, resolveMetadata, timeoutMs } = options;
  if (resolveMetadata === undefined) return { ok: true, value: { descriptor, frameRate } };
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return failure(
      id,
      'render.page-error',
      'Composition metadata resolution has no time budget.',
      'Supply a finite positive loading timeout for resolveMetadata.',
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Result<never>>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          failure(
            id,
            'render.page-error',
            'Composition metadata resolution timed out.',
            'Increase the loading timeout or fix the resolveMetadata callback that does not finish.',
          ),
        ),
      timeoutMs,
    );
  });
  const run = async (): Promise<Result<ResolvedCompositionMetadata>> => {
    try {
      const returned: unknown = await resolveMetadata({ declared: descriptor, props });
      return applyResult({ id, descriptor, frameRate, returned });
    } catch {
      // A thrown or rejected callback is a programmer error; its text can carry secrets.
      return failure(
        id,
        'render.page-error',
        'Composition metadata resolution failed.',
        'Fix the resolveMetadata callback: it must return a Result instead of throwing, and resolve within the loading timeout.',
      );
    }
  };
  try {
    return await Promise.race([expired, run()]);
  } finally {
    clearTimeout(timer);
  }
};
