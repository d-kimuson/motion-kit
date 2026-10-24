import { DiagnosticSchema, defineComposition, defineCompositions } from 'motion-kit';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { assetsOf, createCompositionRuntime } from '../runtime/composition-runtime.ts';
import { redactAssetSource } from './diagnostics.ts';
import { createAssetRegistry } from './registry.ts';
import { type AssetContext, type AssetDescriptor, type ImageAssetDescriptor } from './types.ts';
import { openAssetRead } from './use-asset.ts';

const context: AssetContext = {
  compositionId: 'demo',
  frame: 3,
  timeSeconds: 0.1,
  generation: 1,
};
const image = (source: string, id = 'hero'): ImageAssetDescriptor => ({
  kind: 'image',
  id,
  source,
  sceneId: 'intro',
});
const font = (source: string, weight: number | string = 400): AssetDescriptor => ({
  kind: 'font',
  id: `face-${weight}`,
  family: 'Abel',
  source,
  weight,
  sceneId: 'intro',
});
const tick = async () => {
  for (let count = 0; count < 20; count += 1) await Promise.resolve();
};
const secretUrl = 'https://user:s3cret@example.com/image.png?X-Amz-Signature=signedvalue&v=1';
const leaked = (value: unknown): boolean =>
  JSON.stringify(value).includes('s3cret') || JSON.stringify(value).includes('signedvalue');

