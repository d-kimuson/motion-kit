# Three.js

A Composition can draw with Three.js through React Three Fiber. `ThreeCanvas` drives the R3F frame
loop from motion-kit time instead of the browser clock, so a 3D scene is seekable like any other
frame: seeking frame 90 gives the same pixels whether it is the first frame the renderer captures or
the last. `CameraRig` gives the camera an absolute pose derived from time.

`/three` is a separate subpath because Three.js is large and most Compositions do not need it.

## Install the peer dependencies

`three` and `@react-three/fiber` are **optional peer dependencies**: the package does not install
them, and a Composition that never imports `/three` never loads them.

```bash
pnpm add three @react-three/fiber
```

The supported range matches the version this repository tests (three `^0.186.0`, R3F `^9.8.0`) and
React 19. Nothing else is required — in particular `@react-three/drei` is not a dependency, and
motion-kit does not wrap or restrict it.

## A first scene

`ThreeCanvas` sizes itself to its parent, so give it a box: in a Composition that is usually a
full-size wrapper.

```tsx
import { useTime } from '@kimuson/motion-kit';
import { CameraRig, ThreeCanvas } from '@kimuson/motion-kit/three';

const orbit = (seconds: number) => ({
  position: [Math.sin(seconds) * 3, 1, Math.cos(seconds) * 3],
  lookAt: [0, 0, 0],
  fov: 45,
});
```

```tsx
// inside the Composition's component
<div style={{ position: 'relative', width: '100%', height: '100%' }}>
  <ThreeCanvas>
    <color attach="background" args={['#0b1020']} />
    <CameraRig pose={orbit} />
    <Spinner />
  </ThreeCanvas>
</div>
```

```tsx
const Spinner = () => {
  const time = useTime();
  return (
    <mesh rotation={[0, time * 0.6, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#2f6df6" />
    </mesh>
  );
};
```

- `CameraRig` takes only `pose`, a function of the local seconds reported by `useTime()`. It writes
  position, `up`, `lookAt` and (when present) `fov`/`zoom` on every frame, so a seek backwards lands
  on exactly the pose that frame asks for.
- Every animated value must be computed from a hook, exactly as in the DOM. `useTime()`,
  `useSequence()` and `useTimeline()` work inside `<Canvas>`; they read the same context the rest of
  the tree reads.
- A shader uniform is set the same way: `uniforms.uTime.value = time` from the render body (or
  `<shaderMaterial uniforms={{ uTime: { value: time } }} />`).

## What determinism requires

`ThreeCanvas` opens the canvas with `frameloop="never"`, a stopped R3F clock, `dpr` 1 and
`preserveDrawingBuffer: true`, then advances the root once per settled frame and waits for the GPU
before the capture. Two rules keep that guarantee:

- **Derive, do not integrate.** A value written from `useTime()` is a pure function of the frame. A
  value that adds a delta, eases towards a previous value, or reads a wall clock is history, and
  seeking cannot reconstruct history.
- **Do not use `useFrame` in a canvas you want certified.** Any `useFrame` subscriber makes the
  canvas **Tier C**: it still renders, but the render reports the `seek.uncontrolled` warning and the
  determinism suite refuses to certify it. motion-kit cannot tell a harmless callback from a
  delta-integrating one, so it does not guess. `CameraRig` never subscribes.

Assets loaded through R3F (`useLoader`) are covered by the canvas's own `Suspense` boundary: the
frame is not captured until the scene has committed, so a texture cannot be captured half-loaded.

## Software rendering

CI runners and containers often have no GPU. Chromium then needs to be told to rasterise WebGL in
software; pass `--software-webgl` (or `softwareWebGL: true` to `createRenderer`):

```bash
motion-kit render entry.tsx --out out.mp4 --software-webgl
```

Without it Chromium may fall back on its own, and the warning it prints says that the fallback is
deprecated. With it the render is reproducible on a machine without a GPU. One environment's pixels
are not compared against another's: a GPU machine may rasterise the same scene differently, so treat
cross-device byte equality as unproven, exactly as [determinism](determinism.md) says for DOM output.

## Not covered yet

Controls with damping (`OrbitControls`, `CameraControls`), physics, `AnimationMixer`, feedback or
temporal postprocessing, shadow qualification, WebGPU, XR, asynchronous shader-compile errors, a
render-target capture strategy and context-loss recovery are not part of this integration. A scene
that needs one of them still renders, but its `useFrame` callback makes the canvas Tier C, and a lost
WebGL context fails the frame as `render.page-error`.

## Related

- [Authoring](authoring.md) — the time hooks, `Sequence` and `useAsset`.
- [Determinism](determinism.md) — what a pure function of time guarantees, and the warning that marks
  a canvas as uncontrolled.
