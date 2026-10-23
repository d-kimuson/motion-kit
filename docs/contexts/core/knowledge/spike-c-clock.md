# Spike C: own presentation time; await work without advancing it

Choose **motion-kit's own explicit clock plus integration-specific seek/readiness adapters**, shared by preview and the Browser Renderer. Neither controlling rAF callbacks nor advancing CDP virtual time is a substitute for that clock. The chosen candidate reproduced **21/21 exact DOM + PNG comparisons**. Own clock and controlled rAF are **indistinguishable within run-to-run variance**: their per-repetition mean costs span **41.66–45.72 ms** and **41.43–44.53 ms**, respectively. CDP virtual time is consistently more expensive (roughly **60–70% overall** in this workload; **68.08–70.58 ms**), cannot rewind its consumed budget, and advances time while awaiting timer/media work. Correctness, not an own-clock-before-rAF speed ranking, drives the decision.

This is an accepted **strategy**, not a shipped runtime or a guarantee for arbitrary integrations. The [cross-context ADR](../../../decisions/20261023-explicit-browser-clock.accepted.md) records the decision; TASK-151 consolidates it with the other spikes. [Experiment and reproduction commands](../../../../spikes/c-clock/README.md).

## Comparison and decision

All three candidates run the same React/CSS/rAF/video fixture in separate pages. First measure bare clock control; then give **each** candidate identical CSS and video adapters. React has both an explicit state-injection probe and a clock-reading render; rAF has both timestamp-only and independently clock-reading consumers. This distinction matters: a controlled rAF timestamp **can** drive pure animation and React state. Its failure below is specifically failure to synchronize the other clock readers, not an assertion that React requires monkey-patching.

| Mechanism, with common CSS/media adapters | Random/repeated DOM + PNG | Fresh-page DOM + PNG | Held DOM + PNG                              | Range of repetition means per frame (six repetitions) | Decision                                               |
| ----------------------------------------- | ------------------------- | -------------------- | ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| Own injected clock + controlled rAF       | 12/12                     | 8/8                  | 1/1; zero extra callbacks                   | **41.66–45.72 ms**                                    | Choose explicit time ownership and adapters            |
| Controlled rAF only                       | 0/12                      | 0/8                  | 1/1; zero extra callbacks                   | **41.43–44.53 ms**                                    | Keep as an integration scheduler, not the master clock |
| CDP virtual time                          | 0/12                      | 0/8                  | 0/1; 14 extra callbacks in the original run | **68.08–70.58 ms**                                    | Reject as shared runtime clock                         |

The own/rAF bands overlap and their ordering reverses between repetitions; cost is a **secondary, non-discriminating observation** between them, not a statistical equivalence test. CDP costs about **60% more than own clock and 63% more than controlled rAF** using the six-repetition averages; paired repetition premiums span **54–70%**, so “roughly 60–70%” is not a per-run bound. Correctness and separation of presentation time from asynchronous scheduling decide between own clock and controlled rAF. CDP's additional budget servicing contributes to its cost; this is not a claim about every possible CDP configuration.

### Capability per integration

Times below are milliseconds unless the cell says seconds. The target is **500 ms**. “Adapter” means explicit control in addition to the candidate clock, not automatic browser behavior.

| Integration / observable                                                                       | Own clock                              | Controlled rAF only                          | CDP virtual time                                 |
| ---------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Explicit React state injection + commit acknowledgement                                        | 500, pass                              | 500, pass                                    | 500, pass                                        |
| Clock-reading React, common-adapter sequential run                                             | 500                                    | 130.70, not target time                      | 500 at commit; clock later advances              |
| `performance.now()` / `Date.now()` relative to the injected/calibrated epoch, after settlement | 500 / 500                              | 138.90 / 139                                 | 540 / 540                                        |
| rAF callback timestamp / independent clock read inside callback                                | 500 / 500                              | 500 / 131                                    | 163.90 / 300; not a frame at the budget boundary |
| Bare CSS Animation / CSSTransition current time, no adapter                                    | 50.09 / 50.09, not 500                 | 33.31 / 33.31, not 500                       | 16.63 / 16.63, not 500                           |
| Paused CSS Animation + CSSTransition `currentTime` adapter                                     | 500 / 500; x=50 px                     | 500 / 500; x=50 px                           | 500 / 500; x=50 px                               |
| Bare paused `<video>.currentTime`, no seek adapter                                             | 0 s                                    | 0 s                                          | 0 s                                              |
| `video.currentTime=0.5` + `seeked`, with adapter                                               | 0.5 s, readyState 4                    | 0.5 s, readyState 4                          | 0.5 s, readyState 4, needs budget servicing      |
| Registered promise → 5 ms timer → microtask → DOM update                                       | Settled at unchanged presentation time | Settled; independent clocks continue running | Settled only after further virtual budgets       |
| Pure promise/microtask chain, explicitly awaited                                               | Pass                                   | Pass                                         | Pass even while paused                           |

