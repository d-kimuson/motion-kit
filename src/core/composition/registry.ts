import { createElement, type ComponentType, type ReactNode } from 'react';
import { z } from 'zod';

import { type DiagnosticCode } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { createFrameRate, type FrameRate, type RationalInput } from '../timeline/time.ts';

export type CompositionDescriptor = Readonly<{
  id: string;
  width: number;
  height: number;
  fps: RationalInput;
  durationInFrames: number;
}>;
export type JsonObject = z.output<typeof jsonObjectSchema>;

/** A page-local, validated selection. Creating it does not mount a React tree. */
export type PreparedComposition = Readonly<{
  descriptor: CompositionDescriptor;
  frameRate: FrameRate;
  revision: string;
  props: JsonObject;
  render: () => ReactNode;
}>;

export type CompositionEntry = Readonly<{
  descriptor: CompositionDescriptor;
  frameRate: FrameRate;
  prepare: (
    props: unknown,
    revision: string,
    timeoutMs: number,
  ) => Promise<Result<PreparedComposition>>;
}>;
export type CompositionDefinition<S extends z.ZodType<object>> = CompositionEntry &
  Readonly<{
    schema: S;
    component: ComponentType<z.output<S>>;
  }>;

export const compositionFailure = (
  code: DiagnosticCode,
  message: string,
  hint: string,
  id?: string,
): Result<never> => ({
  ok: false,
  error: {
    code,
    severity: 'error',
    message,
    hint,
    ...(id === undefined ? {} : { location: { compositionId: id } }),
  },
});
const pageFailure = (id?: string) =>
  compositionFailure(
    'render.page-error',
    'Composition declaration or loading failed.',
    'Check the declaration and deterministic schema callbacks; remove seconds duration and defaultProps.',
    id,
  );

const propsFailure = (id: string, issues: readonly z.core.$ZodIssue[]): Result<never> => ({
  ok: false,
  error: {
    code: 'composition.props-invalid',
    severity: 'error',
    message: 'Composition props must satisfy the schema and produce a JSON object.',
    hint: 'Make the schema accept {} with defaults and return only JSON-valued object props.',
    location: { compositionId: id },
    // Messages, custom params, input, expected values and exceptions can contain secrets.
    details: {
      issues: issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map((part) =>
          typeof part === 'string' || (typeof part === 'number' && Number.isFinite(part))
            ? part
            : '[invalid key]',
        ),
        message: 'Invalid composition prop.',
      })),
    },
  },
});

// Reject cycles and exotic objects before z.json traverses them; never invoke toJSON/getters.
const jsonShapeIssue = (
  value: unknown,
  path: (string | number)[] = [],
  ancestors = new Set<object>(),
): z.core.$ZodIssue | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    ancestors.has(value) ||
    (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
  ) {
    return { code: 'custom', path, message: 'Expected JSON data.' };
  }
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key === 'symbol' ||
      (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) ||
      property === undefined ||
      !('value' in property) ||
      property.enumerable !== true
    ) {
      return { code: 'custom', path, message: 'Expected JSON data properties.' };
    }
    const issue = jsonShapeIssue(property.value, [...path, key], ancestors);
    if (issue !== undefined) return issue;
  }
  ancestors.delete(value);
  return undefined;
};
const jsonObjectSchema = z.record(z.string(), z.json());

const parseProps = async <S extends z.ZodType<object>>(
  schema: S,
  input: unknown,
  id: string,
  timeoutMs: number,
): Promise<Result<{ typed: z.output<S>; json: JsonObject }>> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return pageFailure(id);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<Result<never>>((resolve) => {
    timer = setTimeout(
      () =>
        resolve(
          compositionFailure(
            'render.page-error',
            'Composition props loading timed out.',
            'Increase the loading timeout or fix the schema callback that does not finish.',
            id,
          ),
        ),
      timeoutMs,
    );
  });
  const parse = async (): Promise<Result<{ typed: z.output<S>; json: JsonObject }>> => {
    try {
      const parsed = await schema.safeParseAsync(input);
      if (!parsed.success) return propsFailure(id, parsed.error.issues);
      const issue = jsonShapeIssue(parsed.data);
      if (issue !== undefined) return propsFailure(id, [issue]);
      const json = jsonObjectSchema.safeParse(parsed.data);
      if (!json.success)
        return propsFailure(
          id,
          json.error.issues.map((issue) => ({
            code: 'custom',
            path: issue.path,
            message: 'Expected JSON-valued output props.',
          })),
        );
      // Shape and JSON validation above establish JsonObject for the original output too.
      // Keep that checked object, not Zod's clone, for both consumers.
      // oxlint-disable-next-line no-unsafe-type-assertion
      return { ok: true, value: { typed: parsed.data, json: parsed.data as JsonObject } };
    } catch {
      return pageFailure(id);
    }
  };
  try {
    return await Promise.race([expired, parse()]);
  } finally {
    clearTimeout(timer);
  }
};

