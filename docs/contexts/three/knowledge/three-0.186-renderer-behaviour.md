# three 0.186 and R3F 9.8 behaviour the canvas depends on

Facts observed while qualifying advanced behaviour (TASK-185). They are library behaviour, not
decisions; the [qualification ADR](../adr/20261031-three-advanced-qualification.accepted.md) records
what was decided from them. Confirmed 2026-10-31 against `three@0.186.1`, `@react-three/fiber@9.8.2`
and `@types/three@0.186.0`, in the `three-dom` project (headless Chromium, SwiftShader) on macOS arm64.

## A shader program's link check runs at first use, not at compile time

`WebGLProgram.onFirstUse` holds the `debug.checkShaderErrors` block, and it is called from
`getUniforms()`/`getAttributes()` — that is, while the first frame that draws the material is
submitted. `renderer.compile()` only creates the program object; `compileAsync()` polls
`program.isReady()`, which reads `COMPLETION_STATUS_KHR` when `KHR_parallel_shader_compile` exists and
never inspects the link status. `renderer.debug.onShaderError` therefore fires during the render, and
assigning it disables three's own console report (`WebGLProgram.js`, `three/src/renderers/webgl/`).

Confirmed by: `src/three/canvas-failure.browser.test.tsx` (an invalid vertex shader fails the frame
without any `compileAsync` call) and by reading the 0.186 source.

## `PCFSoftShadowMap` was removed

`WebGLShadowMap` warns `PCFSoftShadowMap has been removed. Using PCFShadowMap instead.` and switches
its own type. R3F 9.8 maps a boolean `shadows` prop and the string `'soft'` to `PCFSoftShadowMap`, so
`<Canvas shadows>` still renders shadows but logs that warning once per renderer.
`shadows="percentage"` selects `PCFShadowMap` without it. Shadow maps re-render on every
`renderer.render` while `shadowMap.autoUpdate` stays `true` (the default), which is what a manual
advance needs.

Confirmed by: the `three-dom` console output and `src/three/shadows.browser.test.tsx`.

## An `AnimationMixer` action stops applying values at the end of its clip

`AnimationMixer.setTime(t)` sets the mixer time and every action's time to `0` and then calls
`update(t)`, which makes it absolute. But a `LoopOnce` action whose accumulated time reaches the clip
duration takes the `handle_stop` path in `AnimationAction._updateTime`, sets `enabled = false` (unless
`clampWhenFinished`), and `_updateWeight` then returns `0`, so that update accumulates no value at all
and the object keeps its previous pose. A clip whose duration ends inside the claimed frame range
therefore loses its last frames; keep the clip longer than the range or use `LoopRepeat`.

Confirmed by: a probe over frames 0–15 of a 1 s clip, and
`src/three/animation-mixer.browser.test.tsx`.

## A lost context is restored by Chromium on a later GL use

After `WEBGL_lose_context.loseContext()`, `isContextLost()` stays `true` across microtasks and
timers, `webglcontextlost` fires and `webglcontextrestored` does not (as observed), and the next
render's GL work makes the context usable again: a frame rendered after it returned pixels
byte-identical to before the loss for a simple scene. `renderer.forceContextLoss()` on an already
lost context logs `WEBGL_lose_context extension not supported`. Nothing re-uploads resources
explicitly, so recovery is not qualified.

Confirmed by: `src/three/canvas-failure.browser.test.tsx` and a probe that logged the event names,
`isContextLost()` after each step, and the pixel comparison.

## WebGPU is exposed but has no adapter here

`navigator.gpu` exists in the `three-dom` Chromium instance (launched with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), but
`await navigator.gpu.requestAdapter()` resolves to `null`, so no WebGPU device can be created. This is
evidence for the WebGPU exclusion, not a guarantee about other environments.

Confirmed by: a probe in the `three-dom` project.

## A priority `useFrame` subscriber suppresses the automatic render

`update()` renders the scene only when `!state.internal.priority`, and the priority is set by
`useFrame(callback, priority)` with a positive priority (the pattern controls use to take over the
render call). A canvas with such a subscriber therefore does not have its scene drawn by `advance()`
unless that callback renders it. `ThreeCanvas` does not compensate; the subscriber also makes the
canvas Tier C.

Confirmed by: reading `react-three-fiber`'s `loop` implementation, and
`src/three/r3f-contract.browser.test.tsx` for the parts the integration relies on.

## R3F still uses the deprecated `THREE.Clock`

Constructing a root logs `THREE.Clock: This module has been deprecated. Please use THREE.Timer
instead.` R3F 9.8 keeps it, and `frameloop="never"` still updates `clock.elapsedTime` from the
timestamp passed to `advance`. An R3F upgrade that migrates to `THREE.Timer` will change
`state.clock`; `src/three/r3f-contract.browser.test.tsx` fails if it changes the observed behaviour.

Confirmed by: the `three-dom` console output and the contract test.
