import { describe, expect, it, vi } from 'vitest';

import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { createFrameRate, type FrameRate } from '../timeline/time.ts';
import {
  resolveCompositionMetadata,
  type CompositionMetadataOverride,
  type MetadataResolver,
} from './metadata.ts';
import { type CompositionDescriptor } from './registry.ts';

const declared: CompositionDescriptor = Object.freeze({
  id: 'episode',
  width: 1920,
  height: 1080,
  durationInFrames: 300,
  fps: Object.freeze({ numerator: 30, denominator: 1 }),
});
const frameRate = ((): FrameRate => {
  const rate = createFrameRate(declared.fps);
  if (!rate.ok) throw new Error('The fixture frame rate must be valid.');
  return rate.value;
})();
const props = { voice: 'audio/voice.wav', seconds: 12 };
type Props = typeof props;
const resolve = (resolveMetadata: MetadataResolver<Props> | undefined, timeoutMs = 1_000) =>
  resolveCompositionMetadata<Props>({
    id: declared.id,
    descriptor: declared,
    frameRate,
    props,
    resolveMetadata,
    timeoutMs,
  });
/** A resolver that returns whatever `returned` is, including values a real resolver cannot return. */
const rawResolver =
  (returned: unknown): MetadataResolver<Props> =>
  () => {
    // oxlint-disable-next-line no-unsafe-type-assertion
    return returned as Result<CompositionMetadataOverride>;
  };
