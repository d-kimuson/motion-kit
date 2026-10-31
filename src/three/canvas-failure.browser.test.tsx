import { afterEach, describe, expect, it } from 'vitest';

import { differsFromAllZeros, mount, pixelsOf, type Mounted } from './fixtures/harness.tsx';
import { ThreeCanvas } from './three-canvas.tsx';

const gl = { antialias: false } as const;

const mounted: Mounted[] = [];
afterEach(() => {
  for (const instance of mounted.splice(0)) instance.dispose();
  document.body.replaceChildren();
});

const open = async (options: Parameters<typeof mount>[0]): Promise<Mounted> => {
  const instance = await mount(options);
  mounted.push(instance);
  return instance;
};

const canvas = (
  capture: { state: Mounted['capture']['state'] },
  children: Parameters<typeof ThreeCanvas>[0]['children'],
) => (
  <ThreeCanvas
    gl={gl}
    onCreated={(state) => {
      capture.state = state;
    }}
  >
    {children}
  </ThreeCanvas>
);

const Solid = () => (
  <mesh>
    <boxGeometry args={[1, 1, 1]} />
    <meshBasicMaterial color="#2f6df6" />
  </mesh>
);

describe('canvas failure', () => {
  it('fails the frame instead of publishing it when a shader program does not compile', async () => {
    const instance = await open({
      scene: (capture) =>
        canvas(
          capture,
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <shaderMaterial
              vertexShader="void main() { gl_Position = notAThing; }"
              fragmentShader="void main() { gl_FragColor = vec4(1.0); }"
            />
          </mesh>,
        ),
    });

    const outcome = await instance.settle(0);
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status !== 'failed') return;
    expect(outcome.diagnostics[0]).toMatchObject({ code: 'render.page-error', severity: 'error' });
    expect(outcome.diagnostics[0].message).toContain('shader program');
    // three checks a program only on first use, so the canvas has to stay failed rather than
    // publish a frame that renders nothing.
    expect(await instance.settle(1)).toMatchObject({ status: 'failed' });
  }, 60_000);

  it('settles a canvas whose custom shader compiles', async () => {
    const instance = await open({
      scene: (capture) =>
        canvas(
          capture,
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <shaderMaterial
              vertexShader={
                'varying vec3 vNormal; void main() { vNormal = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
              }
              fragmentShader={
                'varying vec3 vNormal; void main() { gl_FragColor = vec4(vNormal, 1.0); }'
              }
            />
          </mesh>,
        ),
    });

    expect((await instance.settle(0)).status).toBe('ready');
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
    expect(instance.runtime.warnings()).toEqual([]);
  }, 60_000);

  it('fails the frame during which the WebGL context was lost', async () => {
    const instance = await open({ scene: (capture) => canvas(capture, <Solid />) });
    expect((await instance.settle(0)).status).toBe('ready');
    const context = instance.capture.state?.gl.getContext();
    const extension = context?.getExtension('WEBGL_lose_context');
    if (extension === null || extension === undefined)
      throw new Error('WEBGL_lose_context missing');
    extension.loseContext();
    expect(context?.isContextLost()).toBe(true);

    const outcome = await instance.settle(1);
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status !== 'failed') return;
    expect(outcome.diagnostics[0]).toMatchObject({ code: 'render.page-error', severity: 'error' });
    expect(outcome.diagnostics[0].message).toContain('context was lost');
    expect(outcome.diagnostics[0].hint).toContain('recovery is not implemented');
    // Recovery is excluded (TASK-185): Chromium restores this context on a later GL use in this
    // environment, and no frame after the restore is qualified, so the test claims nothing about it.
  }, 60_000);
});
