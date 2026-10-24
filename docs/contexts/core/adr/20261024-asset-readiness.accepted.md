# Register fonts and images before suspend and drain them until stable

## Context

Status: **accepted**. [Spike D](../../render/knowledge/spike-d-assets.md) showed that Suspense, `document.fonts.ready` and a single `Promise.all` snapshot do not protect capture. The [registry strategy](../../../decisions/20261023-asset-readiness-registry.accepted.md) and the [readiness barrier](../../../decisions/20261024-time-control-and-frame-capture.accepted.md) already chose the direction. TASK-158 fixes the production rules those records left open: cache identity, ownership, cancellation, retry, stale acknowledgement, late discovery and diagnostic redaction.

core owns library-neutral registration. theme will later declare font requirements through this API. three will register library-neutral work from its own adapters. core and render do not import three or receive scene objects.

## Decision

`useAsset` and `FontAssetDescriptor` / `ImageAssetDescriptor` are the Phase 1 public surface, exported from the package root. Preview and render use that same hook. The registry, `whenReady` and readiness snapshot are reached through the composition page runtime (`assetReadiness`, `whenReady`, `pendingAssets`). They are not package exports. No subpath is added.

Cache identity is the kind and the exact source string, plus family, weight and style for a font. Weight is normalized with `String`. `bold` and `700` are different keys. The caller id does not enter the key. Credentials remain part of identity so two authenticated URLs do not share a cache entry; they never appear in a Diagnostic, lease id or readiness snapshot. Lease ids use a non-cryptographic fingerprint of the key.

Registration runs during render, before the hook can throw a promise. The load promise is cached before suspension. Multiple owners share one attempt. Releasing the last owner aborts that attempt and drops the entry. A later owner starts a new attempt. Failure is sticky for the current attempt until `retry`, which aborts the current attempt and starts another. A completion applies only when the entry, attempt and controller still match; otherwise it is ignored.

`whenReady` loops until required registrations for the request are ready and a commit acknowledgement has been observed, then confirms the registration revision did not change. It does not take one `Promise.all` of the initial set. New registrations and version changes continue the loop under the same frame generation. The configured deadline is not restarted. Cancellation resolves as `{ ok: false, aborted: true }` and emits no Diagnostic. A deadline with pending registrations returns one `asset.not-ready` Diagnostic listing every pending owner and `details.timeoutMs`. A loader rejection returns `asset.load-failed`. An empty registry does not mean undeclared assets are ready; it means no registered resource is pending.

Font loads use `FontFace.load()`, then `document.fonts.ready` and `document.fonts.check` for the declared face. Image loads use `HTMLImageElement.decode()`. Failures carry phase `load`, `font-set` or `decode`. The thrown React error is a stable `AssetLoadError`; its Diagnostic was already built by the single producer. That producer redacts URL userinfo, fragments and sensitive query names (token, secret, signature, credential, password, and the exact names `sig`, `key`, `auth`, `jwt`, `session`, `policy`). It discards exception messages and stacks. Zod accepts a secret-bearing details object; redaction is a producer obligation.

`settleFrame` awaits `whenReady` before integration settlement and a ready lease. Asset versions are on the lease, so a source change invalidates capture without publishing the previous bytes. The host still classifies a responsive `pendingAssets` inventory as `asset.not-ready`. Three upload and model phases are not implemented here.

## Consequences

Scene authors opt in by calling `useAsset`. A raw `<img>` or CSS font is outside the guarantee. A component that suspends and is removed before its effect commits can leave a registration until release or disposal; pass-end garbage collection was rejected because a suspended child does not re-render. StrictMode double-mounting is unverified. Font weight substitution, variable fonts, glyph coverage and large raster decode pressure remain the parked Phase 2 qualification. GPU resources stay in three.

The opt-in mutation round is `node scripts/mutate-asset-readiness.ts`. Each mutant is restored in `finally`.

| Mutant                           | Killing test                                                            |
| -------------------------------- | ----------------------------------------------------------------------- |
| Register after the suspense read | `registers before the suspense read is observable`                      |
| Single `Promise.all` snapshot    | `drains registrations discovered after the first pending set settles`   |
| Cache key includes caller id     | `shares a load for the same source and distinguishes weight and source` |
| Retry does not start             | `retries a failed load as a new attempt`                                |
| Accept a stale acknowledgement   | `suppresses a stale load acknowledgement`                               |
| Skip source redaction            | `redacts credentials signed queries and loader exception text`          |
| Copy loader exception text       | `redacts credentials signed queries and loader exception text`          |
| Timeout lists one asset          | `lists every pending registration and timeoutMs`                        |
| Map load failure to not-ready    | `maps font and image load failures to asset.load-failed`                |

## Alternatives

- Export the registry from the package root: scene code would depend on barrier objects that preview and render must own.
- Snapshot `Promise.all` once: misses assets discovered by the commit that the first load unblocks.
- Treat `document.fonts.ready` or DOM scans as the inventory: a failed face can still settle the font set, and undeclared assets would be silently assumed ready.
- Put GLTF and texture upload in core: pulls three across the context boundary.
- Let schema parsing redact secrets: a Diagnostic can already validate while still carrying credentials, so redaction has to happen at the producer.