CSS/transition times and video current times are additionally asserted at **all eight sequential samples per candidate**, not just the midpoint. The own clock's React, `performance.now`, `Date.now`, rAF timestamp and rAF clock read equal the requested time at all eight. Raw CSS values are real-time observations, **not golden expectations**. No candidate automatically seeks CSS or paused media. This paused-video probe deliberately does not purport to measure autoplay, playback drift or audio.

The native CDP clock is calibrated **after** pausing, so these differences are not an uncorrected page-load epoch offset. Bare CDP React reads 499.90 ms at the 500 ms target, then 509.90 ms after servicing the timer; the 0.1 ms precision is browser clock quantization. The consequential failure is asynchronous time advance and lack of rAF/CSS frame synchronization, not that tiny rounding error.

## Mechanisms and frame protocol

### Own clock

The page holds an explicit millisecond snapshot. For this compatibility experiment, `performance.now()` returns it and `Date.now()` returns a fixed epoch plus it. A replaced rAF queue is stepped once with the same timestamp; callbacks queued during a step run on the next step. Timers are **not** virtualized: they can complete real asynchronous work while presentation time remains frozen. This is not a complete browser-time emulator: `new Date()`, worker clocks, cached native functions and native animation/media timelines remain untouched.

Production should expose time explicitly to React/integrations rather than make ambient clock reads the public contract. The separate explicit React injection verifies that route too. Clock shims, if needed for an identified integration, belong in an isolated composition realm and require capability tests. Never patch the preview UI's host clock. Unknown consumers remain Tier C; injecting time cannot undo accumulated state.

### Controlled rAF

Use exactly the same manually stepped queue but retain native `performance.now()` and `Date.now()`. Timestamp-only callbacks receive the target correctly; the adjacent clock-reading callback does not. Stopping the queue freezes both rendered boxes, explaining its successful hold test, but resuming at a requested timestamp does not change a consumer's independent clock.

An explicit-time React/CSS/media runtime could be built around that queue. It would need a persistent supplied-time value for non-rAF consumers: that is the **own-clock strategy**, with rAF as one adapter. This candidate is not rejected as a useful mechanism inside an integration, only as a sufficient master clock by itself.

### CDP virtual time

Attach a Playwright CDP session to the fixture page; pause via `Emulation.setVirtualTimePolicy`, calibrate its clock origin, and advance positive budgets to the target. Await `Emulation.virtualTimeBudgetExpired`. Start `Runtime.evaluate` with `awaitPromise:true` for registered settlement. Advance additional **10 ms** budgets until that promise resolves, bounded by 1,000 attempts and a host-side 10 s pumping deadline. Each protocol budget wait also has a 10 s deadline.

A single budget is insufficient when decoding posts work from another thread after budget expiry: an exploratory single-budget implementation hit the 10 s host timeout at the 100 ms video seek. The final implementation pumps until **readiness**, not a fixed budget count. In the measured sequential run it consumed an extra **[10,30,50,40,20,30,70,130] ms** beyond the eight requested times. At 500 ms the page clock reached 540 ms to settle the requested frame. These extras vary with scheduling/decoding; they cannot be subtracted in advance as a constant offset.

The driver marks **10/12** random/repeated requests unsupported because their target is behind the already-consumed virtual budget. It leaves the virtual clock where it is and records the resulting comparison; it does **not** pretend to rewind or secretly reconstruct the page. The separate eight fresh-page attempts also fail complete equality, so a fresh page alone does not repair rAF/compositor scheduling in this implementation. QA tested a finer **5 ms** budget and an alternate policy without reversing the conclusion; the repeated measurement here retains the original **10 ms** budget and `advance` policy. Replay from zero, `HeadlessExperimental.beginFrame` and different Chromium builds remain unmeasured alternatives, not impossible in principle. They would still introduce renderer-only machinery that an ordinary preview cannot use.

During the 80 ms real-time hold, CDP's native rAF continued to receive callbacks despite paused virtual time. Its callback timestamps and clock reads were not a single synchronized input. Budget expiry is therefore **not** a render acknowledgement in this browser configuration.

### Common adapters and settlement

