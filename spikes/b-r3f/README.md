# Spike B: React Three Fiber seekability

Run `pnpm spike:three` to compare externally driven R3F frames in Playwright Chromium using SwiftShader. This experiment is not shipped, exported, or part of `pnpm test`. Read the [findings](../../docs/contexts/three/knowledge/spike-b-seekability.md) and [proposed ADR](../../docs/contexts/three/adr/20261023-explicit-r3f-advance.proposed.md) before reusing the technique.

## Run

From the repository root, using `.node-version` and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm spike:three
pnpm spike:three:flags
```

On Linux, use `pnpm exec playwright install --with-deps chromium` to provision browser libraries (may require sudo). Use Playwright's pinned browser, not system Chrome. If a managed worktree starts with `node_modules` symlinked to another checkout, unlink **only the symlink** before installing, so dependencies stay local. The narrow `packageExtensions` entry supplies R3F's declaration-time React/three peers inside pnpm's global virtual store; do not disable that store or loosen type checking to work around missing JSX types.

No network requests, fonts, models, textures, FFmpeg, or external services are needed during the experiment. Dependencies and the browser must already be installed.

For a focused run or a different launch profile:

```sh
pnpm spike:three -t 'GPU barriers:'
SPIKE_THREE_FLAGS=angle-only pnpm spike:three
DEBUG=pw:browser pnpm spike:three -t 'absolute time:'
```

`spike:three:flags` launches the **order-comparison test** in a separate browser process for each profile in `flags.ts`, printing the actual renderer, flags and exit code. It returns nonzero if the canonical software run fails/is not SwiftShader, or if `--disable-webgl` does not reject WebGL. Other profiles are diagnostic observations, not portable pass/fail expectations. The two disabled-rendering profiles printed failing child tests on the measured host; this is expected evidence, not a failing matrix command. The no-opt-in profile removes Playwright's own `--enable-unsafe-swiftshader` default as well as omitting our copy.

## What is measured

- `fixture.tsx`: a real `<Canvas frameloop="never">`, 64 shaded spheres (61,440 triangles / 64 draw calls), 320×240 pixels, DPR 1, no antialiasing. `seek(seconds)` calls the root's `advance(seconds, false)` once. Camera position/look-at, group rotation/translation and shader `uTime` are overwritten from absolute time in `useFrame`. No accumulated delta drives the controlled scene.
- Mount readiness: React DOM `flushSync` plus a scene layout-effect acknowledgement. `renderer.setAnimationLoop(null)` prevents a separate three loop. These do not claim readiness of arbitrary Suspense/assets/effects.
- Sequential frames 0–60 at 30 fps; ten selected PNGs compared with seed-144 random/repeated seeks and a fresh React/R3F root, renderer and WebGL context per selected frame. Three held rAF opportunities must not advance the scene. Fresh roots share the same browser/module session.
- Exact serialized DOM (including a `data-state` snapshot of camera/object/uniform values) **and base64 PNG bytes**. No perceptual tolerance, stored goldens, animation fast-forwarding, or disabled animations. The canvas screenshot alone would not inspect the object graph; the DOM snapshot alone would not prove GPU rendering.
- GPU synchronization: `gl.finish()`, synchronous `gl.readPixels`, one rAF, and no explicit fence, each compared to a finish+readback reference. Eight preserved-buffer screenshots are decoded to RGBA and compared byte-for-byte against bottom-up WebGL readback. The no-fence and rAF paths do not secretly read pixels before capture.
- Four negative controls compare the same faulty scene at 0.5 s after `[0,2,0.5]` with a fresh root at 0.5 s: accumulated absolute delta for rotation/uniform, a forward-only camera, and a dropped reverse `advance`. Each must mismatch in DOM and PNG. Different-time baseline PNGs must also differ.
- A separate observation compares immediate/delayed screenshots and delayed readback with `preserveDrawingBuffer=false`. Its results are printed, not assumed portable.

Every test prints JSON measurements. The full suite takes approximately 9–12 s locally; the eight-profile matrix takes approximately 32 s. The script stays separate from `pnpm test` despite the short local suite: Linux CI stability and runtime have not been qualified, and browser provisioning is not part of the default checks. No browser CI job is added. Lint/typecheck cover the experiment; `package.json`'s `files` allowlist excludes it.

## Deliberately out of scope

This does not implement ThreeCanvas/CameraRig or change a public API. It cannot control arbitrary `useFrame` callbacks, damping controls, physics, independent timers/rAF, render-target feedback or temporal effects. It does not establish asynchronous asset readiness, WebGPU/XR, transparency, antialiasing, multi-canvas rendering, context recovery, cross-process pixel identity, cross-GPU/OS pixel identity, or Linux CI behavior. See the report's tier table and residuals. React remains an exact-pinned devDependency until TASK-149.
