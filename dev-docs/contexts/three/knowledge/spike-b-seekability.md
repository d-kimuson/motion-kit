# Spike B: absolute-time R3F frames are seekable on SwiftShader and Metal

`frameloop="never"` plus root-local `advance(seconds, false)` reproduced the tested camera, object transforms and shader uniform independently of frame order. **25/25 exact DOM + PNG comparisons passed**, including fresh roots. Four deliberately history-dependent controls failed comparison as intended. Manual Advance alone does not make arbitrary R3F code seekable: the callback must overwrite values from absolute time instead of integrating its delta.

`gl.finish()` followed by Playwright capture worked, with screenshot RGBA equal to WebGL readback. The same captures also worked without an explicit fence in this workload; this is **not evidence that a fence is universally necessary or universally unnecessary**. [Run the experiment](../../../../spikes/b-r3f/README.md). The [historical proposal](../adr/20261023-explicit-r3f-advance.superseded.md) is superseded by the [accepted Phase 0 decision](../../../decisions/20261024-time-control-and-frame-capture.accepted.md), which defines the readiness contract and [core feature tiers](../../core/CONTEXT.md#seekability) without certifying arbitrary R3F code.

## Tier by behavior

| Behavior / tested use                                                         | Tier                                     | Finding and boundary                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure scalar/transform formulas of supplied time                               | A for the value calculation only         | No clock or prior state enters the formula; the R3F/WebGL expression remains B.                                                                                                                               |
| `Canvas frameloop="never"` and root-local `advance`                           | B                                        | Exactly 61 callbacks for 61 sequential seeks; no extra callbacks across three held rAF opportunities. Disable the independent three animation loop; do not run global effects here.                           |
| Camera position plus `lookAt(0,0,0)`                                          | B                                        | Absolute orbit/push values match across order and fresh cameras. No OrbitControls damping, automatic camera fitting, XR or previous-pose interpolation.                                                       |
| Group rotation and translation                                                | B                                        | Overwrite all animated components, rather than apply incremental transforms. All objects use deterministic index-derived positions.                                                                           |
| Shader `uTime` assigned from absolute time                                    | B                                        | A procedural stripe/light shader matches exactly; uniform accumulation fails. This is not a guarantee for shaders with feedback textures, stochastic samples, wall-clock uniforms or temporal postprocessing. |
| GPU capture with preserved framebuffer, fixed DPR/size and pinned browser     | B                                        | Finish/readback reference and Playwright screenshot agree in this finite workload. Scope is one environment per comparison, not cross-backend pixels.                                                         |
| Arbitrary delta-integrating `useFrame` code, history-dependent camera updates | C                                        | Negative controls differ from fresh rendering. The callback's delta is signed history, not a pure frame input. Clamping or taking its absolute value does not repair seeking.                                 |
| Physics, damping controls, autonomous timers/rAF, temporal feedback           | C / unverified                           | Not implemented here. Manual Advance cannot reconstruct their hidden history; unknown components are not inferred A or B.                                                                                     |
| Async models/textures, Suspense, shader/asset readiness                       | Unverified, not classified by this spike | The fixture has only local geometry and synchronously compiled shaders. A broader readiness contract belongs to the asset and browser-clock work.                                                             |

## Measured environment and scene

Measured 2026-10-23 (UTC), macOS 26.5.1 arm64, Apple M3 Pro, Node **26.12.0**, pnpm **12.15.0**, React/React DOM **19.3.1**, R3F **9.8.2**, three **0.186.1**, Vitest **5.0.5**, Playwright **1.64.1**, Chromium headless shell **156.0.8078.4**, Playwright revision **1248**. Viewport 640×480; opaque scene crop 320×240; DPR 1; antialiasing disabled; WebGL 2.0 / OpenGL ES 3.0 Chromium.

The primary renderer was:

```text
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)
```

The hardware profile reported:

```text
ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)
```

Each frame submits **64 sphere meshes, 64 draw calls and 61,440 triangles**. The camera moves along `x=1.4*sin(0.7*t)`, `y=1+0.4*cos(t)`, `z=5+0.5*sin(t)` and looks at the origin. Group rotation is `[0.2*sin(t), 0.6*t, 0]`, vertical displacement is `0.15*sin(2*t)`, and shader uniform `uTime=t` drives visible stripes. Static depth varies by sphere index. This is enough geometry to exercise rendering/readback, not a GPU throughput benchmark. A saved exploratory end-frame screenshot was manually inspected: shaded blue/orange striped spheres on a dark background, not a blank canvas.

The context reports `alpha:true` despite three's `alpha:false` renderer option (three r186 creates an alpha-capable context); every rendered fragment/background is opaque. Transparency is not tested. No antialiasing, external asset loading, fonts, shadows or postprocessing are involved.

## Order comparison and negative controls

The baseline evaluates frames 0–60 at 30 fps, capturing `[0,1,7,15,29,30,31,45,59,60]`. Fast-check seed **144** gives `[0,31,30,1,45,59,15,29,7,60]`, followed by `[60,0,15,60]`. A new React/R3F root, renderer and WebGL context renders each selected frame independently. Fresh does not mean a new browser process or module session.

| Check                                           | Result per full run                                                |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| Sequential advances                             | 61; elapsed time asserted at every step                            |
| Random/repeated DOM string + PNG bytes          | 14/14 identical                                                    |
| Fresh-root DOM string + PNG bytes               | 10/10 identical                                                    |
| Hold 0.5 s across three rAF opportunities       | 1/1 identical; callback count unchanged                            |
| Wrong-history controls                          | 4/4 detected in both DOM and PNG                                   |
| Sync variants versus reference                  | 28/28 identical PNGs (7 per variant)                               |
| Preserved-buffer screenshot versus GPU readback | 8/8 identical, zero mismatched RGBA bytes out of 307,200 per image |

DOM comparison includes the actual canvas/wrapper markup plus a `data-state` serialization of requested time, R3F elapsed time, camera pose/quaternion, object transforms and uniform. A bare canvas DOM string would not measure the scene. PNGs are exact base64-byte comparisons in the same run, without tolerance or checked-in golden images. Start, midpoint and end PNGs must differ to reject constant-output false positives.

The four controls compare a fresh seek to **0.5 s** with the **same faulty implementation** after **[0,2,0.5]**:

| Fault                                     | Fresh result                    | Result after history                                  |
| ----------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| Rotation adds `abs(delta)*0.6`            | y rotation 0.3                  | approximately 2.1                                     |
| Uniform adds `abs(delta)`                 | `uTime=0.5`                     | `uTime=3.5`                                           |
| Camera updates only at a new maximum time | camera x approximately 0.480057 | camera x approximately 1.379630 (pose at 2 s)         |
| Drop reverse `advance`                    | elapsed/uniform 0.5             | requested time 0.5 but elapsed/uniform 2; stale frame |

The separate delta test observes **[0,2,-1.5,0]** for timestamps **[0,2,0.5,0.5]**. In this pinned R3F never-loop, `advance` assigns its timestamp directly to `clock.elapsedTime`; the fixture supplies **seconds**, not rAF milliseconds. The frame/30 conversion is only the experiment input, not a new Time Module. A value derived from signed delta can appear correct on forward traversal while remaining history-dependent; no generic delta-driven component is certified here.

The full suite has **8 tests / 81 PNG captures**: 35 order checks, 35 sync checks, eight negative-control captures and three non-preserved-buffer captures. Two measured software runs passed in **11.29 s wall time / 10.78 s Vitest duration** and **9.81 s wall / 9.30 s Vitest**. The full hardware run passed in **9.09 s wall / 8.62 s Vitest**. The separate eight-profile flag matrix took **32.42 s wall**. These are whole-command times, not GPU fence latency measurements. Browser initialization and screenshot RPC overhead are included. The test remains outside `pnpm test` and the CI gates ([ADR](../../../decisions/20261031-spike-suites-stay-out-of-ci.accepted.md)). Linux is qualified: 8 tests passed **5/5** in **11.42–13.01 s**, the matrix returned 0 **5/5** in **32.21–46.21 s**, and all 25 order/fresh/held comparisons held on SwiftShader (Subzero) ([record](../../render/knowledge/20261031-linux-spike-qualification.md)).

## Mount, render and GPU synchronization

1. Mount React DOM with `flushSync`, then await a scene `useLayoutEffect` acknowledgement. This ensures the R3F scene exists before the first seek; `flushSync` alone is not assumed to flush a second reconciler or all async work.
2. Configure `frameloop="never"`, fixed DPR/size and `preserveDrawingBuffer:true`; call `renderer.setAnimationLoop(null)`. The root clock is asserted stopped. There are no other animation sources in this scene.
3. Call that root's `state.advance(t, false)`. The callback overwrites camera, transforms and uniform from `clock.elapsedTime`. `false` deliberately excludes global effects; another canvas must not be advanced incidentally.
4. The main comparison calls `renderer.getContext().finish()` before capture. This waits for submitted GL commands, not assets, future React work or browser composition. A readback variant uses synchronous default-framebuffer `gl.readPixels` instead. The reference uses finish **and** readback.
5. Capture only the fixed canvas with Playwright, `animations:'allow'`. Compare PNG bytes. Decode eight reference/order PNGs to RGBA, invert the WebGL readback's row order, and assert all 307,200 bytes agree. This checks that the screenshot reflects the actual rendered buffer, not just another stale screenshot.

The sync experiment samples **[0,0.5,2,0.1,1,0,2] s**. `finish`, `readPixels`, one rAF callback and no explicit fence each matched the reference **7/7** on both SwiftShader and Metal. No hidden `readPixels`/`toDataURL` runs before the rAF/no-fence captures. Playwright's screenshot pipeline provides enough synchronization for these frames, but it could conceal queued GPU work; no GPU-queue duration or minimal required barrier is established. A rAF callback is a presentation opportunity, not an assertion that all GPU work has completed. `setAnimationLoop(null)` disables autonomous work; it is not a fence.

With **`preserveDrawingBuffer:false`**, immediate and three-rAF-delayed Playwright screenshots still matched the preserved reference on both backends. However delayed readback differed in **307,200/307,200 bytes**: the default buffer had been cleared while the compositor retained the visible image. Therefore do not equate screenshot success with persistent framebuffer contents, or assume `gl.finish()` preserves them. Keep preservation in this reproducible experiment; whether production should instead use an explicit render target/readback path remains open.

## Chromium flags and CI guidance

Run `pnpm spike:three:flags` for the complete scene order comparison per profile, not just a successful `getContext` probe. Each successful row below passed **25/25 DOM + PNG comparisons**, with 35 screenshots and zero final screenshot/readback mismatches. These rows are **macOS measurements**. On Linux every profile that obtains a WebGL context resolves to SwiftShader (Subzero) — `angle-only` no longer selects Metal — and the two disabled profiles fail as expected ([record](../../render/knowledge/20261031-linux-spike-qualification.md)).

| Profile                        | Additional Chromium arguments                                                          | Observed backend and result                                   | Vitest duration |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------- |
| `swiftshader` (default script) | `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`                   | SwiftShader; pass                                             | 4.50 s          |
| `default`                      | none                                                                                   | SwiftShader fallback; pass                                    | 4.67 s          |
| `angle-only`                   | `--use-gl=angle`                                                                       | Apple M3 Pro / Metal; pass                                    | 4.15 s          |
| `swiftshader-no-opt-in`        | `--use-gl=angle --use-angle=swiftshader`; also remove Playwright's default unsafe flag | SwiftShader; pass                                             | 4.21 s          |
| `disable-gpu`                  | `--disable-gpu`                                                                        | SwiftShader fallback; pass, **does not disable WebGL here**   | 4.69 s          |
| `disable-gpu-and-software`     | `--disable-gpu --disable-software-rasterizer`                                          | No WebGL2 context; expected failure                           | 0.653 s         |
| `desktop-gl`                   | `--use-gl=desktop`                                                                     | SwiftShader fallback; pass, **not desktop hardware evidence** | 4.71 s          |
| `disabled-webgl`               | `--disable-webgl`                                                                      | No WebGL2 context; expected failure                           | 0.664 s         |

`DEBUG=pw:browser pnpm spike:three -t 'absolute time:'` verified the actual headless-shell launch. Playwright itself supplies `--enable-unsafe-swiftshader`, `--headless`, `--force-color-profile=srgb`, `--disable-dev-shm-usage`, `--no-sandbox` and `--enable-features=CDPScreenshotNewSurface`, among its other pinned defaults. The no-opt-in profile explicitly uses `ignoreDefaultArgs:['--enable-unsafe-swiftshader']`; merely omitting our additional argument would not have tested its absence. Explicit SwiftShader worked without that opt-in in this build, so this experiment does not claim it was strictly necessary. Keep the explicit three-flag profile as the reproducible software candidate instead of depending on platform fallback.

For a Linux run: install pinned Node/pnpm dependencies and Playwright Chromium with `pnpm exec playwright install --with-deps chromium`, use the explicit software profile, verify the emitted renderer actually says SwiftShader, then run both commands. Do not add `--disable-software-rasterizer` alongside `--disable-gpu` or disable WebGL. The measured headless Linux run needed no X server or physical GPU: every WebGL profile resolved to SwiftShader (Subzero), both commands passed 5/5, and no SwiftShader deprecation warning appeared ([record](../../render/knowledge/20261031-linux-spike-qualification.md)). No browser job is added to the normal CI budget.

The unsafe-software flag and Playwright's sandbox defaults are appropriate only for this trusted local fixture. The Browser Renderer must make its own isolation/security decision for untrusted compositions rather than blindly inherit these defaults. A successful flags row is not an assurance about arbitrary browser versions, system Chrome or OS/GPU combinations.

## Dependency audit and verification

Before adding packages, ran `pnpm view <package>@<version> license` for every direct addition and checked the returned licenses against `scripts/check-licenses.ts`, as required by [local development](../../../guidelines/local-dev.md). After installation, `pnpm licenses list --json` reported:

| Added direct devDependency | Exact version | License    |
| -------------------------- | ------------- | ---------- |
| react                      | 19.3.1        | MIT        |
| react-dom                  | 19.3.1        | MIT        |
| @types/react               | 19.3.0        | MIT        |
| @types/react-dom           | 19.3.0        | MIT        |
| three                      | 0.186.1       | MIT        |
| @react-three/fiber         | 9.8.2         | MIT        |
| @types/three               | 0.186.0       | MIT        |
| playwright                 | 1.64.1        | Apache-2.0 |
| @vitest/browser-playwright | 5.0.5         | MIT        |

New transitive packages use allowlisted MIT, Apache-2.0, BSD-3-Clause (`ieee754`) or ISC (`flatted`). Apache-2.0 includes `@dimforge/rapier3d-compat`, brought by three's type package, not exercised as physics. The full installed development tree also contains the **pre-existing** MPL-2.0 `lightningcss` tooling; it is not a new production dependency. Production `dependencies` remain exactly `zod:4.6.7`. The normal production license check passes. Chromium is separately downloaded developer tooling, not packaged. React peerDependency promotion is TASK-149.

The repository uses pnpm's global virtual store. R3F's declaration files could not resolve React JSX/three type packages there from its original metadata; a version-scoped `packageExtensions` entry adds the two already-pinned type peers. This fixes real module resolution, not a `skipLibCheck`/`any` workaround. Only the non-shipped fixture receives an additional three-import lint exception; production context boundaries remain unchanged.

Verification: `pnpm fix`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (78 tests). `pnpm spike:three` passed on software and hardware; `pnpm spike:three:flags` returned zero with the expected unavailable-WebGL child failures. No Lean files changed and no `lake build` was needed. The package files/exports are unchanged and exclude `spikes/`; `pnpm pack --out /tmp/motion-kit-spike-b.tgz` plus `tar -tzf` verified the archive contains only the existing shipped source, package metadata, README and license. The experiment follows Spike A's approach but does not depend on that unmerged PR's files.

## Open risks and decisions

- **Production readiness:** choose a barrier that composes React commit, scene readiness, assets, shader compilation and frame identity, with bounded timeout/cancellation/diagnostics. This layout-effect acknowledgement and `gl.finish()` do not solve arbitrary async work. The Phase 0 ADR now composes the C/D findings into that contract; production implementation remains necessary.
- **Synchronization cost:** finish/readback stalls the GPU; its latency was not isolated. The matching no-fence captures do not justify deleting a production barrier without larger workloads, queue-pressure and driver tests. An explicit render target may avoid relying on preserved default-buffer behavior.
- **Environment:** no hardware-GPU Linux run, browser-process isolation comparison, high-DPR/4K capture, antialiasing, transparency, driver upgrade matrix or cross-backend pixel equality test. The hardware and software runs compare against their own baselines, never each other.
- **Library evolution:** R3F emits three's `THREE.Clock` deprecation warning. This spike does not modify R3F's clock implementation; recheck timestamp/delta and lifecycle behavior on upgrades.
- **Scope:** no controls, physics, AnimationMixer, feedback effects, WebGPU/XR, shadows, loaded assets, multiple simultaneous canvases, StrictMode, async React updates or context-loss recovery. Finite successful samples cannot certify arbitrary shaders/components.
- **Lifecycle/security:** fresh roots are explicitly disposed and their contexts lost; long render sessions/resource limits are not stress-tested. Browser Renderer isolation and the unsafe-software/sandbox policy require their own decision.
- **API:** ThreeCanvas/CameraRig and integration capability diagnostics are not implemented. The Phase 0 ADR supersedes the proposal; whether to expose finish/readback strategies or allow user-managed render targets remains later-phase API work.
