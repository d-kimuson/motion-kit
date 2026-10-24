# Spike D: assets need an explicit await-before-capture registry

All four delayed fixtures produced wrong pixels without the Readiness Barrier and matched their settled baselines after it. **32/32 exact DOM + PNG comparisons passed** across reordered/repeated frames, fresh fixtures and Suspense readers. **4/4 asset failures and 4/4 never-settling cases produced named diagnostics**, plus a texture upload/context-loss diagnostic. Suspense alone is insufficient: it holds participating content, but its fallback remains capturable.

The production contract is the [core asset readiness ADR](../../core/adr/20261024-asset-readiness.accepted.md): fonts and images register through `useAsset` and drain until stable. This spike is not that implementation. Suspense and `document.fonts.ready` are still not a complete capture contract. See the [accepted cross-context ADR](../../../decisions/20261023-asset-readiness-registry.accepted.md) and [reproduction instructions](../../../../spikes/d-assets/README.md).

## Per-asset result

Changed bytes below are decoded RGBA channel bytes, out of **230,400** per 320×180 screenshot, not a count of changed pixels. Positive comparisons use exact PNG bytes and serialized DOM, with only the unique image request URL normalized.

| Asset   | Readiness signal tested                                                                                                                        | Unguarded control → settled output                                                                        | Failure signal                                                                                                                        | Suspense verdict                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Font    | Required `FontFace.load()` fulfillment/status, then `document.fonts.ready` and `document.fonts.check` for the declared face/text               | Monospace fallback → Abel; **14,253** changed bytes; face remained `loading` while gated                  | HTTP 404 → `NetworkError: A network error occurred.`; stalled face → named timeout                                                    | A raw font load does not suspend. Resource reader holds its subtree, not capture; explicit registry required.                                                      |
| Image   | `HTMLImageElement.decode()` fulfillment; separately compare `onload`-only                                                                      | Incomplete image (`complete=false`, `naturalWidth=0`) → checker; **40,960** changed bytes                 | HTTP 404 → `EncodingError: The source image cannot be decoded.`; stalled response → named timeout                                     | Raw `<img>` does not suspend. Same capturable-fallback result with a participating reader; registry required.                                                      |
| GLTF    | `GLTFLoader.loadAsync()` fulfillment after parsing the glTF 2.0 scene, then explicit scene render/`gl.finish()`                                | Empty dark canvas → orange triangle; **23,040** changed bytes                                             | HTTP 200 corrupt JSON → parser `SyntaxError`; stalled loader → named timeout                                                          | Loader promise can suspend a reader, but resolution is not React commit or GPU render. Registry + integration settlement required.                                 |
| Texture | Source `image.decode()` and canvas draw; then `texture.needsUpdate`, `renderer.initTexture`, `texture.onUpdate`, explicit render/`gl.finish()` | CPU canvas already has the checker, GPU still has initial blue upload → checker; **29,038** changed bytes | Texture-source HTTP 404 → `EncodingError`; forced context loss → `WebGL context lost before upload`; held upload gate → named timeout | CPU/source Suspense does not imply an upload or render. Even a reader of the complete upload promise exposes a capturable fallback; registry + GPU phase required. |

Each type contributes **4 reordered/repeated**, **3 fresh-fixture**, and **1 Suspense-to-baseline** matches (8 each). Every early control remains pending through its screenshot and an additional **300 ms** timeout. The gate is released by the driver only afterward: slow machines cannot accidentally load the asset before the control. Start/end baseline PNGs also differ, rejecting a constant-output false positive.

### Font: global settlement is not success

A separate test loads a missing required face, awaits its named failure and then awaits `document.fonts.ready`. The latter **fulfills while the face status is `error`**. Therefore theme/core must know which face/weight/style was required and observe its own load outcome. Global font settlement alone loses this failure. This experiment uses one declared regular face and ASCII text, not weight substitution, fallback glyph coverage or variable fonts.

Playwright normally awaits `document.fonts.ready` inside screenshot capture. The spike sets `PW_TEST_SCREENSHOT_NO_FONTS_READY=1` in its Node-only config so that the **negative control really is unguarded**; otherwise the test would silently use a second font barrier or hang on the gated response. The flag is private test instrumentation of the pinned Playwright version, not a proposed production dependency. Font status/pixel assertions detect a regression if an upgrade stops honoring it. Production can retain Playwright's default wait, but still needs explicit required-face failure and deadline handling.