const succeeded = async (returned: unknown) => {
  const result = await resolve(overrideOf(returned));
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const failed = async (resolveMetadata: MetadataResolver<Props>) => {
  const result = await resolve(resolveMetadata);
  if (result.ok) throw new Error('Expected the resolution to fail.');
  return result.error;
};
const overrideOf = (override: unknown): MetadataResolver<Props> =>
  rawResolver({ ok: true, value: override });

describe('Composition metadata resolution', () => {
  it('keeps the declared metadata when the Composition declares no resolver', async () => {
    const result = await resolve(undefined);
    if (!result.ok) throw new Error(result.error.message);
    // Identity, not a copy: an absent resolver cannot perturb the declaration.
    expect(result.value.descriptor).toBe(declared);
    expect(result.value.frameRate).toBe(frameRate);
  });

  it('derives the frame count from the validated props', async () => {
    const seen: unknown[] = [];
    const value = await succeeded({ durationInFrames: 360 });
    expect(value.descriptor).toEqual({ ...declared, durationInFrames: 360 });
    expect(value.descriptor).not.toBe(declared);
    expect(Object.isFrozen(value.descriptor)).toBe(true);
    expect(Object.isFrozen(value.descriptor.fps)).toBe(true);
    expect(value.frameRate).toBe(frameRate);
    // The resolver reads the declaration as its baseline and the props as its input.
    const resolver: MetadataResolver<Props> = (input) => {
      seen.push(input);
      return { ok: true, value: { durationInFrames: 1 } };
    };
    await resolve(resolver);
    expect(seen).toEqual([{ declared, props }]);
  });

  it('awaits an asynchronous resolver and keeps no reference to its override', async () => {
    const override: { durationInFrames?: number } = { durationInFrames: 480 };
    const value = await succeeded(override);
    expect(value.descriptor.durationInFrames).toBe(480);
    override.durationInFrames = 1;
    expect(value.descriptor.durationInFrames).toBe(480);
    const delayed = await resolve(async () => {
      await new Promise((done) => setTimeout(done, 5));
      return { ok: true, value: { durationInFrames: 900 } };
    });
    if (!delayed.ok) throw new Error(delayed.error.message);
    expect(delayed.value.descriptor.durationInFrames).toBe(900);
  });

  it('derives resolution and frame rate, keeping fields the override omits', async () => {
    const value = await succeeded({
      width: 1080,
      height: 1920,
      fps: { numerator: 30000, denominator: 1001 },
    });
    expect(value.descriptor).toMatchObject({
      id: 'episode',
      width: 1080,
      height: 1920,
      durationInFrames: 300,
      fps: { numerator: 30000, denominator: 1001 },
    });
    expect(value.frameRate).not.toBe(frameRate);
    expect(value.frameRate.numerator).toBe(30000n);
    expect(value.frameRate.denominator).toBe(1001n);
    expect(Object.isFrozen(value.frameRate)).toBe(true);
    const empty = await succeeded({});
    expect(empty.descriptor).toBe(declared);
    expect(empty.frameRate).toBe(frameRate);
  });

  it('carries the declared audio through a resolved descriptor', async () => {
    const audio = Object.freeze([Object.freeze({ src: 'audio/voice.wav' })]);
    const withAudio: CompositionDescriptor = Object.freeze({ ...declared, audio });
    const result = await resolveCompositionMetadata<Props>({
      id: declared.id,
      descriptor: withAudio,
      frameRate,
      props,
      resolveMetadata: () => ({ ok: true, value: { durationInFrames: 40 } }),
      timeoutMs: 1_000,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.descriptor.audio).toBe(audio);
    expect(Object.isFrozen(result.value.descriptor)).toBe(true);
  });

  it.each([
    [{ durationInFrames: -1 }, 'composition.duration-invalid'],
    [{ durationInFrames: 1.5 }, 'composition.duration-invalid'],
    [{ durationInFrames: Number.POSITIVE_INFINITY }, 'composition.duration-invalid'],
    [{ durationInFrames: Number.MAX_SAFE_INTEGER + 1 }, 'composition.duration-invalid'],
    [{ durationInFrames: '30' }, 'composition.duration-invalid'],
    [{ width: 0 }, 'render.page-error'],
    [{ height: 1.5 }, 'render.page-error'],
    [{ width: undefined }, 'render.page-error'],
    [{ fps: { numerator: 0, denominator: 1 } }, 'render.page-error'],
    [{ fps: { numerator: 30, denominator: 0 } }, 'render.page-error'],
    [{ fps: 30 }, 'render.page-error'],
    [{ duration: 30 }, 'render.page-error'],
    [null, 'render.page-error'],
    [[], 'render.page-error'],
    ['late', 'render.page-error'],
  ] as const)('maps the invalid override %j to %s', async (override, code) => {
    const error = await failed(overrideOf(override));
    expect(error).toMatchObject({
      code,
      severity: 'error',
      location: { compositionId: 'episode' },
    });
    expect(error.hint).toContain('resolveMetadata');
  });

  it('passes a resolver failure through with the Composition id attached', async () => {
    const reported: Diagnostic = {
      code: 'asset.load-failed',
      severity: 'error',
      message: 'The declared voice track could not be read.',
      hint: 'Check the path of the voice track.',
    };
    const error = await failed(() => ({ ok: false, error: reported }));
    expect(error).toMatchObject({
      code: 'asset.load-failed',
      message: reported.message,
      location: { compositionId: 'episode' },
    });
    // A location the resolver supplies is kept; the Composition id is always added.
    const located = await failed(() => ({
      ok: false,
      error: { ...reported, location: { file: 'audio/voice.wav' } },
    }));
    expect(located.location).toEqual({ file: 'audio/voice.wav', compositionId: 'episode' });
  });

  it.each([
    ['a non-Result return', undefined],
    ['a Result without an ok flag', { value: {} }],
    ['a failure without a Diagnostic', { ok: false, error: { code: 'nope' } }],
    [
      'a Diagnostic with an unknown code',
      { ok: false, error: { code: 'nope.nope', severity: 'error', message: 'x', hint: 'y' } },
    ],
    ['a success without a value', { ok: true }],
  ] as const)('rejects %s as a page error', async (_name, returned) => {
    const error = await failed(rawResolver(returned));
    expect(error).toMatchObject({
      code: 'render.page-error',
      location: { compositionId: 'episode' },
    });
  });

  it('rejects a thrown or rejected resolver without leaking the exception', async () => {
    const thrown = await failed(() => {
      throw new Error('secret-token-abc');
    });
    expect(thrown).toMatchObject({ code: 'render.page-error', severity: 'error' });
    expect(JSON.stringify(thrown)).not.toContain('secret-token-abc');
    const rejected = await failed(() => Promise.reject(new Error('secret-token-abc')));
    expect(JSON.stringify(rejected)).not.toContain('secret-token-abc');
  });

  it('bounds the resolver with the loading timeout and ignores a late result', async () => {
    vi.useFakeTimers();
    try {
      const pending = resolve(() => new Promise(() => {}), 20);
      await vi.advanceTimersByTimeAsync(20);
      const result = await pending;
      if (result.ok) throw new Error('Expected the resolution to time out.');
      expect(result.error).toMatchObject({
        code: 'render.page-error',
        location: { compositionId: 'episode' },
      });
      expect(result.error.message).toContain('metadata');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves the same props to the same metadata, twice', async () => {
    const resolver: MetadataResolver<Props> = ({ props: input }) => ({
      ok: true,
      value: { durationInFrames: input.seconds * 30 },
    });
    const first = await resolve(resolver);
    const second = await resolve(resolver);
    if (!first.ok || !second.ok) throw new Error('Expected both resolutions to succeed.');
    expect(first.value.descriptor).toEqual(second.value.descriptor);
    expect(first.value.descriptor).not.toBe(second.value.descriptor);
  });
});
