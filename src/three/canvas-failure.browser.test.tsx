import { useFrame } from '@kimuson/motion-kit';
import { DataTexture, RGBAFormat, Texture, UnsignedByteType } from 'three';
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
    expect(outcome.diagnostics[0].location).toEqual({
      compositionId: 'scene',
      frame: 0,
      timeSeconds: 0,
    });
    // three checks a program only on first use, so the canvas has to stay failed rather than
    // publish a frame that renders nothing, and each failure names the frame it fails.
    const later = await instance.settle(3);
    expect(later).toMatchObject({ status: 'failed' });
    if (later.status !== 'failed') return;
    expect(later.diagnostics[0].location).toEqual({
      compositionId: 'scene',
      frame: 3,
      timeSeconds: 0.1,
    });
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
    expect(outcome.diagnostics[0].hint).toContain('not qualified');
    expect(outcome.diagnostics[0].location).toEqual({
      compositionId: 'scene',
      frame: 1,
      timeSeconds: 1 / 30,
    });
    // Recovery is excluded (TASK-185): Chromium restores this context on a later GL use in this
    // environment, and no frame after the restore is qualified, so the test claims nothing about it.
  }, 60_000);
});

const withMap = (texture: Texture) => (
  <mesh>
    <boxGeometry args={[1, 1, 1]} />
    <meshBasicMaterial map={texture} />
  </mesh>
);

const checkerboard = (): DataTexture => {
  const texture = new DataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    2,
    2,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.name = 'checkerboard';
  texture.needsUpdate = true;
  return texture;
};

/** An image that finished loading and is a real PNG, the way a loaded texture arrives. */
const decodedImage = async (): Promise<HTMLImageElement> => {
  const image = new Image();
  image.src =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await image.decode();
  return image;
};

describe('texture upload failure', () => {
  const failedWith = async (texture: Texture) => {
    const instance = await open({ scene: (capture) => canvas(capture, withMap(texture)) });
    const outcome = await instance.settle(2);
    if (outcome.status !== 'failed') throw new Error('expected the frame to fail');
    return { instance, diagnostic: outcome.diagnostics[0] };
  };

  it('fails a frame whose texture has no image, naming the texture and the frame', async () => {
    const texture = new Texture();
    texture.name = 'logo';
    texture.needsUpdate = true;

    const { instance, diagnostic } = await failedWith(texture);

    expect(diagnostic).toMatchObject({
      code: 'render.page-error',
      severity: 'error',
      location: { compositionId: 'scene', frame: 2, timeSeconds: 2 / 30 },
      details: { textures: [{ texture: 'logo', slot: 'map', reason: 'no-image' }] },
    });
    expect(diagnostic.message).toContain('texture "logo" in map');
    // The texture stays unuploaded, so a later frame cannot publish the empty material either.
    expect(await instance.settle(5)).toMatchObject({ status: 'failed' });
  }, 60_000);

  it('fails a frame whose image was still loading when the texture was marked for update', async () => {
    const image = await decodedImage();
    Object.defineProperty(image, 'complete', { value: false });
    const texture = new Texture(image);
    texture.needsUpdate = true;

    const { diagnostic } = await failedWith(texture);

    expect(diagnostic).toMatchObject({
      details: { textures: [{ slot: 'map', reason: 'image-incomplete' }] },
    });
  }, 60_000);

  it('fails a frame whose image could not be decoded, which three uploads without a warning', async () => {
    const image = new Image();
    image.src = '/this-image-does-not-exist.png';
    await new Promise((resolve) => {
      image.onerror = resolve;
      image.onload = resolve;
    });
    const texture = new Texture(image);
    texture.name = 'broken';
    texture.needsUpdate = true;

    const { diagnostic } = await failedWith(texture);

    expect(diagnostic).toMatchObject({
      details: { textures: [{ texture: 'broken', reason: 'empty-image' }] },
    });
  }, 60_000);

  it('names a texture in a shader uniform', async () => {
    const texture = new Texture();
    texture.name = 'lookup';
    texture.needsUpdate = true;
    const instance = await open({
      scene: (capture) =>
        canvas(
          capture,
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <shaderMaterial
              uniforms={{ uLookup: { value: texture } }}
              vertexShader="void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
              fragmentShader="uniform sampler2D uLookup; void main() { gl_FragColor = texture2D(uLookup, vec2(0.5)); }"
            />
          </mesh>,
        ),
    });

    const outcome = await instance.settle(0);

    if (outcome.status !== 'failed') throw new Error('expected the frame to fail');
    expect(outcome.diagnostics[0]).toMatchObject({
      details: { textures: [{ texture: 'lookup', slot: 'uniforms.uLookup' }] },
    });
  }, 60_000);

  it('settles a texture that uploaded (negative control)', async () => {
    const instance = await open({
      scene: (capture) => canvas(capture, withMap(checkerboard())),
    });

    expect((await instance.settle(2)).status).toBe('ready');
    expect(differsFromAllZeros(pixelsOf(instance.capture))).toBe(true);
    expect(instance.runtime.warnings()).toEqual([]);
  }, 60_000);

  it('settles a texture made from a decoded image (negative control)', async () => {
    const texture = new Texture(await decodedImage());
    texture.needsUpdate = true;
    const instance = await open({ scene: (capture) => canvas(capture, withMap(texture)) });

    expect((await instance.settle(2)).status).toBe('ready');
  }, 60_000);
});

