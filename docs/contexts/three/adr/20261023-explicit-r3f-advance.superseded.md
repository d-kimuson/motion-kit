# Drive R3F with absolute time and verify capture readiness explicitly

Status: **superseded** by the [accepted time-control and frame-capture ADR](../../../decisions/20261024-time-control-and-frame-capture.accepted.md). The proposal below is retained as history, not an unresolved decision.

## Context

[Spike B](../knowledge/spike-b-seekability.md) reproduced a camera animation, object transforms and shader uniform using R3F 9.8.2 / three 0.186.1: 25/25 exact DOM and PNG comparisons across random/repeated seeks, fresh roots and held time. The full experiment passed on SwiftShader and Apple Metal. Four history-dependent controls differed from fresh rendering. R3F's never-loop delta was `[0,2,-1.5,0]` for timestamps `[0,2,0.5,0.5]`; Manual Advance does not erase component history.

A preserved framebuffer plus `gl.finish()` and Playwright screenshot matched GPU readback exactly. No-fence screenshots also matched in this workload, while disabling buffer preservation kept screenshots correct but lost delayed readback contents. This establishes a working candidate, not a universal or minimal synchronization protocol. Linux CI is not yet qualified.

## Decision

**Proposed, pending the production readiness and integration-scope decisions:** use `frameloop="never"` and root-local `advance(timeInSeconds, false)` for the initial ThreeCanvas integration, with no independent three animation loop. The controlled B path overwrites camera pose, object transforms and shader values from timeline time. Do not classify an arbitrary `useFrame` callback as seekable merely because its canvas advances manually. Delta-integrating/history-dependent controls remain C unless separately integrated and verified.

Make capture readiness explicit after scene updates. The tested conservative candidate uses a preserved default framebuffer, `gl.finish()` and a subsequent Playwright capture. Do not interpret a rAF callback, React DOM `flushSync`, `setAnimationLoop(null)` or an animation-end promise as universal GPU/asset readiness. Final adoption depends on the browser-clock and asset readiness work, frame identity and bounded failure handling. A render-target/readback design remains an alternative.

For reproducible software experiments, pin Playwright Chromium and explicitly select `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`; verify the actual renderer, not just launch success. This is a test configuration, not an accepted production security policy or a claim that all three flags were necessary on the measured host. Playwright already supplies the unsafe opt-in; removing it still worked with explicit SwiftShader in the tested build.

## Consequences

The [successor ADR](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#seekability-boundary) decides absolute-time/root-local advancement and a conservative GPU reference, with the readiness contract and security qualification separated. ThreeCanvas/CameraRig APIs remain later-phase work. Tier C emits `seek.uncontrolled` as a warning using [DiagnosticSchema](../../../../src/lib/diagnostic.ts); no spike-local Diagnostic type becomes public.

- The committed experiment supplies a regression shape for order independence, negative controls and screenshot/readback agreement without shipping spike code or adding a root three dependency.
- The root-local API avoids advancing unrelated canvases/global effects. Tests must continue to verify stopped clocks and held frames.
- CameraRig and shader integration can preserve three/R3F expression instead of hiding library APIs, but only tested absolute-time paths qualify as controlled.
- A GPU fence may stall rendering. Barrier cost, preserved-buffer versus render-target ownership, async readiness, Linux CI, multi-canvas lifecycle, context recovery and the Browser Renderer's sandbox/unsafe-software policy remain open.
- The proposal does not implement public APIs, approve arbitrary R3F components, promise cross-GPU pixels, or change the existing tier definitions. React stays a devDependency until TASK-149.

## Alternatives

- Autonomous `frameloop="always"` or accumulated callback deltas: reject as the default seekable path; history is not reconstructed by setting a frame number.
- Let Playwright screenshot supply all synchronization: it worked here, but the finite workload does not establish a universal readiness contract.
- Wait one rAF: tested successfully, but a presentation opportunity is not a completion fence or asset barrier.
- Explicit render target plus readback: promising, but this spike tested default-framebuffer `readPixels`, not render-target integration and composition. Keep it open.
- Hardware-only rendering: unnecessary for this fixture; SwiftShader passed. Hardware and software performance/quality requirements for larger compositions remain separate decisions.