1. Mount/update React with `flushSync`; a `useLayoutEffect` records the committed state. This is one root, without Suspense or concurrent rendering.
2. Create an actual stylesheet CSS Animation and an actual style-triggered CSSTransition. Force style resolution so both exist; pause each and assign `Animation.currentTime`. Explicit endpoints avoid implicit prior-layout values. Arbitrary transition lifecycle reconstruction is not covered.
3. Manually drive the rAF queue for own/rAF, or observe native rAF under CDP. The two visible bars distinguish callback time from an independent clock read.
4. Register and await the known asynchronous update (promise → timer → microtask). Await the video seek only after its `seeked` listener is registered; check `seeking=false`, `readyState>=2` and the requested `currentTime`. Initial media/font readiness is awaited before measurements.
5. Read markup and computed state, then capture a fixed 320×240 clip with Playwright and `animations:'allow'`. No locator-stability rAF waits, animation disabling, fast-forwarding, pixel tolerance or golden images.

The barrier awaits **registered work**, not “all promises in the page.” A resolved `Promise.resolve()` or `awaitPromise:true` cannot find unrelated future tasks. Production needs frame identity/generation, timeout, cancellation and diagnostics; this spike's thrown contract failures are not that API.

## Awaitability and negative controls

| Check                                                               | Result                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Explicitly awaited promise/microtask chain                          | 3/3 candidates returned the expected value                           |
| Rejected readiness promise                                          | 3/3 reported protocol exception details; no swallowed rejection      |
| Never-resolving readiness promise                                   | 3/3 hit the host's 50 ms deadline, observed 50.85 / 51.28 / 51.30 ms |
| CDP 5 ms timer, virtual time paused for 30 ms real time             | Still pending; resolves after an explicit 10 ms virtual budget       |
| Skip CSS adapter                                                    | DOM and PNG mismatch detected                                        |
| Skip video adapter                                                  | DOM and PNG mismatch detected                                        |
| Accumulate absolute rAF clock reads rather than overwrite from time | DOM and PNG mismatch detected                                        |
| Skip registered external readiness gate                             | DOM and PNG mismatch; timer marker still −1 before capture           |
| Release that gate and await registered work                         | DOM and PNG recover the valid reference frame                        |

The four controls compare a valid fresh 500 ms reference with the faulty implementation after `[0,2000,500]` ms. Each also captures the intermediate frames. They demonstrate that a clock override is not enough, that video really changes the image, and that screenshot waiting alone is not a readiness barrier. The gate deliberately stays unresolved until released; this avoids a flaky “sleep briefly and hope the capture wins the race” control. Distinct start/end PNGs are asserted for every candidate to reject blank/constant output.

## Measurement method and environment

Measured **2026-10-23 UTC**, macOS **26.5.1** arm64, **Apple M3 Pro**, Node **26.12.0**, pnpm **12.15.0**, React/React DOM **19.3.1**, Vitest/browser provider **5.0.5**, Playwright **1.64.1**, pinned Chromium headless shell **156.0.8078.4** (revision 1248). Headless, normal Playwright launch defaults, 640×480 viewport, DPR 1; no GPU-specific flags added. The video is the committed generated VP8 fixture, not a network asset. No new dependency or license exception was needed; existing exact-pinned devDependencies are reused.

Ascending samples are `[0,100,250,500,750,1000,1500,2000]` ms. Fast-check seed **145** gives `[1000,750,100,500,250,2000,0,1500]`, followed by `[2000,0,500,500]`. Fresh means a **new page, JS realm, React root and video** for each selected time, sharing the browser context/process and warmed Vite/module cache. This is eight ascending samples, not a full 30 fps traversal. The fixture conversion from milliseconds to media seconds is experimental input, not a replacement Time Module.

DOM equality includes actual host markup and serialized committed React state, rAF clock value, animation current times, computed transforms, media time/seeking state and asynchronous completion markers. It intentionally excludes diagnostic wall-clock reads and callback counts that are not rendered; callback timestamp motion is still present in the markup and pixels. PNG equality compares raw bytes in the same run, never against another OS/browser's output.

Each invocation runs **three serial repetitions** of the unchanged full comparison, with fresh fixture pages but the same browser context/process and warmed module cache. Each candidate's **28 measured captured frames per repetition** comprise eight ascending, twelve random/repeated and eight fresh-page captures. Host `process.hrtime.bigint()` measures from immediately before seek through readiness, DOM inspection and completed PNG capture. Exclude page construction, initial media load, raw probe, held frames and negative controls. Include protocol/screenshot overhead and timer/media waits; these are **end-to-end frame costs**, not isolated React/CSS/video CPU costs. Per-repetition JSON retains individual frame costs and mean/population variance/standard deviation (variance divides by N). The comparison tables instead use the **min/max of the repetition means**, not within-run frame dispersion or confidence intervals.

Two successive `pnpm spike:clock` invocations produced these mean costs (ms per captured frame):

