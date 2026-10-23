# Own time explicitly and capture only an acknowledged frame

## Context

Status: **accepted**. TASK-151 closes the Phase 0 design gate, not the production implementation gate. The random-seek mechanism is explicit time plus integration adapters; the [Seekability table](../contexts/core/CONTEXT.md#seekability) defines the measured A/B/C boundary; the four spikes verify a basic capture procedure within their pinned environments. A combined production runtime and Linux qualification remain work for Foundation.

This decision follows the [context map](../CONTEXT-MAP.md): core owns time and library-neutral asset state, motion/three own their integrations, render owns browser lifecycle and capture, and agent owns the Diagnostic vocabulary. Inputs:

- [Spike A: Motion](../contexts/motion/knowledge/spike-a-seekability.md): **150/150** controlled DOM/PNG comparisons; five paths had **30/61** stale immediate reads despite React commit.
- [Spike B: R3F](../contexts/three/knowledge/spike-b-seekability.md): **25/25** order/fresh/hold comparisons; **4/4** history-dependent controls failed as intended; **8/8** preserved-buffer screenshots agreed with GPU readback.
- [Spike C: clock](../contexts/core/knowledge/spike-c-clock.md): own clock **20/20** order/fresh plus **1/1** hold; controlled rAF and CDP **0/20** in the spike's six repetitions. An independent QA check of PR #8, recorded in TASK-145, observed controlled rAF **1/20** once, matching the fresh 0 ms frame. Zero matches is not an invariant; full-scene correctness still selects the own clock.
- [Spike D: assets](../contexts/render/knowledge/spike-d-assets.md): **32/32** settled comparisons; four delayed asset controls and four Suspense fallbacks had wrong pixels; **4/4** load failures and **4/4** never-settling cases were diagnosed, plus context loss before texture upload.

All measurements are macOS arm64, using pinned Chromium 156.0.8078.4 / Playwright 1.64.1. Exact comparisons are within one environment/run, not cross-platform guarantees. The accepted [clock strategy](20261023-explicit-browser-clock.accepted.md) and [asset registry strategy](20261023-asset-readiness-registry.accepted.md) remain in force. This ADR resolves and supersedes the [Motion proposal](../contexts/motion/adr/20261023-explicit-motion-seeking.superseded.md) and [R3F proposal](../contexts/three/adr/20261023-explicit-r3f-advance.superseded.md).

## Decision

### Shared clock and ownership

Use motion-kit's own explicit Presentation Time, computed by the Time Module from Global Frame and rational FPS. Preview and the Browser Renderer use the **same page-side seek/commit/settle runtime** and integration protocol. Preview's rAF selects when to request a time; render requests an output frame. Neither supplies a second integration clock. No preview player is claimed to exist yet.

Freeze the requested Presentation Time while real asynchronous work proceeds. Scheduling rAF, host deadlines and asset I/O do not advance that snapshot. rAF is an adapter's queue-service mechanism, not the master clock. CDP virtual time is neither the master clock nor the readiness signal. Prefer explicit inputs; ambient clock shims are not the public contract. Any future shim needs integration-specific qualification inside the composition realm, never the preview host. Workers, cached clocks and unknown consumers are not implicitly controlled.

core does not import Motion, three, render or agent. Adapters expose library-neutral acknowledgements and Diagnostics; no renderer/scene/library objects cross the boundary into core/render. Three-specific work remains in three. Foundation implements this protocol and basic React/asset support, not the Phase 2 Motion API or later ThreeCanvas/CameraRig helpers.

### Seekability boundary

A is stateless value evaluation from time and fixed parameters. B is a verified integration path with explicit time, disabled autonomous progression, and frame-specific settlement. C includes hidden history and independent clocks; it remains usable with a `seek.uncontrolled` warning, not a determinism guarantee. Unknown components are never inferred A or B.

- Motion DOM bindings are B, including numeric styles and a pure spring's rendered expression. External MotionValue writes require no velocity/history dependence and no live animation. Paused controls require explicit starting keyframes, disabled autonomous playback and absolute `.time` assignment. A fresh fixed-input spring evaluator is A for values only. API exposure of the paused paths is deferred, not implicitly approved by their classification.
- A supported Motion adapter acknowledges initial mount/control creation and every subsequent update through public `frame.postRender`, after React commit and the supplied value/time update. Queue service must leave Presentation Time unchanged. This is Motion render settlement, not all DOM/assets/effects.
- Supported R3F paths use `frameloop="never"`, a stopped clock, no independent three animation loop, and **root-local** `advance(timeInSeconds, false)`. Camera, transforms and uniforms overwrite all animated state from absolute time. A scene acknowledgement precedes its first advance; unrelated canvases/global effects are not advanced. Delta integration, damping, prior camera pose, physics and temporal feedback are not made seekable by Manual Advance.
- Live `useSpring`, AnimatePresence, layout projection and autonomous Motion animation are structurally C in their tested forms: their output requires prior state or lifecycle/layout history, not just the target time. An explicit-time replacement would require a separately verified design, not simply finishing an omitted wrapper.

The [core table](../contexts/core/CONTEXT.md#seekability) enumerates the individual features and unverified cases. Standard Animate/Reveal/Stagger are not blanket-certified A before implementation; a Motion DOM-backed implementation follows B.

### Readiness barrier contract

This is an observable contract for TASK-154, TASK-157 and TASK-158, not permission to copy a spike's bare promise or single-resource `Promise.all`.

1. **Identify and own the request.** Each request carries the composition instance/revision, Global Frame, rational FPS and derived Presentation Time, plus a monotonically increasing request generation. Repeated requests for the same frame are distinct generations. All React, asset and integration acknowledgements belong to that generation and the current registration/source versions. Permit only one mutable frame operation per composition realm; queue renderer requests, and cancel/supersede old preview requests before servicing the new one. Separate realms may run independently.
2. **Start a bounded host deadline.** Before seek work, require a finite positive configured whole-frame timeout measured by a monotonic host clock, independent of Presentation Time. It includes acquisition, commit/discovery iterations, integration/GPU settlement and screenshot RPC completion. A finite default must be documented by the implementation; Spike D's 5 s fixture default is not a measured production limit. No phase resets the overall deadline.
3. **Set time and discover resources.** Publish the snapshot and update the React tree. Register/cache assets before consumers can suspend, outside effects that cannot run in a suspended subtree. Await required acquisitions/decode/upload registrations, retaining failure and source identity. A fallback commit is not a content acknowledgement. Required fonts need individual load/status checks as well as applicable font-set settlement; images use `decode()`.
4. **Commit and settle integrations.** Require content commit acknowledgements for this request, then explicit integration updates and their render acknowledgements. Models being parsed or texture sources being decoded does not establish upload/submission or a rendered GPU frame. Await the registered current resource version, shader/scene work and submitted GPU work through the owning integration. Do not infer completion from `flushSync`, one rAF, animation-end events, network idle or screenshot waiting.
5. **Drain until stable.** A commit or adapter may discover more work. Recheck registrations, source versions and request identity; await and recommit/settle until the current generation has no pending required work and all acknowledgements correspond to it. Changing sources invalidate earlier acknowledgements. A resource graph that never stabilizes times out; an arbitrary fixed number of microtasks is not success.
6. **Capture under the same ownership.** Freeze the snapshot and keep exclusive ownership through screenshot completion. Recheck request/resource generations before capture and before publishing bytes. If they change, discard those bytes and settle again within the original deadline. Only a current, successful frame may be published or passed to the Encoder. Layout inspection may run on this settled frame, using the existing `layout.*` codes, but is not a replacement for readiness.
7. **Cancel without publishing.** Caller abort, preview supersession, or composition disposal invalidates the generation immediately, detaches callbacks, aborts cancellable work and releases registrations owned only by that request. Late completions cannot satisfy a new request. Shared cached resources may survive only for live owners. Cancellation returns a distinct aborted control-flow outcome with no frame; it is not a successful render and is not mislabeled a timeout. It emits no Diagnostic because the current schema has no cancellation code and caller intent is not a domain failure. A future CLI cancellation envelope requires its own contract decision, not an invented code here.

A synchronous GPU call such as `gl.finish()` cannot be interrupted by an in-page promise race. TASK-157 must enforce the outer deadline/cancellation from the host, discard late screenshot results and close/recycle an unresponsive page/context (escalating browser termination if necessary). A timed-out or canceled realm is not reused while old work can still mutate it. Timeouts never mark pending resources ready.

### Failure diagnostics

Use [DiagnosticSchema](../../src/lib/diagnostic.ts) and the [CLI contract](../contexts/agent/adr/20261024-cli-output-contract.accepted.md#diagnostic), not the spikes' local failure types. No new codes or code-specific details payloads are introduced here.

| Outcome                                                                                                                                                   | Diagnostic and publication rule                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required font/image/model/source load, parse/decode or texture upload/context-loss failure                                                                | `asset.load-failed`, error; no frame.                                                                                                                          |
| Deadline with known pending required asset acquisition/decode/upload registrations                                                                        | `asset.not-ready`, error; no frame. List every pending registration in `details.assets` and the configured readiness deadline duration in `details.timeoutMs`. |
| Deadline without known pending assets: content commit, registration stabilization, adapter acknowledgement, GPU completion or capture/RPC does not finish | `render.frame-timeout`, error; no frame. If the page is unresponsive, use this rather than inventing an asset inventory.                                       |
| Detected history-dependent or independently clocked integration                                                                                           | `seek.uncontrolled`, warning; rendering is allowed, but the output is not certified deterministic. A separate readiness failure still prevents capture.        |
| Uncaught page exception / browser launch failure                                                                                                          | `render.page-error` / `render.browser-launch-failed`, error; no frame. Unexpected implementation bugs remain `internal.unexpected`.                            |
| Settled-frame layout findings                                                                                                                             | Existing `layout.overflow`, `layout.out-of-frame`, `layout.unexpected-scroll`, `layout.font-not-loaded`; not substitutes for an asset load failure or timeout. |
| Caller cancellation, supersession, disposal                                                                                                               | Aborted control-flow outcome, no Diagnostic and no frame; late completions ignored.                                                                            |

For errors/warnings supply a one-sentence public message and actionable hint, plus known composition/scene/frame/time in `location`. Asset entries include kind, redacted source and phase; texture entries name the source image and relevant `relatedSources`. Redact credentials and sensitive query parameters; never expose raw loader exceptions/stacks. Do not add undocumented details to `render.frame-timeout` or `seek.uncontrolled`.

### Capture environment and GPU baseline

For the **qualified trusted software fixture**, use pinned Chromium/Playwright, fixed viewport/crop and DPR, `preserveDrawingBuffer: true`, no independent loop, explicit rendering followed by `gl.finish()` and capture with `animations: 'allow'`. Verify the actual backend with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. This is a conservative working reference, not proof that each flag or the fence is necessary or fastest. Readback can validate screenshot ownership; it is not automatically required for every production frame.

Do not silently inherit these launch defaults for untrusted compositions. The Browser Renderer security task must decide trust modes, Chromium sandboxing and OS isolation, filesystem/credential boundaries and externally enforced network policy. The unsafe-software flag and Playwright's `--no-sandbox` are not production authorization. Context/page separation is not a host security boundary.

Preserved default buffers are the measured baseline, not a permanent public API. A render-target/readback replacement must establish ownership and composition correctness before replacing it. `gl.finish()` only fences submitted work; it neither preserves a buffer nor discovers future asset/shader work.

## Consequences

Phase 0's design exit criteria are met by the strategy, feature boundary and finite capture evidence above. This is not Linux certification, universal seekability, a shipped preview, or a combined Motion/R3F runtime test. TASK-153 designs loading/isolation around the shared runtime; TASK-154 implements explicit time and request ownership; TASK-157 implements host deadlines/capture; TASK-158 implements library-neutral resource discovery and settlement. Their descriptions must link this ADR before TASK-151 is marked Done.

The user-owned design.md needs updates to §5.4's A/B/C claims, §9's linear readiness flow and Suspense wording, and §11's DOM/GPU completion/environment assumptions. §5.1's shared runtime remains a requirement now selected by C/D, not an implementation proven by A/B. §17 can move from starting spikes to Foundation planning without widening Foundation into Motion/Three APIs.

### Residual risk handoff

The following entries are **Backlog filing specifications, not filed task IDs**. TASK-151's supervisor must create/link them and link this ADR from TASK-151. Until then administrative closure is pending. Each stable anchor is the link target to replace or augment with the filed task URL. P2 entries are Phase 1 qualification; P3 entries carry **Phase 2** as the earliest planning note, including work belonging to later roadmap phases. None of the P3 work is started here.

#### R1 — Qualify the spike suites on Linux CI

**Priority: P2.** Run all four pinned browser suites and the eight-profile R3F matrix on Linux with Playwright system dependencies and the explicit trusted SwiftShader profile. Record actual backend, negative controls, repeated-run stability, runtime and provisioning costs; keep browser work outside the default test budget until measured. All current evidence is macOS arm64; A is near and C exceeds the local ~30 s budget. Verify retained output and a repeatable dedicated CI job or a documented reason it cannot yet be enabled. Read all four reports and Capture environment above.

#### R2 — Decide GPU barrier cost and framebuffer ownership

**Priority: P2.** Compare preserved default buffer + finish, synchronous readback and explicit render-target/readback ownership under larger scenes and queue pressure. Isolate fence/readback latency from screenshot RPC cost; verify current pixels after delayed capture and pending uploads/shader submission. Recommend the conservative reference until an alternative proves ownership/composition correctness; document the selected renderer contract and regression tests. Read B/D and Capture environment. No-fence matches do not establish a minimal barrier.

#### R3 — Define and enforce Browser Renderer isolation

**Priority: P2.** Decide trusted/untrusted modes and sandbox/unsafe-SwiftShader policy before shipping the launcher. Compare trusted local convenience with sandboxed, OS-isolated untrusted execution; recommend no unsafe flags by default for untrusted content. Exclude host credentials/unnecessary files and enforce network restrictions outside composition code, including redirects, resolved addresses, nested assets and workers. Verify adversarial network/filesystem cases and termination/resource limits; record the decision. Read B/C/D and Shared clock / Capture environment. Browser contexts are not security sandboxes.

#### R4 — Qualify frame generations and dynamic readiness together

**Priority: P2.** Verify the TASK-154/157/158 implementation against the contract with overlapping/superseded requests, repeated frames, stale callbacks, source changes, late/nested Suspense discovery, cached registrations, retry and disposal. Exercise rejected and never-settling work, hung GPU/browser RPCs, sanitized diagnostics, and timer/microtask work while time is held. Include long/fractional-rate timelines, many seeks and invalid/out-of-range requests under the Time Module rules. Acceptance: no stale/fallback bytes published, bounded host termination and the exact failure mapping above. Read C/D and Readiness barrier; this verifies Foundation rather than requiring public Motion/Three APIs.

#### R5 — Bound renderer resource lifetimes

**Priority: P2.** Stress sustained repeated jobs, cancellation, asset-cache eviction and browser/page/context disposal. Measure memory/resource growth and establish enforceable job/resource limits; verify teardown after timeout/context loss without callbacks mutating the next job. Fresh roots in B/D are not sustained-session evidence. Read B/C/D and Readiness barrier; implement baseline safe disposal, not general GPU context recovery.

#### R6 — Decide the supported Motion integration API

**Priority: P3. Phase 2.** Choose external values/numeric styles only versus also exposing tested paused playback controls; compare smaller API/scheduler surface with richer explicit-keyframe expression. Recommend external values first unless paused paths receive full contract tests. Record API/capability metadata, public postRender acknowledgement, seconds/milliseconds conversion, no live animation/velocity history and `seek.uncontrolled` production. Verify sequential/random/fresh/held frames and timeout/cancel behavior. Read A and Seekability boundary; classification alone does not ship an API.

#### R7 — Validate the complete stateless Spring contract

**Priority: P3. Phase 2.** Define and test negative time, explicit start, other damping regimes/initial velocities, endpoint thresholds, Retarget position/velocity continuity and fresh versus reused generator state. One parameter set does not certify Pure Motion's full API. Compare fresh evaluator sampling with a closed-form implementation; recommend stateless evaluation with explicit initial conditions. Verify order-independent values and continuity at retarget boundaries; record the chosen semantics. Read A and motion/CONTEXT.md.

#### R8 — Expand Motion and React behavior coverage

**Priority: P3. Phase 2.** Test SVG, colors, variants, gestures, multiple properties/timelines, repeat/delay, interruption, callbacks, velocity subscribers, implicit start values, StrictMode, concurrent/nested roots, Suspense transitions/error boundaries and cross-process rendering. Include a joint Motion/R3F fixture when both integrations exist. Keep every untested behavior unqualified; decide whether explicit-time lifecycle/projection replacements are worthwhile rather than upgrading presence/layout/live springs by assertion. Verify per-feature Tier evidence and negative controls. Read A, C/D and the core table; not a Foundation feature expansion.

#### R9 — Design ThreeCanvas and CameraRig capability APIs

**Priority: P3. Phase 2 (implementation belongs to the later three phase).** Specify absolute-time camera/transform/uniform helpers, root-local advances, multiple-canvas ownership and capability Diagnostics. Decide whether GPU strategy/render targets are integration-internal or user-configurable; recommend an internal conservative default until R2 validates alternatives. Verify stopped clocks, no global effects and order/fresh/held comparisons. Read B, three/CONTEXT.md and Seekability boundary; no arbitrary useFrame guarantee.

#### R10 — Qualify advanced three and GPU behavior

**Priority: P3. Phase 2 (later three integration scope).** Cover controls/damping, physics, AnimationMixer, stochastic/feedback shaders, temporal postprocessing, shadows, WebGPU/XR, async shader compilation/upload errors, multiple canvases, async React/StrictMode, and context loss after readiness/recovery. Unknown history remains C/unverified. Recheck R3F timestamp/delta/lifecycle and THREE.Clock deprecation on upgrades. Verify per-feature comparisons or explicit exclusions and resource cleanup; do not promise arbitrary shaders. Read B/D and the core table.

#### R11 — Qualify richer font and asset inputs

**Priority: P3. Phase 2.** Test font weights/styles, variable fonts, fallback glyph coverage/lazy CSS fonts, large raster/animated images under decode pressure, GLTF external dependencies, Draco/KTX2, skinning and textured models. Verify named acquisition/decode/upload failures, required-resource discovery and exact settled captures; distinguish onload from decode without claiming the small SVG disproved onload. Revalidate the private Playwright font-wait switch only in negative-control instrumentation on upgrades. Read D and the asset registry ADR; optional three loaders stay outside core/render.

#### R12 — Establish video frame and audio synchronization guarantees

**Priority: P3. Phase 2 (later media scope).** Decide exact frame selection using seeked/currentTime versus requestVideoFrameCallback or decoded-frame control; cover VFR, codecs, failing decode, audio, reverse/playbackRate, other speeds and media resource limits. Recommend retaining the narrow paused-VP8 result until frame-index tests justify more. Verify actual requested frame/audio timeline alignment, not only seeked completion. Read C and design.md §9.6; one 10 fps VP8 clip does not certify media accuracy.

#### R13 — Qualify clock compatibility and alternate drivers

**Priority: P3. Phase 2.** If demanded by an integration, test isolated shims against cached native clocks, new Date, workers/iframes, third-party schedulers and backward performance.now; otherwise retain explicit inputs and C for unknown consumers. Dynamic CSS transitions/listeners and time scaling need their own adapter contracts. CDP replay/beginFrame and alternate policies remain optional measured alternatives, never prerequisites for Foundation or ordinary preview. Verify per-integration capability/negative tests before documenting support. Read C and the clock ADR.

#### R14 — Measure broader rendering portability and cost

**Priority: P3. Phase 2.** Extend beyond R1's pinned Linux baseline to browser/driver/library upgrades, headed/other browsers, high-DPR/4K, antialiasing/transparency, hardware/software, cold caches and separate processes/machines. Use each environment's own baseline; decide any cross-environment tolerance explicitly. Vary candidate order and workloads, isolate per-integration costs and record uncertainty rather than deriving service-level guarantees from warmed screenshot-dominated means. Verify a documented support matrix and reproducible benchmark output. Read all reports; same-run byte equality is not cross-GPU certification.

## Alternatives

- **rAF alone as master clock:** timestamp-only consumers and explicit React injection work, but independent clock readers did not synchronize: **0/20** in the spike, **1/20** once in independent QA. At the 500 ms sample the callback timestamp was 500 and its clock read 131 ms. Own/rAF mean-cost bands **41.66–45.72 / 41.43–44.53 ms** overlap and reverse order; speed is not the rejection reason.
- **CDP virtual time:** **0/20** order/fresh and failed hold; **10/12** shuffled targets were behind consumed budget. Settlement consumed **10–130 ms** extra virtual time, reaching 540 ms for a 500 ms target. **68.08–70.58 ms/frame** repetition means were roughly **60–70% overall** more expensive, not a universal bound. CDP is also unavailable to ordinary preview. Replay/beginFrame remain unmeasured, not impossible.
- **Own JS clock without adapters:** at target 500 ms bare CSS animation/transition were approximately **50.09 ms**, paused video **0 s**. Missing-adapter/readiness negative controls failed DOM and PNG checks. A clock does not remove history.
- **React commit or animation completion as a universal barrier:** A had **30/61** stale reads in five controlled paths after immediate updates; B needed second-reconciler scene acknowledgement. Animation end is not readiness at an arbitrary frame. Public postRender is a measured integration signal, not universal DOM completion.
- **Manual advance alone / target-only animation:** A's four uncontrolled fixtures and B's four history controls differed from fresh evaluation. B observed deltas **[0,2,-1.5,0]** for timestamps **[0,2,0.5,0.5]**; clamping/absolute delta does not reconstruct state.
- **Suspense, global font settlement or CPU asset readiness alone:** four Suspense fallbacks were capturable and wrong. Unguarded font/image/GLTF/texture captures differed by **14,253 / 40,960 / 23,040 / 29,038 RGBA bytes**; fonts.ready fulfilled with a failed face. The texture CPU source was ready before submission. Onload alone matched the small SVG **1/1**; decode is chosen for explicit success/failure semantics, not a demonstrated universal onload failure.
- **One rAF, no GPU fence, or screenshot success as proof of persistent pixels:** all four B sync variants matched **7/7** each, so no minimum fence is proved. With preservation disabled, screenshots still matched, but delayed readback differed in **307,200/307,200 bytes**. Keep conservative ownership until R2 qualifies a replacement.
- **Hardware-only rendering or arbitrary flags:** six of B's eight macOS flag profiles passed **25/25** each; disabling WebGL or both GPU/software rasterization failed as expected. Removing unsafe opt-in still worked in this build, and desktop-gl fell back to SwiftShader. Neither necessity of unsafe flags nor Linux support follows from these measurements.
- **Fixed sleeps / single Promise.all snapshot:** D's four gated assets remained pending through capture and **300 ms** waits; a successful delay cannot prove readiness. A snapshot misses later registrations. Deadlines bound failure, never establish success.