### Image: decode and onload are not ordered as assumed

For this small SVG, recorded events were **`image.decode` then `image.onload`**, not the reverse. An independent fixture using only `onload` matched the decoded reference in DOM and PNG (**1/1**). The experiment establishes that no barrier captures the wrong image and that decode works; it **does not establish that onload-only necessarily captures wrong pixels**. A large raster, animated image or memory-pressure decode gap was not forced. Prefer `decode()` as an explicit successful-decode promise with a rejection path, not because this fixture demonstrates a universal onload failure. Raw error events/decode errors do not reliably name the source, so the registration supplies it.

### Texture: source, submission and completion are different phases

The initial blue canvas is actually uploaded and rendered. The source image is then decoded and drawn onto that CPU canvas **without** `needsUpdate`; the first screenshot still sees blue. The driver holds an upload-permission response independently of the source load. Once released, the fixture marks the texture dirty, calls `initTexture` and requires `onUpdate` to increment the upload count from **1 to 2**, then renders and calls `gl.finish()` before capture. Thus CPU readiness cannot substitute for requesting/submitting the current texture version.

`onUpdate` acknowledges three's upload path, **not a browser GPU-completion promise**. `gl.finish()` fences submitted commands but cannot wait for work not yet submitted. This experiment delays submission deliberately; it does not isolate real DMA latency, prove a minimum fence, or demonstrate that Playwright would fail after submission without a fence. The [Spike B GPU observations](../../three/knowledge/spike-b-seekability.md) remain applicable. A forced lost WebGL context is detected before upload and converted into the same named failure result; recovery and loss after successful readiness remain unverified.

## Suspense experiment and capture protocol

Every fixture is inside a React Suspense boundary. With the ordinary asset path, content commits immediately and the boundary does not automatically discover font/image/GLTF/upload work. Its early screenshot is wrong.

The participating variant reads the promise already registered **before render** and throws it while pending. All four boundaries display fallback, remain there through a 300 ms bounded wait, and have **no content layout-effect acknowledgement** (`committed=-1`). Playwright successfully captures that fallback, and its pixels differ from the settled frame. After release, registry awaiting, explicit React commit and WebGL settlement, all four captures match their corresponding non-Suspense baselines. Suspense really holds content for the entire gate, but it does not hold the browser's screenshot operation. This distinguishes UI coordination from capture readiness without relying on React's retry timing.

The prototype drive helper performs:

1. Await the registered acquisition/decode/upload work, with a deadline and retained named failures.
2. Set the requested frame, `flushSync` the fixture tree, and require its `useLayoutEffect` acknowledgement for that frame.
3. Overwrite visual position from the frame input; render the GLTF/texture scene and fence submitted GPU work.
4. Capture only after a successful result; compare DOM plus PNG against the baseline.

Registering only in an effect inside a suspended subtree would deadlock discovery: that effect cannot run until the resource is available. TASK-158 needs a cached registration/resource state accessible before suspension. A production frame may reveal additional assets during commits, so it must drain/recheck registration generations until stable. The prototype has one upfront resource and snapshots `Promise.all`; **do not reuse it as the production dynamic registry algorithm**.

## Failures and timeout behavior

The spike converts loader exceptions at registration into `{ok:false, diagnostics:[{code, asset, message}]}`. Its local result types are evidence, not the shipped `DiagnosticSchema`. The [accepted CLI contract](../../agent/adr/20261024-cli-output-contract.accepted.md) maps font HTTP/load failure, image decode failure, corrupt GLTF parsing, texture-source decode failure and forced context loss before texture upload to `asset.load-failed`. Stalled font/image/GLTF loads and the held texture upload gate map to `asset.not-ready` when the readiness deadline expires; the intentional negative-control waits use the same timeout mapping. `details.assets` carries each failing or pending asset's kind, source URL/path and phase; timeouts include every pending registration and `details.timeoutMs`. Texture entries identify the source image and include the upload gate in `relatedSources`. Known frame/scene goes in `location`. The public `message` is a one-sentence human statement, not an internal code or raw browser/loader exception; `hint` gives a corrective action, such as checking the source URL, repairing the model, restoring the GPU context or investigating the pending phase.

