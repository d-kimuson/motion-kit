# Advance an R3F canvas from motion-kit time and classify it by its `useFrame` subscribers

## Context

[Spike B](../knowledge/spike-b-seekability.md) reproduced camera, transform and shader-uniform seekability with `frameloop="never"` and a root-local `advance(seconds, false)`, plus `gl.finish()` and a preserved default framebuffer. The [accepted Phase 0 decision](../../../decisions/20261024-time-control-and-frame-capture.accepted.md) made that the controlled B path, defined the [readiness barrier contract](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#readiness-barrier-contract), and left the concrete `ThreeCanvas`/CameraRig capability API to R9. This ADR records that API; the spike code stays history and nothing under `spikes/` is imported.

The forces: motion-kit owns time, R3F owns expression; unknown components are never inferred Tier A or B; a canvas must advance only its own root; the renderer must not capture a canvas that has not committed or has not been measured; and the integration contract has to report a capability that is only knowable after mount.

## Decision

### Time source

Content inside a `ThreeCanvas` reads motion-kit time with the existing core hooks (`useTime`, `useSequence`, `useTimeline`, `useFrame`). R3F v9 bridges React context into its own reconciler (`its-fine`'s `useBridge`), so these hooks work inside `<Canvas>`; a browser test asserts it. The recommended authoring path is declarative: compute props and uniforms from `useTime()` (`<mesh rotation-y={t * 0.6} />`). motion-kit adds no time hook for three.

### `ThreeCanvas`

```ts
export type ThreeCanvasProps = Omit<CanvasProps, 'frameloop' | 'gl' | 'dpr'> & {
  gl?: Omit<WebGLRendererParameters, 'preserveDrawingBuffer' | 'canvas' | 'context'>;
  dpr?: number;
};
```

- Renders R3F `<Canvas frameloop="never" dpr={dpr ?? 1}>` with `gl={{ ...gl, preserveDrawingBuffer: true }}`, calls `renderer.setAnimationLoop(null)` after creation and chains the caller's `onCreated`. Every other `CanvasProps` field passes through: motion-kit does not restrict what three or R3F can express. A renderer factory is not accepted, and `preserveDrawingBuffer` is not configurable, because capture reads the default framebuffer (R2 has not validated an alternative).

  _Amended 2026-10-31 (TASK-184):_ a pre-made WebGL `context` is not accepted either, so `gl` omits `'context'` as well as `'preserveDrawingBuffer'` and `'canvas'`. Three renders into a supplied context's own canvas and its attributes are fixed when it is created, so the forced `preserveDrawingBuffer: true` would not reach that buffer and the capture could be blank without a Diagnostic. The omission is a type-level rule only: `ThreeCanvas` does not check `gl` at runtime, so plain JavaScript that passes a `context` bypasses it and reaches exactly that blank capture.

- Children are wrapped in the canvas's own `<Suspense fallback={null}>`, with a generation probe as the **last child inside that same boundary**. The probe reads `useCompositionFrame().generation` and reports it from `useLayoutEffect`, so it commits only after every sibling — including R3F `useLoader` assets — has resolved. A suspending child therefore keeps the boundary on its fallback and no generation is reported.
- Each mounted canvas registers one integration through `useCompositionRuntime().registerIntegration`, with the id `three-canvas:${useId()}`. That is the whole ownership model: a canvas advances its own root and never calls `runGlobalEffects`, never advances another canvas.
- `settle(snapshot, signal)` waits until the R3F root exists **and** has a non-zero measured size, then until the probe has reported `snapshot.generation`, then calls `state.advance(toSeconds(snapshot.presentationTime), false)` exactly once, then `gl.finish()`. A lost context returns a failed `Result` carrying `render.page-error`; recovery is TASK-185. Every wait is woken by the abort signal and resolves without a Diagnostic, because the runtime has already terminated that request and only reads the result of a live one. A stale generation never satisfies a wait.
- Unmounting unregisters the integration. R3F owns renderer disposal.

The frame budget that bounds a wait is the runtime's `frameTimeoutMs` (default 30 s), not a canvas timer. A canvas never resolves a readiness wait by itself.

### Seekability

`IntegrationRegistration['seekability']` is now `Seekability | (() => Seekability)` with `export type Seekability = 'A' | 'B' | 'C'`; `warnings()` evaluates a getter every time it is asked. A registration can therefore report the capability it discovers after mounting, which re-registering on every change would do worse (it bumps the resource revision and re-settles).

- A canvas whose R3F root has no `useFrame` subscriber (`state.internal.subscribers.length === 0`) is Tier B.
- Any subscriber makes the canvas Tier C and `warnings()` reports `seek.uncontrolled`. The frame still renders: Tier C is usable, it is just not certified deterministic.
- motion-kit's own components never register a `useFrame` callback, so `CameraRig` does not make a canvas Tier C.
- The classification itself is a pure function of the subscriber count, in `src/three/seekability.ts`, unit-tested separately from the React wiring.
- The count comes from R3F's typed but internal `RootState.internal.subscribers`. It is not a public R3F contract: an R3F upgrade must re-check it. TASK-185 already asks to recheck R3F clock and lifecycle semantics on upgrade; this is part of that.
- `warnings()` is read after settlement, when the root exists. A canvas that has not mounted yet reports B because it cannot have rendered anything, and no capture is published before settlement.

### `CameraRig`

```ts
export type Vector3Tuple = readonly [number, number, number];
export type CameraPose = Readonly<{
  position: Vector3Tuple;
  lookAt?: Vector3Tuple;
  up?: Vector3Tuple;
  fov?: number;
  zoom?: number;
}>;
export type CameraRigProps = { pose: (time: number) => CameraPose };
```

`CameraRig` applies `pose(useTime())` to R3F's default camera (`useThree((s) => s.camera)`) in `useLayoutEffect` on every committed snapshot: position, `up` (default `[0, 1, 0]`), `lookAt` (default `[0, 0, 0]`), then `fov`/`zoom` and `updateProjectionMatrix()`. It writes every field from the pose and reads no prior pose, and it never uses `useFrame`. That absolute overwrite is what makes it Tier B and is the reason it exists rather than being a rename of an R3F pattern: the spike's `sticky-camera` control is the failure it prevents.

_Amended 2026-10-31 (TASK-184):_ an omitted `fov` or `zoom` is written from the value the camera had at mount, captured once before the first pose is applied, so all five fields are written on every settled frame. The earlier sentence applied `fov`/`zoom` only "when the pose sets them", which left a later frame's projection in place and made the frame depend on the one rendered before it.

The pose is applied during React commit, before `advance()` renders, because the integration waits for the generation probe, which is the last layout effect of that commit.

### Package surface

`@kimuson/motion-kit/three` is a new subpath (`src/three/index.ts` → `dist/three.js`), exporting `ThreeCanvas`, `CameraRig` and their types. `three` and `@react-three/fiber` become optional `peerDependencies` (`^0.186.0`, `^9.8.0`) and stay devDependencies; the user installs them. Only `src/three` may import them (lint-enforced), no `drei` dependency is added, and the package root never pulls three into its browser graph (checked by `scripts/check-browser-graph.ts`).

The browser tests run in their own `three-dom` Vitest project, launched with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` so the pixels do not depend on the host GPU. The end-to-end determinism test runs in `frame-transport` with `softwareWebGL: true`, which the determinism suite now forwards from a Composition's description.

### Not in scope

Controls and damping, physics, `AnimationMixer`, feedback or temporal effects, shadow qualification, WebGPU, XR, asynchronous shader-compile errors, context recovery and a render-target GPU strategy are excluded here and recorded as TASK-185. This ADR also does not claim cross-GPU pixel equality, seekability for arbitrary R3F code, or that `gl.finish()` is the minimal barrier.

## Consequences

- A Three.js Composition is authored with the same time hooks as a DOM one, and the renderer captures it through the same frame pipeline. No three-specific transport, CLI flag or diagnostic code is added: a lost context reuses `render.page-error` and an uncontrolled canvas reuses `seek.uncontrolled`.
- An R3F canvas costs two extra waits per frame (root/size, generation), a `gl.finish()` and one `advance()`. Not using `useFrame` is now a documented authoring rule rather than a style preference, because it changes whether the Composition can be certified.
- Tier C is decided by the presence of any `useFrame` subscriber, so a Canvas that legitimately needs a post-render callback (`useFrame` with zero state) is still Tier C. That is deliberate: motion-kit cannot distinguish it from a delta integrator.
- The `seekability` getter keeps the registration stable, so R3F root readiness does not bump `resourceRevision` and does not force a re-settlement.
- `RootState.internal.subscribers` is the one place this integration depends on R3F internals. TASK-185 must re-check it together with the clock and lifecycle behavior on an R3F upgrade, and add a test if the shape changes.
- The `three-dom` project adds browser time to `pnpm test`: about 4 s for the canvas and camera tests and 13 s for the two determinism Compositions on macOS arm64 with SwiftShader. CI runs it as its own step, apart from the Composition DOM step.

## Alternatives

- **`frameloop="always"` (or `demand`) with the R3F clock:** the scene would progress on the browser clock and no Manual Advance would be involved; the spike's order comparisons would fail. Rejected as the seekable path.
- **Exposing the barrier choice (`finish` / readback / none) as a prop:** R2 has not measured a cheaper alternative, and a user-selectable barrier would let a Composition opt out of capture ownership. The conservative reference stays internal; the option reopens when R2 produces evidence.
- **Thin wrappers over drei cameras (`OrbitControls`, `CameraControls`):** they interpolate from a prior pose and run their own damping loop, which is Tier C by construction. `CameraRig` exists precisely to own an absolute pose; a wrapper would rename an API and hide the tier.
- **Re-registering the integration when the subscriber count changes:** it bumps `resourceRevision`, invalidates acknowledgements and forces a re-settlement mid-frame, and the subscriber count is only stable after all children mount. A getter is evaluated at warning time and costs nothing.
- **Classifying an arbitrary `useFrame` canvas as seekable because the root advances manually:** the accepted ADR forbids it; the negative controls show a canvas can advance and still be history-dependent.
- **Waiting for one request animation frame instead of a committed generation probe:** a presentation opportunity is not a commit, and it does not tell a stale generation from a current one.
