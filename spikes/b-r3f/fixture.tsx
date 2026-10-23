import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Group, NoToneMapping, ShaderMaterial } from 'three';

export type Fault =
  | 'none'
  | 'integrated-rotation'
  | 'integrated-uniform'
  | 'sticky-camera'
  | 'skip-advance';
export type Barrier = 'finish' | 'readback' | 'raf' | 'none';
export const width = 320;
export const height = 240;

// A compositor opportunity, never a source of animation time.
export const nextRaf = (): Promise<void> =>
  new Promise((resolve) => {
    // eslint-disable-next-line no-restricted-globals -- Explicit synchronization experiment, not timeline progression.
    requestAnimationFrame(() => resolve());
  });

const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const fragmentShader = `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    float stripe = 0.5 + 0.5 * sin(vPosition.y * 30.0 + uTime * 4.0);
    float light = 0.3 + 0.7 * max(dot(normalize(vNormal), normalize(vec3(1., 2., 3.))), 0.0);
    gl_FragColor = vec4(mix(vec3(0.1, 0.25, 0.9), vec3(1., 0.4, 0.1), stripe) * light, 1.);
  }
`;

export const mountFixture = async (fault: Fault = 'none', preserveDrawingBuffer = true) => {
  const host = document.createElement('div');
  Object.assign(host.style, { width: `${width}px`, height: `${height}px`, position: 'relative' });
  document.body.append(host);
  const root = createRoot(host);
  const group = new Group();
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uTime: { value: 0 } },
  });
  const uniform = material.uniforms['uTime'];
  if (uniform === undefined) throw new Error('Missing time uniform');
  let calls = 0;
  let lastDelta = 0;
  let requestedTime = 0;
  let maximumTime = -Infinity;
  let acknowledge: (state: RootState) => void = () => {
    throw new Error('Readiness not installed');
  };
  const ready = new Promise<RootState>((resolve) => {
    acknowledge = resolve;
  });
  const Scene = () => {
    const state = useThree();
    useLayoutEffect(() => {
      acknowledge(state);
    }, [state]);
    useFrame(({ camera, clock }, delta) => {
      calls++;
      lastDelta = delta;
      // In frameloop=never advance's timestamp is assigned directly to elapsedTime.
      const time = clock.elapsedTime;
      group.rotation.y =
        fault === 'integrated-rotation' ? group.rotation.y + Math.abs(delta) * 0.6 : time * 0.6;
      group.rotation.x = Math.sin(time) * 0.2;
      group.position.y = Math.sin(time * 2) * 0.15;
      uniform.value =
        fault === 'integrated-uniform' ? Number(uniform.value) + Math.abs(delta) : time;
      if (fault !== 'sticky-camera' || time > maximumTime) {
        camera.position.set(
          Math.sin(time * 0.7) * 1.4,
          1 + Math.cos(time) * 0.4,
          5 + Math.sin(time) * 0.5,
        );
        camera.lookAt(0, 0, 0);
      }
      maximumTime = Math.max(maximumTime, time);
    });
    return (
      <primitive object={group}>
        {Array.from({ length: 64 }, (_, index) => (
          <mesh
            key={index}
            position={[
              ((index % 8) - 3.5) * 0.42,
              (Math.floor(index / 8) - 3.5) * 0.42,
              Math.sin(index) * 0.25,
            ]}
            material={material}
          >
            <sphereGeometry args={[0.18, 32, 16]} />
          </mesh>
        ))}
      </primitive>
    );
  };
  // Fail before mounting instead of letting Canvas's error boundary swallow missing WebGL.
  const probe = document.createElement('canvas');
  const probeGl = probe.getContext('webgl2');
  if (probeGl === null) {
    host.remove();
    throw new Error('WebGL2 unavailable');
  }
  probeGl.getExtension('WEBGL_lose_context')?.loseContext();
  flushSync(() =>
    root.render(
      <Canvas
        frameloop="never"
        dpr={1}
        camera={{ fov: 45, near: 0.1, far: 100 }}
        gl={{ antialias: false, alpha: false, preserveDrawingBuffer, toneMapping: NoToneMapping }}
      >
        <color attach="background" args={['#102030']} />
        <Scene />
      </Canvas>,
    ),
  );
  const state = await ready;
  const renderer = state.gl;
  renderer.setAnimationLoop(null);
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const environment = {
    userAgent: navigator.userAgent,
    renderer: String(
      debug === null
        ? gl.getParameter(gl.RENDERER)
        : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
    ),
    version: String(gl.getParameter(gl.VERSION)),
    attributes: gl.getContextAttributes(),
  };
  const inspect = () => ({
    time: requestedTime,
    elapsed: state.clock.elapsedTime,
    camera: state.camera.position.toArray(),
    quaternion: state.camera.quaternion.toArray(),
    rotation: group.rotation.toArray(),
    position: group.position.toArray(),
    uniform: Number(uniform.value),
  });
  const pixels = () => {
    const bytes = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL readPixels failed');
    return bytes;
  };
  return {
    host,
    canvas,
    environment,
    inspect,
    pixels,
    stats: () => ({
      calls,
      lastDelta,
      triangles: renderer.info.render.triangles,
      drawCalls: renderer.info.render.calls,
      frameloop: state.frameloop,
      clockRunning: state.clock.running,
    }),
    dom: () => host.outerHTML,
    seek: async (time: number, barrier: Barrier = 'finish') => {
      requestedTime = time;
      // Deliberately drop a reverse seek in this negative control.
      if (fault !== 'skip-advance' || calls === 0 || time >= state.clock.elapsedTime)
        state.advance(time, false);
      if (barrier === 'finish') gl.finish();
      else if (barrier === 'readback') pixels();
      else if (barrier === 'raf') await nextRaf();
      host.dataset['state'] = JSON.stringify(inspect());
      if (gl.isContextLost()) throw new Error('WebGL context lost');
      return inspect();
    },
    dispose: () => {
      flushSync(() => root.unmount());
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      host.remove();
    },
  };
};
