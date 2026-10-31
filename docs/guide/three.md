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
import { CameraRig, ThreeCanvas, type CameraPose } from '@kimuson/motion-kit/three';

const orbit = (seconds: number): CameraPose => ({
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
      <meshBasicMaterial color="#2f6df6" />
    </mesh>
  );
};
```

- `CameraRig` takes only `pose`, a function of the local seconds reported by `useTime()`. It writes
  position, `up` and `lookAt`, then `fov`/`zoom`, on every frame; an omitted `fov` or `zoom` is the
  value the camera had at mount, never the one the previous frame wrote. A seek backwards therefore
  lands on exactly the pose that frame asks for.
- Every animated value must be computed from a hook, exactly as in the DOM. `useTime()`,
  `useSequence()` and `useTimeline()` work inside `<Canvas>`; they read the same context the rest of
  the tree reads.
- A shader uniform is set the same way: `uniforms.uTime.value = time` from the render body (or
  `<shaderMaterial uniforms={{ uTime: { value: time } }} />`).

## What determinism requires

`ThreeCanvas` opens the canvas with `frameloop="never"`, a stopped R3F clock, `dpr` 1 and
`preserveDrawingBuffer: true`, then advances the root once per settled frame and waits for the GPU
before the capture. It accepts neither a renderer factory nor a pre-made WebGL context: either would
fix the drawing buffer's attributes before motion-kit can force `preserveDrawingBuffer`. That rule is
type-level only: `ThreeCanvasProps['gl']` takes the parameters object rather than a factory and omits
`context`, and nothing checks either at runtime, so plain JavaScript that passes a `context` still
gets a blank capture instead of an error. Two rules keep that guarantee:

- **Derive, do not integrate.** A value written from `useTime()` is a pure function of the frame. A
  value that adds a delta, eases towards a previous value, or reads a wall clock is history, and
  seeking cannot reconstruct history.
- **Do not subscribe R3F's `useFrame` in a canvas you want certified.** Any `useFrame` subscriber
  (from `@react-three/fiber`; motion-kit's own `useFrame()` returns the output frame index and is
  unrelated) makes the
  canvas **Tier C**: it still renders, but the render reports the `seek.uncontrolled` warning and the
  determinism suite refuses to certify it. motion-kit cannot tell a harmless callback from a
  delta-integrating one, so it does not guess. `CameraRig` never subscribes.

Assets loaded through R3F (`useLoader`) are covered by the canvas's own `Suspense` boundary: the
frame is not captured until the scene has committed, so a texture cannot be captured half-loaded.

## What is qualified, and what is not

A frame the renderer can reproduce from its time alone is **Tier B**: rendering it first, last, or
again gives the same bytes. Anything history-dependent is **Tier C**: it still renders, but the
render reports the `seek.uncontrolled` warning and the determinism suite refuses to certify it. The
table below is the author-facing summary; the [qualification
ADR](../contexts/three/adr/20261031-three-advanced-qualification.accepted.md) has the test behind
each row.

| You want…                              | Write                                                                             | Tier       |
| -------------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| transforms, materials, shader uniforms | compute the value from `useTime()`                                                | B          |
| a camera, including an orbit or a push | `CameraRig` with a `pose` function of time                                        | B          |
| a keyframe clip                        | `mixer.setTime(t)` from `useTime()` in a `useLayoutEffect`                        | B          |
| shadows                                | `shadows` on the canvas, `castShadow` on a light, `receiveShadow` on the receiver | B          |
| several canvases                       | one `<ThreeCanvas>` per root; each advances only its own                          | B per root |

```tsx
import { useTime } from '@kimuson/motion-kit';
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo } from 'react';
import { AnimationClip, AnimationMixer, NumberKeyframeTrack } from 'three';

// The clip is a module constant, so the effect below does not depend on it.
const clip = new AnimationClip('travel', 1, [
  new NumberKeyframeTrack('mover.position[x]', [0, 0.2, 0.4], [-1.2, 0, 1.2]),
]);

const Clip = () => {
  const time = useTime();
  const scene = useThree((state) => state.scene);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  useLayoutEffect(() => {
    mixer.clipAction(clip).play();
    mixer.setTime(time);
  }, [mixer, time]);

  return (
    <mesh name="mover">
      <boxGeometry args={[0.8, 0.8, 0.8]} />
      <meshBasicMaterial color="#f6a02f" />
    </mesh>
  );
};
```

`mixer.setTime(t)` is absolute: it resets the clip to `t` instead of adding a delta, so a seek lands
on the frame's own pose. Keep the clip at least as long as your frame range — three disables a
`LoopOnce` action when it reaches the clip's end, and that update applies no value at all.

Shadows need the shadow map's default `autoUpdate`: every advance re-renders it. On three 0.186
R3F's boolean `shadows` selects a shadow-map type three has removed, so it warns once and falls back
to PCF; `shadows="percentage"` picks the same algorithm without the warning.

### Excluded

These render, but they are Tier C or unsupported, so do not claim determinism for them.

| Instead of…                                                                                      | Why it is excluded                                                          | Use                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------- |
| `OrbitControls`, `CameraControls`, any damped camera                                             | damping interpolates from the previous pose, so a seek lands elsewhere      | `CameraRig`, with the easing inside `pose`   |
| a physics engine                                                                                 | stepping is history-dependent; a seek would re-simulate from frame 0        | a function of time, or bake the motion       |
| feedback and temporal effects (ping-pong targets, accumulation, motion blur from earlier frames) | the written value comes from a previous frame                               | write the effect from time only              |
| `Math.random()` in a shader, or in a uniform written per frame                                   | an unseeded random draws a new value on every render                        | derive the value from `useTime()`            |
| `AnimationMixer.update(delta)` in R3F `useFrame`                                                 | the mixer integrates the delta, so its state is not a function of the frame | `mixer.setTime(t)`                           |
| `WebGPURenderer`                                                                                 | a canvas takes renderer parameters, not a renderer factory                  | WebGL, which is also what the capture fences |
| WebXR                                                                                            | no presentation clock motion-kit controls                                   | —                                            |
| recovering a lost WebGL context                                                                  | no restored frame is qualified                                              | restart the render                           |
| a texture upload that fails (a corrupt image, a decode error)                                    | three reports an upload failure nowhere a canvas can observe                | fix the source; nothing fails the frame      |

## Failures that are reported rather than published

A frame is never captured when the canvas could not draw it and three reports the failure:

- A shader program that does not compile or link fails the frame with `render.page-error` instead of
  publishing a scene with the material missing, and every later frame fails with it. The Diagnostic
  message is generic: the page console gets a reprint of the program and shader info logs, without
  the material name, so it does not say which of several shader materials failed.
- A lost WebGL context fails the frame the same way, with `render.page-error`.

A texture upload that fails is the gap in that rule: three reports it nowhere a canvas can observe,
so the frame is not guaranteed to fail and the case is excluded rather than claimed (see the
[qualification ADR](../contexts/three/adr/20261031-three-advanced-qualification.accepted.md)).

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

## Related

- [Authoring](authoring.md) — the time hooks, `Sequence` and `useAsset`.
- [Determinism](determinism.md) — what a pure function of time guarantees, and the warning that marks
  a canvas as uncontrolled.
