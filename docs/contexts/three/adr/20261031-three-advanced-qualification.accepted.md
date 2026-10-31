# Qualify advanced three and GPU behaviour feature by feature, and fail a frame whose shader program does not link

## Context

The [capability ADR](20261031-three-canvas-capability-api.accepted.md) shipped `ThreeCanvas` and `CameraRig` and left R10 of the [accepted time-control decision](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#r10--qualify-advanced-three-and-gpu-behavior) to TASK-185: controls and damping, physics, `AnimationMixer`, stochastic and feedback shaders, temporal postprocessing, shadows, WebGPU and XR, asynchronous shader compile and upload errors, multiple canvases, asynchrony from React and StrictMode, and context loss after readiness. Its "Not in scope" named exactly those.

The forces are the tier definitions, not taste. A claim is either **Qualified** — a test in the `three-dom` project proves it, byte-identical pixels across sequential, shuffled/repeated and fresh-mount frame orders for B, a `seek.uncontrolled` warning for C, a specific Diagnostic for a failure — or **Excluded**, with the reason and what an author should do instead. "Probably works" is not a tier. The `three-dom` project is headless Chromium on SwiftShader inside one pinned environment, so every claim below is same-environment byte equality, never cross-GPU equality ([R14](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#r14--measure-broader-rendering-portability-and-cost) stays open). The library facts every row relies on are collected in [three 0.186 and R3F 9.8 behaviour](../knowledge/three-0.186-renderer-behaviour.md).

## Decision

### Tier table

| Item                        | Outcome                                                                                                                                               | Evidence (`src/three`)                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AnimationMixer`            | **Qualified Tier B** when driven absolutely: `mixer.setTime(t)` with `t = useTime()` in a `useLayoutEffect`, which runs before the frame's advance.   | `animation-mixer.browser.test.tsx`: order-independent pixels, and the clip value each frame asks for.              |
| `AnimationMixer`            | **Excluded / Tier C** for `mixer.update(delta)` in `useFrame`: the mixer integrates whatever R3F hands the callback, so motion-kit cannot certify it. | `animation-mixer.browser.test.tsx`: `seek.uncontrolled`.                                                           |
| Shadows                     | **Qualified Tier B** with `shadows` on the canvas, a `castShadow` directional light and a `receiveShadow` plane; SwiftShader path included.           | `shadows.browser.test.tsx`: order-independent pixels, and a shadow region that a light without `castShadow` lacks. |
| Multiple canvases           | **Qualified**: one Tier B and one Tier C canvas in one Composition report exactly one `seek.uncontrolled`, and the B canvas stays byte-identical.     | `three-canvas.browser.test.tsx`: "reports one seek.uncontrolled when a Tier C canvas sits beside a Tier B canvas". |
| Shader compile/link failure | **Qualified as a failure**: a program that does not compile fails the frame with `render.page-error` instead of publishing a silently wrong frame.    | `canvas-failure.browser.test.tsx` and `settlement.test.ts`.                                                        |
| Context loss                | **Qualified as a failure**: `WEBGL_lose_context.loseContext()` fails the frame that settles while the context is lost.                                | `canvas-failure.browser.test.tsx`: "fails the frame during which the WebGL context was lost".                      |
| Context recovery            | **Excluded**: no frame after a restored context is qualified.                                                                                         | —                                                                                                                  |
| Controls and damping        | **Excluded / Tier C**: a damped control interpolates from the previous pose, so a seek lands on a different pose. Author with `CameraRig`.            | `camera-damping.browser.test.tsx`: `seek.uncontrolled` and a different pose when the frame is sought first.        |
| Physics                     | **Excluded / Tier C**: a stepping engine is history-dependent; replay would need re-simulation from frame 0.                                          | —                                                                                                                  |
| Feedback / temporal effects | **Excluded / Tier C** unless every value the effect writes is a pure function of time.                                                                | —                                                                                                                  |
| WebGPU                      | **Excluded**: `ThreeCanvas` takes renderer parameters, not a renderer factory, and the capture barrier is WebGL-specific.                             | Observed: `navigator.gpu` exists in the `three-dom` Chromium but `requestAdapter()` resolves to `null`.            |
| XR                          | **Excluded**: no presentation clock motion-kit controls.                                                                                              | —                                                                                                                  |
| R3F clock and internals     | **Qualified as a contract test**: the advance, `frameloop`, subscriber-count and delta behaviour the integration reads.                               | `r3f-contract.browser.test.tsx`.                                                                                   |

### Shader programs

`ThreeCanvas` assigns `renderer.debug.onShaderError` after creation. The callback reprints what three's default report prints and latches a failure in the canvas settlement; `settle` advances, fences with `gl.finish()`, and then returns a failed `Result` carrying `render.page-error`:

- The code is **reused, not added**. The failure is a page-level three error that a host cannot repair by configuration, and the agent-facing distinction is already carried by the message ("A shader program failed to compile or link while settling the frame.") and the hint ("Fix the shader material; a program that does not link renders nothing, so the frame cannot be captured."). Adding a code would grow the `DiagnosticSchema` enum, its JSON Schema and two guide tables to separate a failure the CLI cannot handle differently.
- The latch is **sticky**: three checks a program inside `WebGLProgram.onFirstUse`, which runs on `getUniforms()`/`getAttributes()` during the first render of the material and never again. A failure forgotten after its frame would let every later frame publish a scene the program does not draw.
- `KHR_parallel_shader_compile` and `compileAsync()` change nothing here: the link check does not run in `compile()`, only at first use, and rendering locks on the program anyway. No `compileAsync()` call is added, and `gl.finish()` remains the fence.
- `debug.checkShaderErrors` must stay at its default `true`; three performs no check at all when it is disabled. `ThreeCanvas` owns `debug.onShaderError` for the same reason it owns `preserveDrawingBuffer`, and because `onCreated` runs after the assignment, a caller who assigns the callback afterwards takes the detection away deliberately.

### Context loss and recovery

A lost context is detected after the fence (`gl.isContextLost()`), so the frame fails with `render.page-error` rather than capturing whatever the lost context left behind. Recovery stays excluded, and a recovery would need, at least: three to re-initialize its `WebGLState` and extensions (`webglcontextrestored`), every geometry, texture, render target and program re-uploaded or recompiled, shadow maps and post-processing chains rebuilt, the frame generation re-settled inside the same deadline, and a test proving the restored frame byte-equals the frame a fresh context renders. Chromium restores a lost context by itself in this environment on a later GL use, and a simple scene then rendered bytes identical to before, which is exactly why a claim needs the whole list rather than one observation.

### Upgrades

`r3f-contract.browser.test.tsx` fails on an R3F upgrade that changes any of: `state.advance(timestamp, false)` renders exactly once and only that root, `frameloop="never"` never renders on its own, the module-level `advance(timestamp, true)` is what flushes global effects and every root (which a canvas must never use), `state.internal.subscribers` is an array whose length counts `useFrame` subscribers, and `useFrame` receives the timestamp delta. R3F 9.8.2 also still constructs the deprecated `THREE.Clock`, which is why `clock.elapsedTime` is pinned rather than treated as an implementation detail.

## Consequences

- `pnpm test` runs `three-dom` in about 5 s on macOS arm64 with SwiftShader (24 browser tests in 7 files); the cheap half of the failure claims runs in the `unit` project against `createCanvasSettlement`, without a renderer.
- A shader that does not link now fails a render that previously produced a frame with the material missing. That is a behaviour change for a Composition with a broken shader, and it is recorded in the CHANGELOG.
- Shadows rely on `shadowMap.autoUpdate` staying at its default `true`: the map is rendered on every `advance`, which is correct for absolute time and costs one shadow pass per frame.
- On three 0.186, R3F's boolean `shadows` maps to the removed `PCFSoftShadowMap`; three warns once and falls back to `PCFShadowMap`, so the shadow tests use `shadows` and still pass, and `shadows="percentage"` is the warning-free spelling.
- `AnimationMixer` is qualified only inside the clip: a `LoopOnce` action that reaches its clip duration is disabled by three, so that update applies no value and the previous pose survives. Keep the clip at least as long as the claimed frame range, or use `LoopRepeat`, and do not claim the frame at the clip's end.
- Nothing here qualifies asynchrony from React `StrictMode` (double-invoked effects and double-mounted canvases), which R10 lists and TASK-185 does not cover. It stays open.
- The Diagnostic for a shader failure carries no `location`, matching the lost-context Diagnostic TASK-184 shipped. Supplying `compositionId`/`frame` needs the runtime's identity threaded into the settlement.

## Alternatives

- **A dedicated `render.shader-error` code:** clearer to grep, but it is the same page-level failure for every host, and the code set is a public contract with a generated JSON Schema and guide tables. Revisit when a host has to branch on it.
- **Letting three log and continue:** that is the defect this task closes: three logs `THREE.WebGLProgram: Shader Error` to the page console, which the renderer never forwards, and draws the scene without the material.
- **Calling `renderer.compileAsync()` before each advance to surface errors earlier:** it waits for `KHR_parallel_shader_compile` readiness but does not run the link check, adds a polling loop per frame, and the first-use stall remains.
- **Recovering from a lost context by re-settling:** plausible, unmeasured, and it would publish a frame from a resource set nothing has verified; excluded until the list above is implemented and tested.
- **Wrapping drei's `OrbitControls` so it takes a time input:** damping integrates from the previous pose; a wrapper would rename the tier instead of removing the history. `CameraRig` stays the absolute alternative.
- **A physics engine with a seeded step count:** a replay would have to re-simulate from frame 0 for every seek, which is a different feature (a deterministic bake), not a canvas integration.