/** A texture three accepts without complaint: 1x1 RGBA. */
const validTexture = (name = 'valid'): DataTexture => {
  const texture = new DataTexture(
    new Uint8Array([255, 128, 0, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.name = name;
  texture.needsUpdate = true;
  return texture;
};

const basicVertex =
  'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

describe('texture upload without a draw that samples it', () => {
  // three uploads a texture only when a draw samples it. A valid texture nothing sampled must still
  // settle, whatever the reason nothing sampled it.
  const settles = async (scene: Parameters<typeof canvas>[1]) => {
    const instance = await open({ scene: (capture) => canvas(capture, scene) });
    expect((await instance.settle(0)).status).toBe('ready');
    expect((await instance.settle(3)).status).toBe('ready');
  };

  it('settles a valid texture on an object outside the camera frustum', async () => {
    await settles(
      <mesh position={[100, 0, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial map={validTexture()} />
      </mesh>,
    );
  }, 60_000);

  it('settles a valid texture on a material that is not visible', async () => {
    await settles(
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial map={validTexture()} visible={false} />
      </mesh>,
    );
  }, 60_000);

  it('settles a valid texture on an object in a layer the camera does not render', async () => {
    await settles(
      <mesh layers-mask={2}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial map={validTexture()} />
      </mesh>,
    );
  }, 60_000);

  it('settles a valid texture in a shader uniform the shader never reads', async () => {
    await settles(
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <shaderMaterial
          uniforms={{ uUnused: { value: validTexture() } }}
          vertexShader={basicVertex}
          fragmentShader="void main() { gl_FragColor = vec4(1.0); }"
        />
      </mesh>,
    );
  }, 60_000);

  it('still fails a broken texture on an object outside the camera frustum', async () => {
    const texture = new Texture();
    texture.name = 'offscreen-broken';
    texture.needsUpdate = true;
    const instance = await open({
      scene: (capture) =>
        canvas(
          capture,
          <mesh position={[100, 0, 0]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial map={texture} />
          </mesh>,
        ),
    });

    const outcome = await instance.settle(1);

    if (outcome.status !== 'failed') throw new Error('expected the frame to fail');
    expect(outcome.diagnostics[0]).toMatchObject({
      details: { textures: [{ texture: 'offscreen-broken', reason: 'no-image' }] },
    });
  }, 60_000);

  describe('the verdict of a frame does not depend on the frames settled before it', () => {
    /** On screen before frame 3, far outside the camera frustum from frame 3 on. */
    const LeavesTheScreen = ({ texture }: { texture: Texture }) => (
      <mesh position={[useFrame() < 3 ? 0 : 100, 0, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial map={texture} />
      </mesh>
    );
    const outcomeOffScreen = async (texture: Texture, drawnOnScreenFirst: boolean) => {
      const instance = await open({
        scene: (capture) => canvas(capture, <LeavesTheScreen texture={texture} />),
      });
      if (drawnOnScreenFirst) await instance.settle(0);
      return (await instance.settle(4)).status;
    };

    it('settles a valid texture the same whether it was drawn on screen first or not', async () => {
      expect(await outcomeOffScreen(validTexture('a'), true)).toBe('ready');
      expect(await outcomeOffScreen(validTexture('b'), false)).toBe('ready');
    }, 60_000);

    it('fails a broken texture the same whether it was drawn on screen first or not', async () => {
      const broken = (name: string) => {
        const texture = new Texture();
        texture.name = name;
        texture.needsUpdate = true;
        return texture;
      };
      expect(await outcomeOffScreen(broken('a'), true)).toBe('failed');
      expect(await outcomeOffScreen(broken('b'), false)).toBe('failed');
    }, 60_000);
  });
});
