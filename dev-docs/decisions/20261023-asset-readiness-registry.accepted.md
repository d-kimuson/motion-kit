# Await an explicit asset registry and frame commit before capture

## Context

Status: **accepted**. [Spike D](../contexts/render/knowledge/spike-d-assets.md) found wrong pixels for delayed fonts, images, GLTF models and texture uploads. React Suspense holds a participating subtree, but capture can still read its fallback. Ordinary browser asset loads do not suspend automatically. `document.fonts.ready` can resolve even when a required font failed; CPU texture readiness does not establish GPU readiness.

The decision spans core's asset readiness, theme's fonts, three's loader/GPU integration and render's Readiness Barrier. It follows design.md §9.4's common `useAsset` API, Suspense-compatible structure and explicit load failures, together with §9.3's await-before-capture contract. The spike establishes that Suspense compatibility requires shared resource state, not reliance on Suspense alone to protect capture.

## Decision

motion-kit uses a library-neutral asset registry and explicit frame/commit/integration settlement before capture:

- core owns library-neutral asset registration and readiness state, with stable asset/source identity. Register/cache a load before a consumer can suspend; an effect inside a suspended subtree cannot be its only registration point. `useAsset` reads the same resource state for optional Suspense integration; Suspense is a UI mechanism, not the capture gate.
- render awaits readiness for the requested frame, verifies React/integration commit acknowledgements, then captures. A new commit may discover more resources: drain newly registered work and recheck the frame generation until stable. Reject stale acknowledgements and bound the whole operation. Do not use a fixed sleep, network-idle or absence of a visible fallback as readiness.
- Font adapters observe each declared `FontFace.load()` rejection/status and the required weight/style/face, then the applicable `document.fonts` settlement. Image adapters await `image.decode()`. These browser signals do not cover undeclared assets automatically.
- three owns GLTF loader promises and GPU-specific settlement; core and render never import three or receive its scene objects. A resolved model/source promise is distinct from submitted texture/shader work and the requested rendered frame. The spike's `initTexture`/`onUpdate` plus render/`gl.finish()` is a working reference, not a mandated universal or fastest fence.
- Return a `Result` carrying the [accepted CLI `Diagnostic` contract](../contexts/agent/adr/20261024-cli-output-contract.accepted.md): `asset.load-failed` for font HTTP/load failure, image decode failure, corrupt GLTF parsing, texture-source decode failure and texture upload/context loss; `asset.not-ready` for stalled font/image/GLTF loads or a held texture upload exceeding the readiness deadline, including the intentional negative-control waits. Put asset kind, source URL/path and phase in `details.assets`; for timeouts list every pending asset and include `details.timeoutMs`. Texture entries identify the source image and retain the upload gate in `relatedSources`. Include known frame/scene in `location`. `message` is a one-sentence human statement, never an internal identifier or raw exception; `hint` says how to repair the source, restore the GPU context or investigate the pending phase. A failed or timed-out frame is not captured.

## Consequences

The same asset state can support preview Suspense and deterministic capture without conflating their responsibilities. theme supplies font requirements; three registers library-neutral readiness work; render owns await-before-capture. GPU failures and late asset discovery remain observable instead of silently yielding fallback pixels.

TASK-158 implements this accepted strategy in the [core asset readiness ADR](../contexts/core/adr/20261024-asset-readiness.accepted.md). The spike's local types remain illustrative only. The production drain must not copy this spike's single-resource `Promise.all` snapshot. The deadline must also cover commit/GPU settlement and browser RPCs, not just asset promises. The experiment does not resolve whether `gl.finish()` is the best production GPU strategy.

## Alternatives

- **Suspense only:** it coordinates subtree visibility, not Playwright capture. All four participating fixtures expose capturable fallback pixels.
- **Only DOM scans / `document.fonts.ready` / `onload` / network idle:** these cannot identify every required face, loader, deferred upload or hidden resource. The font failure and stale texture controls specifically falsify treating global/CPU readiness as sufficient. `onload` matched the small SVG in this experiment; no universal failure of `onload` is claimed.
- **Fixed delay:** a held response outlasts any chosen successful delay; a deadline may report failure but cannot establish success.
- **Put three loaders in core/render:** violates the context map and forces optional integration dependencies onto unrelated compositions.