/** Declaration errors are data, so a bad entry cannot throw out of module evaluation. */
export const defineComposition = <S extends z.ZodType<object>>(
  input: CompositionDescriptor & {
    schema: S;
    component: ComponentType<NoInfer<z.output<S>>>;
  },
): Result<CompositionDefinition<S>> => {
  try {
    const { id, width, height, durationInFrames, schema, component } = input;
    if (
      typeof id !== 'string' ||
      id.length === 0 ||
      'duration' in input ||
      'defaultProps' in input ||
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      !Number.isSafeInteger(height) ||
      height <= 0 ||
      typeof schema?.safeParseAsync !== 'function' ||
      (typeof component !== 'function' && (typeof component !== 'object' || component === null))
    )
      return pageFailure();
    if (!Number.isSafeInteger(durationInFrames) || durationInFrames < 0)
      return compositionFailure(
        'composition.duration-invalid',
        'Composition duration must be a nonnegative safe integer frame count.',
        'Supply durationInFrames; zero is listable but has no output frame.',
        id,
      );
    if (typeof input.fps !== 'object' || input.fps === null) return pageFailure(id);
    const fps = createFrameRate(input.fps);
    // Time Module input failures use props-invalid; metadata must not leak that code.
    if (!fps.ok) return pageFailure(id);
    const descriptor = Object.freeze({
      id,
      width,
      height,
      durationInFrames,
      fps: Object.freeze({
        numerator: Number(fps.value.numerator),
        denominator: Number(fps.value.denominator),
      }),
    });
    return {
      ok: true,
      value: Object.freeze({
        descriptor,
        frameRate: fps.value,
        schema,
        component,
        prepare: async (
          props: unknown,
          revision: string,
          timeoutMs: number,
        ): Promise<Result<PreparedComposition>> => {
          const parsed = await parseProps(schema, props, id, timeoutMs);
          if (!parsed.ok) return parsed;
          return {
            ok: true,
            value: Object.freeze({
              descriptor,
              frameRate: fps.value,
              revision,
              props: parsed.value.json,
              render: () => createElement(component, parsed.value.typed),
            }),
          };
        },
      }),
    };
  } catch {
    return pageFailure();
  }
};

export type MountCompositionOptions = {
  compositionId?: string;
  props?: unknown;
  revision: string;
  loadingTimeoutMs?: number;
};
export type CompositionRegistry<D extends readonly Result<CompositionEntry>[]> = Readonly<{
  definitions: D;
  listCompositions: () => readonly CompositionDescriptor[];
  validateDefaults: (revision: string, loadingTimeoutMs?: number) => Promise<Result<undefined>>;
  mount: (options: MountCompositionOptions) => Promise<Result<PreparedComposition>>;
}>;

export const defineCompositions = <const D extends readonly Result<CompositionEntry>[]>(
  definitions: D,
): Result<CompositionRegistry<D>> => {
  try {
    const entries = new Map<string, CompositionEntry>();
    for (const result of definitions) {
      if (!result.ok) return result;
      Object.freeze(result);
      const { id } = result.value.descriptor;
      if (id.length === 0 || entries.has(id)) return pageFailure(id);
      entries.set(id, result.value);
    }
    if (entries.size === 0) return pageFailure();
    const descriptors = Object.freeze([...entries.values()].map((entry) => entry.descriptor));
    const defaults = new Map<string, Promise<Result<undefined>>>();
    const validateDefaults = (revision: string, timeoutMs = 30_000): Promise<Result<undefined>> => {
      const cached = defaults.get(revision);
      if (cached !== undefined) return cached;
      const validate = async (): Promise<Result<undefined>> => {
        for (const entry of entries.values()) {
          const result = await entry.prepare({}, revision, timeoutMs);
          if (!result.ok) return result;
        }
        return { ok: true, value: undefined };
      };
      const pending = validate().then((result) => {
        if (!result.ok) defaults.delete(revision);
        return result;
      });
      defaults.set(revision, pending);
      return pending;
    };
    // Freeze the caller's tuple as well: its exact heterogeneous type remains available.
    Object.freeze(definitions);
    return {
      ok: true,
      value: Object.freeze({
        definitions,
        listCompositions: () => descriptors,
        validateDefaults,
        mount: async ({
          compositionId,
          props = {},
          revision,
          loadingTimeoutMs = 30_000,
        }: MountCompositionOptions): Promise<Result<PreparedComposition>> => {
          const id = compositionId ?? (entries.size === 1 ? descriptors[0]?.id : undefined);
          if (id === undefined)
            return compositionFailure(
              'cli.invalid-arguments',
              'Select a Composition from this registry.',
              `Supply a composition id from: ${descriptors.map((item) => item.id).join(', ')}.`,
            );
          const entry = entries.get(id);
          if (entry === undefined)
            return compositionFailure(
              'cli.composition-not-found',
              'The selected Composition does not exist.',
              'Use an exact case-sensitive id returned by listCompositions.',
            );
          const validated = await validateDefaults(revision, loadingTimeoutMs);
          if (!validated.ok) return validated;
          return entry.prepare(props, revision, loadingTimeoutMs);
        },
      }),
    };
  } catch {
    return pageFailure();
  }
};
