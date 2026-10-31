# Spike A: explicitly driven Motion paths are seekable within a narrow scope

MotionValue writes, numeric `motion.div` styles, and paused `animate()` controls reproduced the tested frames exactly. Live springs, AnimatePresence, layout projection, and autonomous animation did not. **React commit alone is not DOM completion**: five controlled paths had 30 stale immediate reads out of 61 sequential updates each.

These are findings for the pinned experiment, not certification of every Motion API. [Run the experiment](../../../../spikes/a-motion/README.md). The [historical proposal](../adr/20261023-explicit-motion-seeking.superseded.md) is superseded by the [accepted Phase 0 decision](../../../decisions/20261024-time-control-and-frame-capture.accepted.md). The measurements below do not authorize a production API; the decision and [core table](../../core/CONTEXT.md#seekability) now define the integration boundary.

## Tier by feature

| Feature / tested use                                            | Tier                                                               | Finding and boundary                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Externally set MotionValue, bound to `motion.div` `x`           | B                                                                  | `value.set(f(time))` plus a render acknowledgement works; do not rely on velocity/history or attach a live animation.                                                                                                                               |
| `motion.div` synchronization with numeric `style.x`             | B                                                                  | Updating props with `flushSync` still leaves queued Motion DOM work. A raw `motion.div` is not automatically A.                                                                                                                                     |
| `animate(MotionValue, [0,160])` playback controls               | B                                                                  | Explicit keyframes, `autoplay:false`, `pause()`, then assign `.time` in seconds. Forward, reverse, repeated and beyond-duration seeks match. This does not cover `play()`, speed changes, repeat, timelines, callbacks or implicit starting values. |
| `animate(element, {opacity:[0,1]})` playback controls           | B                                                                  | The same controls work for native animation: one Web Animation was verified paused at `currentTime=500` ms. No blanket guarantee for every WAAPI property/compositor path.                                                                          |
| Spring via paused `animate()` with fixed initial conditions     | B                                                                  | Explicit stiffness 120, damping 14, mass 1, velocity 0, keyframes `[0,160]`; value and DOM seek correctly.                                                                                                                                          |
| Spring via a **fresh** `spring(options).next(timeMs)` evaluator | A for the stateless value evaluation; B for its Motion DOM binding | Fixed inputs, no previous evaluator state retained. Matches the paused spring samples. This is not yet motion-kit's full Spring/Retarget API or certification of a reused mutable generator.                                                        |
| Live `useSpring(source)`                                        | C                                                                  | A source value change starts an animation from prior state; specifying the same target does not specify the same position.                                                                                                                          |
| AnimatePresence exit                                            | C                                                                  | An exiting node is retained after sequential traversal; a fresh mount at the same timeline time contains no node. No absolute-time exit lifecycle is exposed by this fixture.                                                                       |
| `layout` animation                                              | C                                                                  | Projection depends on the previous layout measurement; a fresh mount has no previous box to animate from.                                                                                                                                           |
| Autonomous `motion.div animate`                                 | C                                                                  | Wall-clock progress is not timeline progress, even when target props come from time.                                                                                                                                                                |

No new production feature is classified A merely because its dependency is Motion. The value-only A row is the stateless evaluation pattern, not the entire library or rendering path.

## Measured results

Measured 2026-10-23 on macOS 26.5.1 arm64, Node 26.12.0, pnpm 12.15.0, React/React DOM 19.3.1, Motion 14.6.0, Vitest 5.0.5, Playwright 1.64.1 and Chromium 156.0.8078.4 (revision 1248), headless, 640×480 viewport and 300×80 capture crop. No fonts, images, video, SVG, or GPU scenes are involved.

The controlled fixture traverses frames 0–60 at 30 fps (0–2 s). It captures sequential frames `[0,1,7,15,29,30,31,45,59,60]`. Fast-check seed **143** produces the order `[30,15,45,1,59,60,31,7,0,29]`, followed by `[60,0,15,60]`. A new fixture then renders each selected frame independently. "Isolated" means a fresh React root and animation objects within the same browser/module session, not a new browser process.

| Fixture        | Random/repeated DOM + PNG matches | Isolated DOM + PNG matches | Held-time matches | Immediate stale reads / sequential updates | Value at 0 / 0.5 / 2 s             |
| -------------- | --------------------------------- | -------------------------- | ----------------- | ------------------------------------------ | ---------------------------------- |
| external-value | 14/14                             | 10/10                      | 1/1               | 30/61                                      | x: 0 / 80 / 160 px                 |
| react-style    | 14/14                             | 10/10                      | 1/1               | 30/61                                      | x: 0 / 80 / 160 px                 |
| animate-value  | 14/14                             | 10/10                      | 1/1               | 30/61                                      | x: 0 / 80 / 160 px                 |
| animate-dom    | 14/14                             | 10/10                      | 1/1               | 0/61                                       | opacity: 0 / 0.5 / 1               |
| animate-spring | 14/14                             | 10/10                      | 1/1               | 30/61                                      | x: 0 / 165.83724975585938 / 160 px |
| sampled-spring | 14/14                             | 10/10                      | 1/1               | 30/61                                      | x: 0 / 165.83724975585938 / 160 px |

Each held-time check keeps time at 0.5 s across three additional `postRender` acknowledgements. Start/end assertions and differing start/midpoint PNGs reject a blank/constant-output false positive. Each row captures 35 PNGs, with **25 exact comparisons and zero mismatches**. Total: **150/150 controlled comparisons**, 210 controlled screenshots, plus eight negative-control screenshots = **218 captures**. PNG bytes are compared in the same run; there is no perceptual tolerance or cross-platform golden image.

The four negative controls traverse frames 0–30, then compare the frame at 1 s with a fresh mount at 1 s. The target/visibility switches at 0.5 s. Presence/layout/autonomous transitions intentionally last 100 s to expose in-flight state instead of accidentally finishing during capture. Live `useSpring` uses stiffness 10 and damping 2. All four produced both DOM and PNG mismatches:

| Negative control   | Sequential observation at 1 s                            | Fresh mount at 1 s        |
| ------------------ | -------------------------------------------------------- | ------------------------- |
| AnimatePresence    | 1 retained exiting node, left ≈ 0.449600 px              | 0 nodes                   |
| layout             | left ≈ 0.452805 px, projection transform x ≈ −159.547 px | left 160 px, no transform |
| useSpring          | left ≈ 50.475998 px                                      | left 160 px               |
| autonomous animate | left ≈ 0.450240 px                                       | left 160 px               |

These uncontrolled numeric values are observations from the final run, **not reproducible golden values**. Their differing results are the counterexample. The test asserts mismatch, not these exact decimals. Two full measured runs after adding held-frame/endpoint checks passed 10/10 tests in **29.42 s** and **29.38 s**; the latter also asserts native animation state. Earlier exploratory runs passed before those checks were added, but are not used for the table.

## How DOM completion is detected

1. Mount/update React synchronously using `flushSync`. Initial mounting and control creation each await a Motion `frame.postRender` acknowledgement, allowing keyframe resolution to run before seeking.
2. Compute the value from the supplied time, or pause playback and set `.time`. Do not resume autonomous playback. Fresh spring evaluation receives milliseconds; playback controls receive seconds.
3. Register a one-shot `frame.postRender` callback after the update and await it. This acknowledges Motion's render phase, not elapsed timeline time. The browser's real rAF services this queue; no fixed sleep, global clock patch, or internal Motion API is used.
4. Read computed transform/opacity and geometry **before** Playwright capture and compare them independently. This prevents screenshot waiting alone from concealing stale DOM. The native opacity case additionally verifies a paused Web Animation at the requested time.
5. Capture the fixed-size crop with `animations:'allow'`; never fast-forward or disable the animation to manufacture a match. Compare the PNG bytes against sequential captures.

For these solid DOM fixtures, the barrier plus capture worked. `postRender` does **not** claim all React effects, nested queue work, fonts/images, GPU compositing, layout projection, or exit lifecycles have completed. Animation `finished`/`onAnimationComplete` would describe the animation's end, not readiness at an arbitrary paused frame, so neither is used. The uncontrolled tests wait an extra render acknowledgement only to observe in-flight state; no completion guarantee is claimed for C.

## Reproduction and dependency audit

Use the [README commands](../../../../spikes/a-motion/README.md). `pnpm spike:motion` prints machine-readable measurements and fails on a controlled mismatch or missing negative counterexample. It is **not in `pnpm test`**: ~29 s locally leaves no demonstrated margin under the ~30 s CI threshold, and browser provisioning/negative-control timing are not CI-qualified. Existing CI gains no browser job or screenshot execution; dependency installation/typecheck overhead is not yet separately measured.

Before installation, package registry license metadata was checked against `scripts/check-licenses.ts`. Added direct devDependencies:

| Package                    | Version | License    |
| -------------------------- | ------- | ---------- |
| react                      | 19.3.1  | MIT        |
| react-dom                  | 19.3.1  | MIT        |
| motion                     | 14.6.0  | MIT        |
| playwright                 | 1.64.1  | Apache-2.0 |
| @vitest/browser-playwright | 5.0.5   | MIT        |
| @types/react               | 19.3.0  | MIT        |
| @types/react-dom           | 19.3.0  | MIT        |

No direct dependency needed a license decision. `pnpm licenses list --json` also reviewed the installed dev tree: Motion's transitive framer-motion/motion-dom/motion-utils are MIT, Playwright Core is Apache-2.0. The pre-existing Vite tooling includes MPL-2.0 lightningcss; this spike does not introduce it or ship it. Production dependencies contain `zod:4.6.7`; the spike adds no production dependency, and the normal license check checks production only. Playwright downloads browser tooling separately; Chromium is not included in the published package. React peerDependency promotion remains TASK-149.

## Open risks and decisions

- **Integration scope is still a product/API decision:** adopt only external values first, or also expose the tested paused playback paths? The Phase 0 ADR resolves the tier boundary; public API selection remains Phase 2 work.
- **Completion contract is not universal:** the accepted Phase 0 ADR now specifies clock coordination, asset/React barriers, bounded timeout/diagnostics and frame identity. Production implementation must not reuse this fixture's bare promise.
- **Spring semantics:** settle thresholds snap to the endpoint; only one parameter set/initial velocity was tested. Validate negative time, other damping regimes, explicit start, retarget position/velocity and reused generator behavior before implementing the full Pure Motion contract.
- **Coverage:** no variants, gestures, SVG, color interpolation, multi-property timelines, repeat/delay, interruption, callbacks, velocity-driven subscribers, StrictMode, Suspense, multiple concurrent roots or cross-process captures. Explicit keyframes avoid implicit start-value history; that history is not solved.
- **Environment:** same-browser exact pixels do not promise cross-OS/GPU equality. Linux timing was measured once, 5/5 on `ubuntu-latest` in 29.48–30.06 s ([record](../../render/knowledge/20261031-linux-spike-qualification.md)); Motion upgrades require reruns. Counterexamples are deliberately real-time and may fail under extreme stalls; they are not put in the default suite.
- **Tier C policy:** unsupported presence/layout/live animation should remain available with warnings, not silently rewritten or treated as A. Whether to build a future explicit-time lifecycle/projection integration is open, not decided by this spike.