Success waits default to **5 s**. The four never-released cases use **100 ms** and return failure with the pending registration still present, not a successful fallback frame. The 300 ms negative-control waits also fail intentionally. Neither timeout marks the resource ready nor cancels it. Cleanup explicitly releases outstanding requests and disposes the fixture; the test server has a separate **15 s** connection watchdog. Production must add abort/cancellation and a whole-frame deadline covering commit, GPU and browser RPC phases; `gl.finish()` itself is not a cancellable JavaScript promise.

## Environment, measurements and verification

Measured **2026-10-23 UTC** on macOS **26.5.1**, arm64, **Apple M3 Pro**; Node **26.12.0**, pnpm **12.15.0**, React/React DOM **19.3.1**, three **0.186.1**, Vitest/browser provider **5.0.5**, Playwright **1.64.1**, Chromium headless shell **156.0.8078.4**. Viewport 640×480, fixture 320×180, WebGL canvas 160×160, DPR 1, no antialiasing, preserved drawing buffer. Explicit flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

Reported backend:

```text
ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)
```

The **11-test suite takes 54 screenshots**: 13 per type plus the two onload/decode comparisons. A measured full run passed in **9.70 s wall / 9.01 s Vitest duration**; the preceding run passed in **10.07 s wall / 9.23 s Vitest** with identical negative-control counts. These include startup and screenshot overhead, not isolated load/decode/fence timings. Fixtures use sequential `[0,1,2]`, reordered/repeated `[2,0,1,2]`, and fresh React roots/renderers per frame. They share one browser process/module session and are not cross-process cold-cache comparisons.

| Command                                                           | Result                                                          | Wall time |
| ----------------------------------------------------------------- | --------------------------------------------------------------- | --------- |
| `pnpm fix`                                                        | Pass                                                            | 1.29 s    |
| `pnpm lint`                                                       | Pass, including production license and tsconfig coverage checks | 1.06 s    |
| `pnpm typecheck`                                                  | Pass                                                            | 0.45 s    |
| `pnpm test`                                                       | 86 tests / 6 files pass; spike excluded                         | 0.90 s    |
| `pnpm spike:assets`                                               | 11 tests pass, all intended negative controls detected          | 9.70 s    |
| `lake build`                                                      | Pass; built the unchanged differential-test oracle              | 5.65 s    |
| `pnpm pack --out .cache/spike-d/package.tgz` + archive inspection | Pass; no spike code or assets in shipped archive                | Not timed |

No Lean source changed. Lean's linker emitted SDK minimum-version warnings (bundled libraries built for macOS 15 versus target 14); build and differential tests passed. No new npm dependency or lockfile change was needed: all tooling reuses existing exact pins. The OFL font's copyright/license and immutable provenance, and the original MIT image/model assets, are documented in the spike README. Only the non-shipped fixture/config receive narrow three/Node lint exceptions; production boundaries and exports stay unchanged.

**The suite stays outside `pnpm test`** despite its short local runtime. Linux CI stability, required browser system libraries and CI runtime have not been measured; no browser job is added.

## Residual risks for TASK-158

- Registration lifecycle, cancellation/retry, cache identity, concurrent frames, late/nested Suspense discovery, source changes during a frame and stale commit acknowledgements need production design and tests. Suspense transition retention, StrictMode and error-boundary UI are not exercised.
- Font weights/styles/glyph coverage and lazy CSS fonts are unverified; assets outside the registry cannot silently be inferred ready.
- The image is a small SVG, not a raster decode stress test. GLTF uses one embedded buffer and an unlit triangle: external dependencies, Draco/KTX2, skinning and textured models are unverified.
- GPU upload errors beyond explicit context loss, asynchronous shader compilation, context recovery, queue pressure, multiple canvases and WebGPU are unverified. No fence cost or minimal fence was established.
- No Linux, hardware-GPU, high-DPR, cross-browser/OS/process comparisons, sustained resource-leak stress, video or audio. The private Playwright font-wait switch must be revalidated on upgrades.
- The experiment's trusted local-server/SwiftShader setup is not a security policy for untrusted compositions. The accepted ADR fixes the strategy; TASK-158 owns its production implementation.