| Invocation / repetition | Own clock       | Controlled rAF  | CDP virtual time |
| ----------------------- | --------------- | --------------- | ---------------- |
| 1 / 1                   | 42.51           | 42.32           | 68.96            |
| 1 / 2                   | 41.66           | 42.02           | 70.58            |
| 1 / 3                   | 43.07           | 41.43           | 70.30            |
| 2 / 1                   | 43.42           | 44.05           | 68.08            |
| 2 / 2                   | 43.76           | 42.20           | 69.21            |
| 2 / 3                   | 45.72           | 44.53           | 70.25            |
| Observed band           | **41.66–45.72** | **41.43–44.53** | **68.08–70.58**  |

All six repetitions reproduced the order/fresh/hold outcomes and four negative controls, including readiness-gate recovery; CDP had 10/12 unsupported reverse requests and 13–14 extra held-frame callbacks. Vitest durations were **38.83 s** and **39.10 s**. QA's earlier independent runs likewise reversed own/rAF ordering: **42.85 / 40.51 / 67.96 ms** and **40.85 / 41.37 / 66.25 ms** (own/rAF/CDP). These are observations, not a claim that the small own/rAF difference is significant.

The original optional inspection PNG visibly contains all five aligned blue rows at x=50 and a changing colored video pattern marked 00:00:00.500, not a blank image. The integration table, raw clock readings and extra-budget array above remain observations from that original run, not new timing expectations.

Each repetition has **110 captures**: 31 per candidate (28 timed, one raw, two held), sixteen negative-control frames and one gate-recovery frame. With the optional inspection PNG it has 111 captures (the same path is overwritten per repetition). The command captures **330 images**, or 333 with inspection. One JSON report contains all three `repetitions`, including individual costs and sequential observations, plus `costRanges` with each mechanism's `meansMs`, `minMeanMs` and `maxMeanMs`; preserve stdout when reproducing measurements.

This script remains **outside `pnpm test`**; three repetitions now take about 39 s locally. Browser provisioning, Linux stability and CI runtime have not been qualified. No browser CI job is added. The package exports/files are unchanged; `spikes/` is not shipped.

## Verification and residuals

`pnpm fix`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (**86 tests**) and two `pnpm spike:clock` invocations pass. The comparison table uses all six repetitions above; no single run supplies a cost ranking. `pnpm pack --out /tmp/motion-kit-spike-c.tgz` plus `tar -tzf` confirmed the archive contains only the existing shipped source, metadata, README and license, with no spike files. No `.lean` file changed. `lake build` built the missing oracle locally in this worktree; no binary was copied from another checkout. Initial implementation failures were useful counterexamples (CDP's paused-media deadlock and a timing-racy missing-barrier check); the final driver has bounded budget pumping and a deliberately gated readiness control instead.

- **Not universal clock emulation:** `new Date()`, cached native clocks, workers, iframes and third-party schedulers are untested. Backward `performance.now()` breaks its normal monotonic contract. Prefer explicit time; independently validate any scoped shim against its library's scheduler. Do not silently classify unknown consumers as controlled.
- **Integration scope:** no Motion/R3F joint scene, nested React roots, StrictMode, Suspense, concurrent effects, animation event listeners, dynamically created transitions, GPU work, external fonts/images/models or failing media decode. Spikes A/B establish separate finite integration results; this experiment does not combine them into a universal barrier. TASK-151 and Spike D remain necessary.
- **Video scope:** `seeked`, currentTime and exact observed pixels are tested on one short 10 fps VP8 clip. Frame-index accuracy, `requestVideoFrameCallback`, VFR, other codecs, audio, reverse playback, playbackRate/other speed settings and media resource limits remain open.
- **Timeline scope:** eight samples through two seconds, one composition per page. Long compositions, many repeated seeks, fractional-rate production timelines, negative/out-of-range times and time-scaling are not certified.
- **Portability:** no headed run, Linux CI, Firefox/WebKit, browser upgrade matrix, cross-process/cross-machine pixel comparison, high-DPR/4K scene or browser sandbox/security analysis. Chromium defaults are for a trusted local fixture, not an untrusted composition policy.
- **Benchmark limits:** 28 frames per mechanism per repetition, three serial repetitions per invocation, fixed candidate order and warmed caches on one host; no confidence intervals, equivalence test or per-integration latency isolation. Screenshot overhead dominates; absolute costs and variance are not service-level guarantees.
- **Preview/API:** the page-side own clock and adapters use browser APIs available without CDP, but no preview player/scrubber is implemented. The accepted requirement is to reuse that runtime; UI scheduling, overlapping seeks, stale completions, cancellation and user-facing diagnostics still need implementation and tests.
