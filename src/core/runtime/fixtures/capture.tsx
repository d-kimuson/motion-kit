import { useLayoutEffect, useRef } from 'react';
import { z } from 'zod';

import { useCompositionRuntime } from '../../composition/composition.tsx';
import { defineComposition, defineCompositions } from '../../composition/registry.ts';
import { useFrame } from '../../timeline/hooks.ts';
import { type CompositionRuntime } from '../composition-runtime.ts';

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    __captureFixture?: CompositionRuntime;
    __captureFixtureChangeSource?: () => void;
  }
}

const schema = z.object({
  mode: z.enum(['normal', 'asset', 'failed', 'pending', 'uncontrolled']).default('normal'),
});
const Scene = ({ mode }: z.infer<typeof schema>) => {
  const frame = useFrame();
  const runtime = useCompositionRuntime();
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    window.__captureFixture = runtime;
    return () => {
      delete window.__captureFixture;
    };
  }, [runtime]);
  useLayoutEffect(
    () =>
      runtime.registerIntegration({
        id: 'fixture',
        version: '1',
        seekability: mode === 'uncontrolled' ? 'C' : 'B',
        pendingAssets: () =>
          mode === 'asset'
            ? [
                {
                  kind: 'image',
                  source: 'https://user:secret@example.com/image?token=secret',
                  phase: 'decode',
                },
              ]
            : [],
        settle: async () => {
          if (mode === 'asset' || mode === 'pending') await new Promise(() => {});
          if (mode === 'failed')
            return {
              ok: false,
              error: {
                code: 'asset.load-failed',
                severity: 'error',
                message: 'Fixture image decode failed.',
                hint: 'Replace the broken image.',
              },
            };
          return { ok: true, value: undefined };
        },
      }),
    [mode, runtime],
  );
  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context === undefined || context === null) throw new Error('Canvas unavailable');
    context.fillStyle = `rgb(0,0,${frame * 40})`;
    context.fillRect(0, 0, 32, 32);
  }, [frame]);
  return (
    <div style={{ position: 'relative', width: 64, height: 64 }}>
      <div
        style={{
          position: 'absolute',
          width: 32,
          height: 32,
          background: `rgb(${frame * 40},0,0)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 32,
          width: 32,
          height: 32,
          background: frame % 2 === 0 ? '#0000ff' : '#00ff00',
        }}
      />
      <svg width="32" height="32" style={{ position: 'absolute', top: 32 }}>
        <rect width="32" height="32" fill={`rgb(0,${frame * 40},0)`} />
      </svg>
      <canvas
        ref={canvas}
        width="32"
        height="32"
        style={{ position: 'absolute', left: 32, top: 32 }}
      />
    </div>
  );
};
export const compositions = defineCompositions(
  ['one', 'two'].map((id) =>
    defineComposition({
      id,
      component: Scene,
      schema,
      width: 64,
      height: 64,
      fps: { numerator: 30000, denominator: 1001 },
      durationInFrames: 6,
    }),
  ),
);
