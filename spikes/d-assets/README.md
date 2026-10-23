# Spike D: explicit asset readiness before capture

Run `pnpm spike:assets` to reproduce font, image, GLTF and texture readiness controls in Playwright Chromium. The experiment is **not shipped or exported and is deliberately outside `pnpm test`**: Linux CI stability/runtime and browser provisioning have not been qualified. See the [report](../../docs/contexts/render/knowledge/spike-d-assets.md) and [accepted cross-context ADR](../../docs/decisions/20261023-asset-readiness-registry.accepted.md).

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm spike:assets
# Focus a fixture:
pnpm spike:assets -t 'texture:'
```

Use `.node-version` and the pinned pnpm version. On Linux install browser libraries with `pnpm exec playwright install --with-deps chromium` (may require sudo). If a managed worktree supplies a `node_modules` symlink, unlink **only that symlink** before installing locally. The fixture needs no internet connection once dependencies and Chromium are installed. It serves committed assets on Vitest's local server. No new dependencies were added; existing exact-pinned React, three, Playwright and Vitest tooling are reused.

The suite prints JSON measurements and returns nonzero for any missing negative-control mismatch, failed diagnostic, or unequal guarded capture. Expect about 10 s locally, not a CI performance guarantee. Chromium uses `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` for trusted fixtures only.

## What it measures

- `vitest.config.ts` holds font/image/GLTF HTTP responses until the driver explicitly releases them. A held capture followed by a 300 ms failed readiness wait proves the asset remains unavailable; there is no race against a fixed network delay. Every response has `Cache-Control: no-store` and a unique request ID.
- `fixture.tsx` renders fallback text, an unloaded image, an empty three scene, or a stale blue texture before readiness. The texture source image is **already decoded and drawn into the CPU canvas** before the early screenshot; an independently held upload-permission response delays `needsUpdate`/`initTexture`. It models deferred submission, not measured GPU upload latency.
- Font: `FontFace.load()`, required face status and `document.fonts.ready`. Image: `image.decode()`, plus an independent `onload`-only comparison. GLTF: three's `GLTFLoader.loadAsync()` loading an actual glTF 2.0 triangle. Texture: decoded image → canvas → `CanvasTexture`, `initTexture`/`onUpdate`, explicit render and `gl.finish()`.
- `registry.ts` observes asset promises before React renders, retains named failures, and bounds waits. `seek(frame)` waits, forces this fixture's React commit, verifies its layout-effect acknowledgement, renders WebGL and fences submitted work. It returns a diagnostic-like result rather than capturing on failure. This is an experimental one-resource registry, **not TASK-158's implementation**.
- Per type: sequential `[0,1,2]`, reordered/repeated `[2,0,1,2]`, and a fresh fixture per frame. `frame*12` overwrites the visual's horizontal position; the start/end images must differ. Compare exact serialized DOM and PNG bytes; normalize only the per-request image URL in the DOM. Fresh means a new React root/WebGL context, not a new browser process.
- Per type: missing/corrupt sources, a never-released response, a named timeout, and a Suspense-aware reader. Ordinary asset loads do not suspend just because they are inside a boundary. The reader suspends, but its fallback can still be captured; after explicit awaiting and commit, it matches the non-Suspense baseline. A separate lost-WebGL-context test exercises an upload failure.
- The config sets **`PW_TEST_SCREENSHOT_NO_FONTS_READY=1`**, a pinned Playwright test-only switch. Otherwise Playwright's implicit font wait would hide or hang the negative control. This is instrumentation, not a production recommendation. Recheck it on upgrades; the pending-font assertion and pixel mismatch will catch it ceasing to work.

The default success deadline is 5 s. Tests use 300 ms while taking negative controls and 100 ms for never-settling cases. Failure results name the kind and source URL (texture also names its image source). Timers bound failure only; they never declare readiness. Cleanup explicitly releases held work, unmounts React, removes the font, disposes geometries/materials/textures/renderer and loses WebGL contexts. The server has a 15 s emergency connection watchdog. Aborting underlying browser loads and production cancellation are not implemented.

## Asset license and provenance

| Asset                                    | Provenance                                                                                                                                                                                                                                                                | Redistribution license                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/Abel-Regular.ttf` (35,220 bytes) | Unmodified Abel by Matthew Desmond, downloaded from [google/fonts at commit 3b99d83](https://github.com/google/fonts/blob/3b99d83d2625944fc0b8bd328d793fa819b92381/ofl/abel/Abel-Regular.ttf); SHA-256 `8809dcad25318225052f88333e208c5aad4adcb7b2c934c135735ec19aa410b4` | SIL OFL 1.1; copyright and full terms retained in `assets/OFL.txt`. Reserved Font Name Abel. This file is **not relicensed MIT**. `SpikeAbel` is only a CSS family alias; font bytes are unchanged. |
| `assets/checker.svg`                     | Authored for this repository: 128×128 orange square and two green 64×64 squares; no third-party source. Used as both image and texture source.                                                                                                                            | Repository [MIT license](../../LICENSE), copyright 2026 d-kimuson.                                                                                                                                  |
| `assets/triangle.gltf`                   | Authored for this repository: vertices `[-0.8,-0.7,0]`, `[0.8,-0.7,0]`, `[0,0.8,0]`, embedded little-endian float32 positions, orange unlit material. No external model, exporter, texture or decoder.                                                                    | Repository MIT license, copyright 2026 d-kimuson.                                                                                                                                                   |
| Canvas texture and invalid responses     | Generated by `fixture.tsx` (blue initial canvas) and the server (404 text / intentionally corrupt JSON); no third-party source.                                                                                                                                           | Repository MIT license.                                                                                                                                                                             |

## Out of scope

No public `useAsset` API, production registry, loader wrappers or render implementation. No video/audio, large raster decode stress, external GLTF buffers/textures, Draco/KTX2, shader compile failure, GPU queue-pressure benchmark, GPU/context recovery, WebGPU, multi-canvas, hidden lazy assets, Suspense transitions/nesting, StrictMode, changing sources mid-frame, cache eviction, cancellation, cross-process/browser/GPU/OS pixel identity or Linux CI qualification. A tiny SVG matching on `onload` does not prove `onload` is sufficient for all image formats. The report specifies what TASK-158 still needs to implement and test.
