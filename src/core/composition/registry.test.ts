import { defineComposition, defineCompositions, DiagnosticSchema, type Result } from 'motion-kit';
import { isValidElement } from 'react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const metadata = {
  id: 'Title',
  width: 1920,
  height: 1080,
  fps: { numerator: 60000, denominator: 2002 },
  durationInFrames: 150,
};
const schema = z.object({ title: z.string().default('Hello') });
const component = (_props: z.output<typeof schema>) => null;
const entry = (overrides: Partial<typeof metadata> = {}) =>
  defineComposition({ ...metadata, ...overrides, schema, component });

describe('Composition registry', () => {
  it('preserves heterogeneous schema/component inference and ordered immutable descriptors', () => {
    const countSchema = z.object({ count: z.number().default(1) });
    const count = defineComposition({
      ...metadata,
      id: '__proto__',
      schema: countSchema,
      component: (_props: { count: number }) => null,
    });
    const registry = unwrap(defineCompositions([entry(), count, entry({ id: 'title' })]));
    expectTypeOf(unwrap(registry.definitions[1]).schema).toEqualTypeOf<typeof countSchema>();
    expect(registry.listCompositions()).toEqual([
      { ...metadata, fps: { numerator: 30000, denominator: 1001 } },
      { ...metadata, id: '__proto__', fps: { numerator: 30000, denominator: 1001 } },
      { ...metadata, id: 'title', fps: { numerator: 30000, denominator: 1001 } },
    ]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.definitions)).toBe(true);
    expect(Object.isFrozen(unwrap(registry.definitions[0]).descriptor.fps)).toBe(true);
    // @ts-expect-error Each component must accept its own schema output, not another entry's props.
    defineComposition({ ...metadata, schema, component: (_props: { count: number }) => null });
  });

  it('rejects duplicate ids, empty ids and an empty registry at declaration', () => {
    expect(defineCompositions([entry(), entry()])).toMatchObject({
      ok: false,
      error: { code: 'render.page-error' },
    });
    expect(entry({ id: '' })).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
    expect(defineCompositions([])).toMatchObject({
      ok: false,
      error: { code: 'render.page-error' },
    });
  });

  it.each([
    [{ width: 0 }, 'render.page-error'],
    [{ height: 1.5 }, 'render.page-error'],
    [{ width: Number.MAX_SAFE_INTEGER + 1 }, 'render.page-error'],
    [{ fps: { numerator: 0, denominator: 1 } }, 'render.page-error'],
    [{ fps: { numerator: 30, denominator: 0 } }, 'render.page-error'],
    [{ fps: { numerator: 1.5, denominator: 1 } }, 'render.page-error'],
    [{ durationInFrames: -1 }, 'composition.duration-invalid'],
    [{ durationInFrames: Number.POSITIVE_INFINITY }, 'composition.duration-invalid'],
  ] as const)('maps malformed metadata %j to %s', (overrides, code) => {
    expect(entry(overrides)).toMatchObject({ ok: false, error: { code } });
  });

  it('rejects seconds duration and declaration exceptions without throwing', () => {
    expect(
      defineComposition({
        ...metadata,
        schema,
        component,
        // @ts-expect-error Seconds duration is not an accepted declaration field.
        duration: 5,
      }),
    ).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
    expect(
      defineComposition({
        ...metadata,
        schema,
        component,
        get width(): number {
          throw new Error('secret');
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
  });

  it('rejects malformed runtime FPS shapes and fractional or unsafe duration', () => {
    // @ts-expect-error JavaScript callers can supply a numeric FPS instead of a rational object.
    expect(defineComposition({ ...metadata, schema, component, fps: 30 })).toMatchObject({
      ok: false,
      error: { code: 'render.page-error' },
    });
    for (const durationInFrames of [0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(entry({ durationInFrames })).toMatchObject({
        ok: false,
        error: { code: 'composition.duration-invalid' },
      });
  });

  it.each(['function', 'inherited', 'throwing getter'] as const)(
    'rejects %s component defaultProps at declaration',
    (kind) => {
      const Scene = (_props: z.output<typeof schema>) => null;
      if (kind === 'throwing getter')
        Object.defineProperty(Scene, 'defaultProps', {
          get: () => {
            throw new Error('private getter error');
          },
        });
      else if (kind === 'inherited')
        Object.setPrototypeOf(Scene, { defaultProps: { callback: () => 42 } });
      else Object.assign(Scene, { defaultProps: { callback: () => 42 } });
      const result = defineComposition({ ...metadata, schema, component: Scene });
      expect(result).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
      if (result.ok) throw new Error('accepted component defaults');
      expect(result.error.message).toContain('Scene');
      expect(result.error.message).toContain('defaultProps');
      expect(result.error.message).toContain('schema defaults are the only defaults authority');
      expect(JSON.stringify(result)).not.toContain('private getter error');
    },
  );

  it('never executes a side-effecting defaultProps getter across repeated declarations', () => {
    let calls = 0;
    const Scene = (_props: z.output<typeof schema>) => null;
    Object.defineProperty(Scene, 'defaultProps', {
      get: () => {
        calls += 1;
        return {};
      },
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(defineComposition({ ...metadata, schema, component: Scene })).toMatchObject({
        ok: false,
        error: { code: 'render.page-error' },
      });
      expect(calls).toBe(0);
    }
  });

  it('rejects inherited enumerable keys inside the defaults object', () => {
    const defaults = {};
    Object.setPrototypeOf(defaults, { callback: () => 42 });
    expect(Reflect.ownKeys(defaults)).toEqual([]);
    const Scene = Object.assign((_props: z.output<typeof schema>) => null, {
      defaultProps: defaults,
    });
    expect(defineComposition({ ...metadata, schema, component: Scene })).toMatchObject({
      ok: false,
      error: { code: 'render.page-error' },
    });
  });

  it('accepts empty component defaultProps', () => {
    const Scene = Object.assign((_props: z.output<typeof schema>) => null, { defaultProps: {} });
    expect(defineComposition({ ...metadata, schema, component: Scene })).toMatchObject({
      ok: true,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['array', [1]],
    ['primitive', 'title'],
    ['bigint root', 1n],
  ] as const)(
    'classifies %s schema output as props-invalid after defaults succeed',
    async (_name, output) => {
      const registry = unwrap(
        defineCompositions([
          defineComposition({
            ...metadata,
            schema: z
              .any()
              .transform((input: unknown) => (input === 'supplied' ? output : input))
              .pipe(z.any()),
            component: () => null,
          }),
        ]),
      );
      expect(await registry.validateDefaults('v1')).toEqual({ ok: true, value: undefined });
      expect(await registry.mount({ revision: 'v1', props: 'supplied' })).toMatchObject({
        ok: false,
        error: { code: 'composition.props-invalid' },
      });
    },
  );

  it('rejects cyclic and exotic outputs with JSON issues rather than throwing', async () => {
    const cycle: { next?: object } = {};
    cycle.next = cycle;
    for (const output of [
      cycle,
      { value: new Map() },
      { value: Number.NaN },
      { value: undefined },
    ]) {
      const actualSchema = z.object({}).transform(() => output);
      const registry = unwrap(
        defineCompositions([
          defineComposition({ ...metadata, schema: actualSchema, component: () => null }),
        ]),
      );
      const result = await registry.mount({ revision: 'v1' });
      expect(result).toMatchObject({ ok: false, error: { code: 'composition.props-invalid' } });
      expect(JSON.stringify(result)).toContain('"issues":[');
    }
  });

  it.each([
    [
      'non-index array function properties',
      () => ({ values: Object.assign([1], { callback: () => 'not JSON' }) }),
    ],
    ['numeric extra array properties', () => ({ values: Object.assign([1], { label: 42 }) })],
    ['string extra array properties', () => ({ values: Object.assign([1], { label: 'text' }) })],
    [
      'symbol-keyed array properties',
      () => ({ values: Object.assign([1], { [Symbol('label')]: 42 }) }),
    ],
    [
      'nested numeric extra array properties',
      () => ({ values: [Object.assign([1], { label: 42 })] }),
    ],
    [
      'nested string extra array properties',
      () => ({ values: [Object.assign([1], { label: 'text' })] }),
    ],
    [
      'nested symbol-keyed array properties',
      () => ({ values: [Object.assign([1], { [Symbol('label')]: 'text' })] }),
    ],
    [
      'own __proto__ function',
      () => Object.defineProperty({}, '__proto__', { value: () => 'not JSON', enumerable: true }),
    ],
    [
      'nested own __proto__ function',
      () => ({
        value: Object.defineProperty({}, '__proto__', {
          value: () => 'not JSON',
          enumerable: true,
        }),
      }),
    ],
    ['accessors', () => Object.defineProperty({}, 'value', { get: () => 1, enumerable: true })],
    ['non-enumerable properties', () => Object.defineProperty({}, 'value', { value: 1 })],
    ['sparse arrays', () => ({ values: Object.assign([], { length: 2 }) })],
    ['non-JSON numbers', () => ({ value: Number.POSITIVE_INFINITY })],
    [
      'cycles',
      () => {
        const value: { next?: object } = {};
        value.next = value;
        return value;
      },
    ],
    [
      'class instances',
      () => ({
        value: new (class Value {
          count = 1;
        })(),
      }),
    ],
    ['bigint property', () => ({ value: 1n })],
    ['nested bigint', () => ({ values: [{ value: 1n }] })],
    [
      'bigint under __proto__',
      () => ({ nested: Object.defineProperty({}, '__proto__', { value: 1n, enumerable: true }) }),
    ],
    ['functions', () => ({ value: () => 1 })],
    ['symbols', () => ({ value: Symbol('private') })],
    ['symbol keys', () => ({ [Symbol('private')]: 1 })],
    ['undefined', () => ({ value: undefined })],
  ] as const)('rejects %s in parsed props without mounting', async (_name, output) => {
    const render = vi.fn(() => null);
    const registry = unwrap(
      defineCompositions([
        defineComposition({
          ...metadata,
          schema: z.object({}).transform(output),
          component: render,
        }),
      ]),
    );
    expect(await registry.mount({ revision: 'v1' })).toMatchObject({
      ok: false,
      error: { code: 'composition.props-invalid' },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('rebuilds checked JSON values for prepared props and rendering', async () => {
    const output = { values: [1] };
    const registry = unwrap(
      defineCompositions([
        defineComposition({
          ...metadata,
          schema: z.object({}).transform(() => output),
          component: () => null,
        }),
      ]),
    );
    const prepared = unwrap(await registry.mount({ revision: 'v1' }));
    const rendered = prepared.render();
    if (!isValidElement<{ values: number[] }>(rendered)) throw new Error('not an element');
    expect(prepared.props).toEqual(output);
    expect(prepared.props).not.toBe(output);
    expect(prepared.props['values']).not.toBe(output.values);
    expect(rendered.props).toEqual(prepared.props);
    expect(rendered.props).not.toBe(prepared.props);
    expect(rendered.props.values).toBe(prepared.props['values']);
  });

  it('reports non-JSON output as a producer-created custom issue at the output path', async () => {
    const actualSchema = z.object({}).transform(() => ({ value: () => 1 }));
    const registry = unwrap(
      defineCompositions([
        defineComposition({ ...metadata, schema: actualSchema, component: () => null }),
      ]),
    );
    expect(await registry.mount({ revision: 'v1' })).toMatchObject({
      ok: false,
      error: {
        code: 'composition.props-invalid',
        details: { issues: [{ code: 'custom', path: ['value'] }] },
      },
    });
  });

  it('rejects an asynchronous refinement failure for supplied props without mounting', async () => {
    const render = vi.fn(component);
    const actualSchema = schema.refine(async (props) => {
      await Promise.resolve();
      return props.title === 'Hello';
    });
    const registry = unwrap(
      defineCompositions([
        defineComposition({ ...metadata, schema: actualSchema, component: render }),
      ]),
    );
    expect(await registry.mount({ revision: 'v1', props: { title: 'invalid' } })).toMatchObject({
      ok: false,
      error: { code: 'composition.props-invalid' },
    });
    expect(render).not.toHaveBeenCalled();
  });

  it('lists zero duration without mounting and selects exact case-sensitive ids', async () => {
    const render = vi.fn(component);
    const registry = unwrap(
      defineCompositions([
        defineComposition({ ...metadata, durationInFrames: 0, schema, component: render }),
      ]),
    );
    expect(registry.listCompositions()[0]?.durationInFrames).toBe(0);
    expect(render).not.toHaveBeenCalled();
    expect(await registry.mount({ compositionId: 'title', revision: 'v1' })).toMatchObject({
      ok: false,
      error: { code: 'cli.composition-not-found' },
    });
    expect(await registry.mount({ revision: 'v1' })).toMatchObject({ ok: true });
    expect(
      await unwrap(defineCompositions([entry(), entry({ id: 'other' })])).mount({ revision: 'v1' }),
    ).toMatchObject({ ok: false, error: { code: 'cli.invalid-arguments' } });
  });

  it('parses defaults once per revision and raw props once per mount using the real async schema', async () => {
    const parse = vi.fn(async (value: { title: string }) => {
      await Promise.resolve();
      return value;
    });
    const actualSchema = schema.transform(parse);
    const registry = unwrap(
      defineCompositions([defineComposition({ ...metadata, schema: actualSchema, component })]),
    );
    const first = unwrap(await registry.mount({ revision: 'v1', props: {} }));
    expect(first.props).toEqual({ title: 'Hello' });
    expect(parse).toHaveBeenCalledTimes(2);
    unwrap(await registry.mount({ revision: 'v1', props: { title: 'Explicit', ignored: true } }));
    expect(parse).toHaveBeenCalledTimes(3);
    unwrap(await registry.mount({ revision: 'v2' }));
    expect(parse).toHaveBeenCalledTimes(5);
  });

  it('does not merge parsed defaults into supplied nested objects', async () => {
    const nestedSchema = z.object({
      nested: z.object({ value: z.string() }).default({ value: 'default' }),
    });
    const registry = unwrap(
      defineCompositions([
        defineComposition({ ...metadata, schema: nestedSchema, component: () => null }),
      ]),
    );
    expect(await registry.mount({ revision: 'v1', props: { nested: {} } })).toMatchObject({
      ok: false,
      error: { code: 'composition.props-invalid' },
    });
  });

  it('sanitizes custom issues and never renders a failed parse', async () => {
    const render = vi.fn(component);
    const custom = schema.superRefine((value, ctx) => {
      if (value.title !== 'Hello')
        ctx.addIssue({
          code: 'custom',
          message: 'secret-token https://user:password@example.com/?token=secret',
          params: { input: value },
        });
    });
    const registry = unwrap(
      defineCompositions([defineComposition({ ...metadata, schema: custom, component: render })]),
    );
    const result = await registry.mount({ revision: 'v1', props: { title: 'bad' } });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'composition.props-invalid',
        location: { compositionId: 'Title' },
        details: { issues: [{ code: 'custom', path: [] }] },
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(render).not.toHaveBeenCalled();
  });

  it('keeps custom issue paths JSON-valued even when a refinement supplies non-finite keys', async () => {
    const actualSchema = schema.superRefine((_props, context) => {
      context.addIssue({
        code: 'custom',
        path: [Number.NaN, Number.POSITIVE_INFINITY, Symbol('private')],
        message: 'private',
      });
    });
    const registry = unwrap(
      defineCompositions([defineComposition({ ...metadata, schema: actualSchema, component })]),
    );
    const result = await registry.mount({ revision: 'v1' });
    expect(DiagnosticSchema.safeParse(result.ok ? undefined : result.error).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('rejects invalid defaults, non-JSON output, and thrown refinements', async () => {
    for (const actualSchema of [
      z.object({ required: z.string() }),
      z.object({ value: z.unknown() }).transform(() => ({ value: () => 1 })),
    ]) {
      const registry = unwrap(
        defineCompositions([
          defineComposition({ ...metadata, schema: actualSchema, component: () => null }),
        ]),
      );
      const result = await registry.mount({ revision: 'v1' });
      expect(result).toMatchObject({ ok: false, error: { code: 'composition.props-invalid' } });
    }
    const throwing = schema.transform((): { title: string } => {
      throw new Error('secret');
    });
    const registry = unwrap(
      defineCompositions([defineComposition({ ...metadata, schema: throwing, component })]),
    );
    expect(await registry.mount({ revision: 'v1' })).toMatchObject({
      ok: false,
      error: { code: 'render.page-error' },
    });
  });

  it('retries failed defaults with a corrected budget and caches only success', async () => {
    vi.useFakeTimers();
    try {
      const parse = vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        return { title: 'Hello' };
      });
      const registry = unwrap(
        defineCompositions([
          defineComposition({ ...metadata, schema: z.object({}).transform(parse), component }),
        ]),
      );
      const expired = registry.validateDefaults('v1', 10);
      expect(registry.validateDefaults('v1', 10)).toBe(expired);
      await vi.advanceTimersByTimeAsync(10);
      expect(await expired).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
      const retried = registry.validateDefaults('v1', 100);
      await vi.advanceTimersByTimeAsync(20);
      expect(await retried).toEqual({ ok: true, value: undefined });
      expect(await registry.validateDefaults('v1', 100)).toEqual({ ok: true, value: undefined });
      expect(parse).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds each parse separately and ignores a late result', async () => {
    vi.useFakeTimers();
    try {
      const registry = unwrap(
        defineCompositions([
          defineComposition({
            ...metadata,
            schema: schema.transform(() => new Promise<{ title: string }>(() => {})),
            component,
          }),
        ]),
      );
      const pending = registry.mount({ revision: 'v1', loadingTimeoutMs: 20 });
      await vi.advanceTimersByTimeAsync(20);
      expect(await pending).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
    } finally {
      vi.useRealTimers();
    }
  });
});
