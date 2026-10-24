import { createElement, type ComponentType, type ReactNode } from 'react';
import { type z } from 'zod';

import { type Diagnostic, type DiagnosticCode } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { createFrameRate, type FrameRate, type RationalInput } from '../timeline/time.ts';

export type CompositionDescriptor = Readonly<{
  id: string;
  width: number;
  height: number;
  fps: RationalInput;
  durationInFrames: number;
}>;
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

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
  details?: NonNullable<Diagnostic['details']>,
): Result<never> => ({
  ok: false,
  error: {
    code,
    severity: 'error',
    message,
    hint,
    ...(id === undefined ? {} : { location: { compositionId: id } }),
    ...(details === undefined ? {} : { details }),
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
    hint: 'Supply the required props or declare per-property schema defaults and return only JSON-valued object props.',
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

// Rebuild every own data property, including __proto__; record validators can skip that key.
// Never invoke getters/toJSON, and never retain an unchecked value from the schema output.
const rebuildJson = (
  value: unknown,
  path: (string | number)[] = [],
  ancestors = new Set<object>(),
): { ok: true; value: JsonValue } | { ok: false; issue: z.core.$ZodIssue } => {
  const invalid = (): { ok: false; issue: z.core.$ZodIssue } => ({
    ok: false,
    issue: { code: 'custom', path, message: 'Expected JSON data properties.' },
  });
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return { ok: true, value };
  if (typeof value !== 'object') return invalid();
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  const names = Object.getOwnPropertyNames(value);
  if (
    ancestors.has(value) ||
    (array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    (array && names.length !== value.length + 1)
  )
    return invalid();
  const rebuilt: JsonObject | JsonValue[] = array ? [] : {};
  ancestors.add(value);
  for (const key of names) {
    if (array && key === 'length') continue;
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) ||
      property === undefined ||
      !('value' in property) ||
      property.enumerable !== true
    )
      return invalid();
    const child = rebuildJson(property.value, [...path, key], ancestors);
    if (!child.ok) return child;
    Object.defineProperty(rebuilt, key, {
      value: child.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  ancestors.delete(value);
  return { ok: true, value: rebuilt };
};

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
      if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data))
        return propsFailure(id, [{ code: 'custom', path: [], message: 'Expected a JSON object.' }]);
      for (const field of ['key', 'ref', '__self', '__source', '__proto__']) {
        if (Object.hasOwn(parsed.data, field))
          return compositionFailure(
            'composition.props-invalid',
            `Composition props cannot contain the top-level field "${field}".`,
            `Rename "${field}": React consumes or copies this reserved field and cannot deliver it faithfully.`,
            id,
          );
      }
      const rebuilt = rebuildJson(parsed.data);
      if (!rebuilt.ok) return propsFailure(id, [rebuilt.issue]);
      const json = rebuilt.value;
      if (json === null || typeof json !== 'object' || Array.isArray(json))
        return propsFailure(id, [{ code: 'custom', path: [], message: 'Expected a JSON object.' }]);
      // Rebuilding preserves the schema's values while removing reliance on its mutable output.
      // React makes a top-level copy; nested references come from this checked tree.
      // oxlint-disable-next-line no-unsafe-type-assertion
      return { ok: true, value: { typed: json as z.output<S>, json } };
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

// Inspect inherited class statics too, without executing defaultProps accessors.
const validateComponentDefaults = (component: object, id: string): Result<undefined> => {
  let name = id;
  const failure = () =>
    compositionFailure(
      'render.page-error',
      `Component "${name}" has non-empty or unreadable defaultProps; schema defaults are the only defaults authority.`,
      'Remove component defaultProps (including accessors) and declare defaults in the schema.',
      id,
    );
  try {
    if ('name' in component && typeof component.name === 'string' && component.name.length > 0)
      name = component.name;
    let current: unknown = component;
    while ((typeof current === 'object' && current !== null) || typeof current === 'function') {
      const property = Object.getOwnPropertyDescriptor(current, 'defaultProps');
      if (property !== undefined) {
        if (!('value' in property)) return failure();
        const defaults: unknown = property.value;
        if (defaults === undefined || defaults === null) return { ok: true, value: undefined };
        if (typeof defaults !== 'object' || Reflect.ownKeys(defaults).length > 0) return failure();
        // React also copies inherited enumerable defaults.
        for (const key in defaults) {
          void key;
          return failure();
        }
        return { ok: true, value: undefined };
      }
      current = Object.getPrototypeOf(current);
    }
    return { ok: true, value: undefined };
  } catch {
    return failure();
  }
};

// Validate every layer React resolves, not only the outer wrapper's statics.
const validateComponent = (component: object, id: string): Result<undefined> => {
  let current: unknown = component;
  const visited = new Set<object>();
  while ((typeof current === 'object' && current !== null) || typeof current === 'function') {
    if (visited.has(current)) return pageFailure(id);
    visited.add(current);
    if ('$$typeof' in current && current.$$typeof === Symbol.for('react.lazy'))
      return compositionFailure(
        'render.page-error',
        'The "component" field is a lazy component and cannot be validated before it resolves.',
        'Lazy-load inside the component instead of using lazy as the registry entry.',
        id,
      );
    const defaults = validateComponentDefaults(current, id);
    if (!defaults.ok) return defaults;
    if ('$$typeof' in current) {
      if (current.$$typeof === Symbol.for('react.memo')) {
        current = 'type' in current ? current.type : undefined;
        continue;
      }
      if (current.$$typeof === Symbol.for('react.forward_ref')) {
        current = 'render' in current ? current.render : undefined;
        continue;
      }
    }
    return { ok: true, value: undefined };
  }
  return pageFailure(id);
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
    const componentDefaults = validateComponent(component, id);
    if (!componentDefaults.ok) return componentDefaults;
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
    // Freeze the caller's tuple as well: its exact heterogeneous type remains available.
    Object.freeze(definitions);
    return {
      ok: true,
      value: Object.freeze({
        definitions,
        listCompositions: () => descriptors,
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
              undefined,
              { ids: descriptors.map((item) => item.id) },
            );
          const entry = entries.get(id);
          if (entry === undefined)
            return compositionFailure(
              'cli.composition-not-found',
              'The selected Composition does not exist.',
              'Use an exact case-sensitive id returned by listCompositions.',
            );
          return entry.prepare(props, revision, loadingTimeoutMs);
        },
      }),
    };
  } catch {
    return pageFailure();
  }
};
