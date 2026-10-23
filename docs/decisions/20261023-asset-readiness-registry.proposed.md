# Await an explicit asset registry and frame commit before capture

## Context

Status: **proposed**, pending implementation/design review in TASK-158. [Spike D](../contexts/render/knowledge/spike-d-assets.md) found wrong pixels for delayed fonts, images, GLTF models and texture uploads. React Suspense holds a participating subtree, but capture can still read its fallback. Ordinary browser asset loads do not suspend automatically. `document.fonts.ready` can resolve even when a required font failed; CPU texture readiness does not establish GPU readiness.

The decision spans core's asset readiness, theme's fonts, three's loader/GPU integration and render's Readiness Barrier, so it belongs in `docs/decisions/`, not solely in render. The design's tentative `useAsset()` plus Suspense needs an explicit renderer-facing contract, not a promise that Suspense by itself protects capture.

## Decision

Propose the following for TASK-158; this ADR does not establish a shipped API:

- core owns library-neutral asset registration and readiness state, with stable asset/source identity. Register/cache a load before a consumer can suspend; an effect inside a suspended subtree cannot be its only registration point. A future `useAsset` reads the same resource state for optional Suspense integration; Suspense is a UI mechanism, not the capture gate.
- render awaits readiness for the requested frame, verifies React/integration commit acknowledgements, then captures. A new commit may discover more resources: drain newly registered work and recheck the frame generation until stable. Reject stale acknowledgements and bound the whole operation. Do not use a fixed sleep, network-idle or absence of a visible fallback as readiness.
- Font adapters observe each declared `FontFace.load()` rejection/status and the required weight/style/face, then the applicable `document.fonts` settlement. Image adapters await `image.decode()`. These browser signals do not cover undeclared assets automatically.
- three owns GLTF loader promises and GPU-specific settlement; core and render never import three or receive its scene objects. A resolved model/source promise is distinct from submitted texture/shader work and the requested rendered frame. The spike's `initTexture`/`onUpdate` plus render/`gl.finish()` is a working reference, not a mandated universal or fastest fence.
- Return a `Result` carrying the existing `Diagnostic` contract for acquisition/decode/upload failure, cancellation and timeout. Include asset identity/source, phase, frame/scene where available, original cause and pending identities. A failed or timed-out frame is not captured. Exact diagnostic codes/public signatures remain to be designed; the spike's local types are illustrative only.

## Consequences

The same asset state can support preview Suspense and deterministic capture without conflating their responsibilities. theme supplies font requirements; three registers library-neutral readiness work; render owns await-before-capture. GPU failures and late asset discovery remain observable instead of silently yielding fallback pixels.

TASK-158 must define registration lifetime, cache keys, cancellation, retries, concurrent frames, frame generations and commit/discovery stabilization, with tests for nested Suspense and changing sources. It must not copy the spike's single-resource `Promise.all` snapshot as a production drain algorithm. The deadline must also cover commit/GPU settlement and browser RPCs, not just asset promises. The experiment does not resolve whether `gl.finish()` is the best production GPU strategy.

## Alternatives

- **Suspense only:** it coordinates subtree visibility, not Playwright capture. All four participating fixtures expose capturable fallback pixels.
- **Only DOM scans / `document.fonts.ready` / `onload` / network idle:** these cannot identify every required face, loader, deferred upload or hidden resource. The font failure and stale texture controls specifically falsify treating global/CPU readiness as sufficient. `onload` matched the small SVG in this experiment; no universal failure of `onload` is claimed.
- **Fixed delay:** a held response outlasts any chosen successful delay; a deadline may report failure but cannot establish success.
- **Put three loaders in core/render:** violates the context map and forces optional integration dependencies onto unrelated compositions.