describe('asset registry', () => {
  it('registers before the suspense read is observable', () => {
    const registry = createAssetRegistry({ load: () => new Promise(() => {}) });
    const read = openAssetRead(registry, image('/hero.png'), 'owner', context);
    expect(read.status).toBe('pending');
    expect(registry.pending().map((asset) => asset.id)).toContain('hero');
    expect(registry.snapshot().pending).toEqual([
      expect.objectContaining({ id: 'hero', kind: 'image', phase: 'decode' }),
    ]);
  });

  it('drains registrations discovered after the first pending set settles', async () => {
    const second = Promise.withResolvers<string>();
    let discovered = false;
    const registry = createAssetRegistry({
      load: (descriptor) => {
        if (descriptor.id === 'late') return second.promise;
        if (!discovered) {
          discovered = true;
          registry.retain(image('/late.png', 'late'), 'owner-b', context);
        }
        return Promise.resolve('first');
      },
    });
    registry.retain(image('/first.png', 'first'), 'owner-a', context);
    let settled = false;
    const ready = registry
      .whenReady({
        signal: new AbortController().signal,
        timeoutMs: 2000,
        location: { compositionId: 'demo', frame: 3, timeSeconds: 0.1 },
        generation: 1,
        committed: () => true,
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await tick();
    expect(settled).toBe(false);
    expect(registry.pending().map((asset) => asset.id)).toContain('late');
    second.resolve('second');
    await expect(ready).resolves.toEqual({ ok: true, value: undefined });
  });

  it('shares a load for the same source and distinguishes weight and source', async () => {
    const calls: string[] = [];
    const registry = createAssetRegistry({
      load: (descriptor) => {
        calls.push(
          `${descriptor.kind}:${descriptor.source}:${'weight' in descriptor ? descriptor.weight : ''}`,
        );
        return Promise.resolve('ready');
      },
    });
    registry.retain(image('/same.png', 'one'), 'a', context);
    registry.retain(image('/same.png', 'two'), 'b', context);
    registry.retain(font('/face.ttf', 400), 'c', context);
    registry.retain(font('/face.ttf', 700), 'd', context);
    registry.retain(image('/other.png', 'three'), 'e', context);
    await tick();
    expect(calls).toEqual([
      'image:/same.png:',
      'font:/face.ttf:400',
      'font:/face.ttf:700',
      'image:/other.png:',
    ]);
  });

  it('retries a failed load as a new attempt', async () => {
    let calls = 0;
    const registry = createAssetRegistry({
      load: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('s3cret-retry'))
          : Promise.resolve('recovered');
      },
    });
    const read = registry.retain(image('/retry.png'), 'owner', context);
    await read.promise;
    expect(registry.snapshot().failed.map((asset) => asset.id)).toEqual(['hero']);
    registry.retry(read.key);
    await tick();
    expect(calls).toBe(2);
    expect(registry.snapshot().ready.map((asset) => asset.id)).toEqual(['hero']);
    expect(leaked(registry.snapshot())).toBe(false);
  });

  it('suppresses a stale load acknowledgement', async () => {
    const first = Promise.withResolvers<string>();
    const gates: PromiseWithResolvers<string>[] = [];
    const registry = createAssetRegistry({
      load: (_descriptor, _signal, attempt) => {
        if (attempt === 1) return first.promise;
        const gate = Promise.withResolvers<string>();
        gates.push(gate);
        return gate.promise;
      },
    });
    const read = registry.retain(image('/stale.png'), 'owner', context);
    await tick();
    registry.retry(read.key);
    first.resolve('stale-value');
    await tick();
    expect(gates).toHaveLength(1);
    expect(registry.snapshot().pending.map((asset) => asset.id)).toEqual(['hero']);
    expect(registry.snapshot().ready).toEqual([]);
    gates[0]?.resolve('fresh');
    await tick();
    expect(registry.snapshot().ready.map((asset) => asset.id)).toEqual(['hero']);
  });

  it('cancels an unowned load and does not let it satisfy the replacement', async () => {
    const gates: PromiseWithResolvers<string>[] = [];
    const registry = createAssetRegistry({
      load: () => {
        const gate = Promise.withResolvers<string>();
        gates.push(gate);
        return gate.promise;
      },
    });
    registry.retain(image('/cancel.png'), 'owner', context);
    registry.release('owner');
    registry.retain(image('/cancel.png'), 'next', context);
    gates[0]?.resolve('cancelled');
    await tick();
    expect(registry.snapshot().pending.map((asset) => asset.id)).toEqual(['hero']);
    gates[1]?.resolve('live');
    await tick();
    expect(registry.snapshot().ready).toHaveLength(1);
  });

  it('moves an owner to a changed source and ignores the previous load', async () => {
    const gates: PromiseWithResolvers<string>[] = [];
    const registry = createAssetRegistry({
      load: () => {
        const gate = Promise.withResolvers<string>();
        gates.push(gate);
        return gate.promise;
      },
    });
    registry.retain(image('/before.png', 'picture'), 'owner', context);
    registry.retain(image('/after.png', 'picture'), 'owner', context);
    gates[0]?.resolve('before');
    await tick();
    expect(registry.pending().map((asset) => asset.source)).toEqual(['/after.png']);
    gates[1]?.resolve('after');
    await tick();
    expect(registry.snapshot().ready.map((asset) => asset.source)).toEqual(['/after.png']);
  });

  it('redacts credentials signed queries and loader exception text', async () => {
    const registry = createAssetRegistry({
      load: () => Promise.reject(new Error('loader blew up signedvalue and s3cret')),
    });
    registry.retain(image(secretUrl), 'owner', context);
    const result = await registry.whenReady({
      signal: new AbortController().signal,
      timeoutMs: 1000,
      location: { compositionId: 'demo', frame: 3, timeSeconds: 0.1 },
      generation: 1,
      committed: () => true,
    });
    expect(result.ok).toBe(false);
    if (result.ok || 'aborted' in result) throw new Error('expected diagnostics');
    expect(leaked(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain('user:s3cret');
    expect(JSON.stringify(result)).not.toContain('signedvalue');
    expect(JSON.stringify(result)).not.toContain('v=1');
    expect(JSON.stringify(result)).not.toContain('X-Amz-Signature');
    expect(JSON.stringify(result)).toContain('example.com/image.png');
    for (const diagnostic of result.error)
      expect(DiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
    expect(result.error[0]).toMatchObject({
      code: 'asset.load-failed',
      location: {
        compositionId: 'demo',
        sceneId: 'intro',
        frame: 3,
        timeSeconds: 0.1,
        elementId: 'hero',
      },
      details: {
        assets: [
          {
            kind: 'image',
            phase: 'decode',
            source: 'https://example.com/image.png (+2 query parameters, redacted)',
          },
        ],
      },
    });
    const dirty = DiagnosticSchema.parse({
      code: 'asset.load-failed',
      severity: 'error',
      message: 'The required image failed to decode.',
      hint: 'Check the image source and file format.',
      details: { assets: [{ kind: 'image', source: secretUrl, phase: 'decode' }] },
    });
    expect(JSON.stringify(dirty)).toContain('s3cret');
    expect(redactAssetSource(secretUrl)).toBe(
      'https://example.com/image.png (+2 query parameters, redacted)',
    );
    expect(leaked(registry.versions())).toBe(false);
    expect(leaked(registry.snapshot())).toBe(false);
  });

  it('redacts signed-query credentials, access-key names, and nested userinfo', () => {
    expect(
      redactAssetSource('https://user:s3cret@example.com/one.png?AWSAccessKeyId=AKIASECRET'),
    ).toBe('https://example.com/one.png (+1 query parameter, redacted)');
    expect(redactAssetSource('/two.png?access_key=SECRETKEY')).toBe(
      '/two.png (+1 query parameter, redacted)',
    );
    expect(
      redactAssetSource('https://cdn.example/two.png?url=https://user:s3cret@evil.example/x'),
    ).toBe('https://cdn.example/two.png (+1 query parameter, redacted)');
    expect(redactAssetSource('https://cdn.example/ok.png?v=2&w=320')).toBe(
      'https://cdn.example/ok.png (+2 query parameters, redacted)',
    );
    expect(redactAssetSource('https://example.com/a.png#fragment-token')).toBe(
      'https://example.com/a.png',
    );
    const nested = redactAssetSource(
      'https://cdn.example/two.png?url=https://user:s3cret@evil.example/x',
    );
    expect(nested).not.toContain('s3cret');
    expect(nested).not.toContain('user%3A');
    expect(nested).not.toContain('url=');
    expect(decodeURIComponent(nested)).not.toContain('user:s3cret');
  });

  it('redacts query values under unrelated parameter names', async () => {
    const awsSecret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const jwt = [
      'eyJhbGciOiJub25lIn0',
      'eyJzdWIiOiJmaXh0dXJlIn0',
      'bm90LWEtbGl2ZS1zaWduYXR1cmU',
    ].join('.');
    const sig2 = 'hmac9f3a1c8e7b6d5a4f';
    const googleAccessId = 'prod-signer@example.iam.gserviceaccount.com';
    const shapes = [
      {
        source: `https://example.com/a.png?q=${encodeURIComponent(awsSecret)}`,
        expected: 'https://example.com/a.png (+1 query parameter, redacted)',
        secret: awsSecret,
        forbidden: ['q=', awsSecret],
      },
      {
        source: `https://example.com/a.png?next=${encodeURIComponent(jwt)}`,
        expected: 'https://example.com/a.png (+1 query parameter, redacted)',
        secret: jwt,
        forbidden: ['next=', jwt],
      },
      {
        source: `https://example.com/a.png?sig2=${encodeURIComponent(sig2)}`,
        expected: 'https://example.com/a.png (+1 query parameter, redacted)',
        secret: sig2,
        forbidden: ['sig2', sig2],
      },
      {
        source: `https://example.com/a.png?GoogleAccessId=${encodeURIComponent(googleAccessId)}`,
        expected: 'https://example.com/a.png (+1 query parameter, redacted)',
        secret: googleAccessId,
        forbidden: ['GoogleAccessId', googleAccessId],
      },
    ];
    const registry = createAssetRegistry({
      load: () => Promise.reject(new Error('load failed')),
    });
    for (const [index, shape] of shapes.entries())
      registry.retain(image(shape.source, `asset-${index}`), `owner-${index}`, context);
    const result = await registry.whenReady({
      signal: new AbortController().signal,
      timeoutMs: 1000,
      location: { compositionId: 'demo', frame: 3, timeSeconds: 0.1 },
      generation: 1,
      committed: () => true,
    });
    expect(result.ok).toBe(false);
    if (result.ok || 'aborted' in result) throw new Error('expected diagnostics');
    expect(result.error).toHaveLength(shapes.length);
    for (const [index, shape] of shapes.entries()) {
      expect(result.error[index]).toMatchObject({
        code: 'asset.load-failed',
        details: {
          assets: [{ kind: 'image', phase: 'decode', source: shape.expected }],
        },
      });
    }
    const serialized = JSON.stringify(result);
    for (const shape of shapes) {
      expect(serialized).not.toContain(shape.secret);
      expect(serialized).not.toContain(encodeURIComponent(shape.secret));
      for (const forbidden of shape.forbidden) expect(serialized).not.toContain(forbidden);
      expect(redactAssetSource(shape.source)).toBe(shape.expected);
    }
    expect(redactAssetSource('https://example.com/a.png?v=1&w=2&scale=3')).toBe(
      'https://example.com/a.png (+3 query parameters, redacted)',
    );
    for (const diagnostic of result.error)
      expect(DiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
  });

  it('lists every pending registration and timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const registry = createAssetRegistry({ load: () => new Promise(() => {}) });
      registry.retain(image('/one.png', 'one'), 'a', context);
      registry.retain(font('/face.ttf'), 'b', context);
      const result = registry.whenReady({
        signal: new AbortController().signal,
        timeoutMs: 25,
        configuredTimeoutMs: 2500,
        location: { compositionId: 'demo', frame: 3, timeSeconds: 0.1 },
        generation: 1,
        committed: () => true,
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toMatchObject({
        ok: false,
        error: [
          {
            code: 'asset.not-ready',
            details: {
              timeoutMs: 2500,
              assets: [
                expect.objectContaining({ id: 'one', kind: 'image' }),
                expect.objectContaining({ id: 'face-400', kind: 'font' }),
              ],
            },
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a rejection that lands before the deadline as asset.load-failed', async () => {
    vi.useFakeTimers();
    try {
      const gate = Promise.withResolvers<string>();
      const registry = createAssetRegistry({ load: () => gate.promise });
      registry.retain(image('/broken.png', 'picture'), 'owner', context);
      const result = registry.whenReady({
        signal: new AbortController().signal,
        timeoutMs: 50,
        location: { compositionId: 'demo', frame: 1, timeSeconds: 0 },
        generation: 1,
        committed: () => true,
      });
      await vi.advanceTimersByTimeAsync(10);
      gate.reject(new Error('decode failed before deadline'));
      await vi.advanceTimersByTimeAsync(40);
      const settled = await result;
      expect(settled).toMatchObject({
        ok: false,
        error: [{ code: 'asset.load-failed' }],
      });
      if (settled.ok || !('error' in settled)) throw new Error('expected diagnostics');
      expect(settled.error[0]?.message).toContain('image');
      expect(settled.error.map((diagnostic) => diagnostic.code)).not.toContain('asset.not-ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers asset.load-failed when the deadline flag and a rejection are both visible', async () => {
    vi.useFakeTimers();
    try {
      const gate = Promise.withResolvers<string>();
      setTimeout(() => {
        gate.reject(new Error('decode failed as the deadline fired'));
      }, 30);
      const registry = createAssetRegistry({ load: () => gate.promise });
      registry.retain(image('/broken.png', 'picture'), 'owner', context);
      const result = registry.whenReady({
        signal: new AbortController().signal,
        timeoutMs: 30,
        location: { compositionId: 'demo', frame: 1, timeSeconds: 0 },
        generation: 1,
        committed: () => true,
      });
      await vi.advanceTimersByTimeAsync(0);
      vi.advanceTimersByTime(30);
      await Promise.resolve();
      await Promise.resolve();
      const settled = await result;
      expect(settled).toMatchObject({
        ok: false,
        error: [expect.objectContaining({ code: 'asset.load-failed' })],
      });
      if (settled.ok || !('error' in settled)) throw new Error('expected diagnostics');
      expect(settled.error.map((diagnostic) => diagnostic.code)).not.toContain('asset.not-ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports load-failed when a rejection and a still-pending registration coexist', async () => {
    vi.useFakeTimers();
    try {
      const pending = Promise.withResolvers<string>();
      const failed = Promise.withResolvers<string>();
      const registry = createAssetRegistry({
        load: (descriptor) => (descriptor.id === 'broken' ? failed.promise : pending.promise),
      });
      registry.retain(image('/broken.png', 'broken'), 'failed-owner', context);
      registry.retain(image('/slow.png', 'slow'), 'pending-owner', context);
      const result = registry.whenReady({
        signal: new AbortController().signal,
        timeoutMs: 30,
        location: { compositionId: 'demo', frame: 2, timeSeconds: 0 },
        generation: 1,
        committed: () => true,
      });
      await vi.advanceTimersByTimeAsync(5);
      failed.reject(new Error('decode failed'));
      await vi.advanceTimersByTimeAsync(30);
      const settled = await result;
      expect(settled.ok).toBe(false);
      if (settled.ok || !('error' in settled)) throw new Error('expected diagnostics');
      expect(settled.error.map((diagnostic) => diagnostic.code)).toContain('asset.load-failed');
      expect(settled.error.map((diagnostic) => diagnostic.code)).not.toContain('asset.not-ready');
      expect(JSON.stringify(settled.error)).toContain('broken');
      expect(registry.pending().map((asset) => asset.id)).toEqual(['slow']);
      expect(registry.snapshot().failed.map((asset) => asset.id)).toEqual(['broken']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps font and image load failures to asset.load-failed', async () => {
    const registry = createAssetRegistry({
      load: (descriptor) => Promise.reject(new Error(`raw ${descriptor.kind} s3cret`)),
    });
    registry.retain(image('/broken.png', 'picture'), 'image-owner', context);
    registry.retain(font('/broken.ttf'), 'font-owner', context);
    const result = await registry.whenReady({
      signal: new AbortController().signal,
      timeoutMs: 1000,
      location: { compositionId: 'demo', frame: 4, timeSeconds: 0.2 },
      generation: 2,
      committed: () => true,
    });
    expect(result.ok).toBe(false);
    if (result.ok || 'aborted' in result) throw new Error('expected diagnostics');
    expect(result.error.map((diagnostic) => diagnostic.code)).toEqual([
      'asset.load-failed',
      'asset.load-failed',
    ]);
    expect(result.error.map((diagnostic) => diagnostic.details)).toEqual([
      { assets: [expect.objectContaining({ kind: 'image', phase: 'decode', id: 'picture' })] },
      { assets: [expect.objectContaining({ kind: 'font', phase: 'load', id: 'face-400' })] },
    ]);
    expect(leaked(result)).toBe(false);
    expect(result.error[0]?.message).toBe('The required image failed to decode.');
    expect(result.error[1]?.message).toBe('The required font failed to load.');
  });

  it('keeps the barrier waiting when a registration appears during confirmation', async () => {
    const late = Promise.withResolvers<string>();
    let confirmations = 0;
    const registry = createAssetRegistry({
      load: (descriptor) => (descriptor.id === 'late' ? late.promise : Promise.resolve('ready')),
    });
    registry.retain(image('/first.png', 'first'), 'owner', context);
    let settled = false;
    const result = registry
      .whenReady({
        signal: new AbortController().signal,
        timeoutMs: 2000,
        location: { compositionId: 'demo', frame: 3, timeSeconds: 0.1 },
        generation: 1,
        committed: () => {
          confirmations += 1;
          if (confirmations === 1)
            queueMicrotask(() => {
              registry.retain(image('/late.png', 'late'), 'late-owner', context);
            });
          return true;
        },
      })
      .then((value) => {
        settled = true;
        return value;
      });
    await tick();
    expect(settled).toBe(false);
    expect(registry.pending().map((asset) => asset.id)).toEqual(['late']);
    late.resolve('done');
    await expect(result).resolves.toEqual({ ok: true, value: undefined });
  });

  it('does not treat an unregistered asset as ready or pending', async () => {
    const registry = createAssetRegistry({ load: () => new Promise(() => {}) });
    await expect(
      registry.whenReady({
        signal: new AbortController().signal,
        timeoutMs: 20,
        location: { compositionId: 'demo' },
        generation: 1,
        committed: () => true,
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(registry.snapshot()).toEqual({ pending: [], failed: [], ready: [] });
  });

  it('keeps settleFrame pending until the registered asset settles', async () => {
    const gate = Promise.withResolvers<string>();
    const definition = await prepared();
    const options = {
      definition,
      compositionRealm: 'page',
      instance: 'assets',
      assetLoader: () => gate.promise,
    };
    const runtime = createCompositionRuntime(options);
    const pending = runtime.settleFrame(0, { source: 'renderer', requestId: 'frame' });
    await tick();
    assetsOf(runtime).retain(image('/barrier.png', 'barrier'), 'scene', {
      compositionId: 'test',
      frame: 0,
      timeSeconds: 0,
      generation: 1,
    });
    runtime.acknowledgeContent('composition-root', 1, '1');
    await tick();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    expect(runtime.pendingAssets('frame')).toEqual([
      expect.objectContaining({
        id: 'barrier',
        kind: 'image',
        phase: 'decode',
        source: '/barrier.png',
      }),
    ]);
    gate.resolve('ready');
    await expect(pending).resolves.toMatchObject({ status: 'ready' });
    runtime.dispose();
  });
});

const prepared = async () => {
  const defined = defineCompositions([
    defineComposition({
      id: 'test',
      width: 32,
      height: 32,
      fps: { numerator: 30, denominator: 1 },
      durationInFrames: 2,
      schema: z.object({}),
      component: () => null,
    }),
  ]);
  if (!defined.ok) throw new Error(defined.error.message);
  const mounted = await defined.value.mount({ revision: 'r1' });
  if (!mounted.ok) throw new Error(mounted.error.message);
  return mounted.value;
};
