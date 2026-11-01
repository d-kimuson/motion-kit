# Register fonts and images before suspend and drain them until stable

## Context

Status: **accepted**. [Spike D](../../render/knowledge/spike-d-assets.md) showed that Suspense, `document.fonts.ready` and a single `Promise.all` snapshot do not protect capture. The [registry strategy](../../../decisions/20261023-asset-readiness-registry.accepted.md) and the [readiness barrier](../../../decisions/20261024-time-control-and-frame-capture.accepted.md) already chose the direction. TASK-158 fixes the production rules those records left open: cache identity, ownership, cancellation, retry, stale acknowledgement, late discovery and diagnostic redaction.

core owns library-neutral registration. theme will later declare font requirements through this API. three will register library-neutral work from its own adapters. core and render do not import three or receive scene objects.

## Decision

`useAsset` and `FontAssetDescriptor` / `ImageAssetDescriptor` are the Phase 1 public surface, exported from the package root. Preview and render use that same hook. The registry, `whenReady` and readiness snapshot are reached through the composition page runtime (`assetReadiness`, `whenReady`, `pendingAssets`). They are not package exports. No subpath is added.

Cache identity is the kind and the exact source string, plus family, weight and style for a font. Weight is normalized with `String`. `bold` and `700` are different keys. The caller id does not enter the key. Credentials remain part of identity so two authenticated URLs do not share a cache entry; they never appear in a Diagnostic, lease id or readiness snapshot. Lease ids use a non-cryptographic fingerprint of the key.

Registration runs during render, before the hook can throw a promise. The load promise is cached before suspension. Multiple owners share one attempt. Releasing the last owner aborts that attempt, bumps the attempt counter, and drops the entry. A later owner starts a new attempt. Failure is sticky for the current attempt until `retry`, which aborts the current attempt and starts another. A completion applies only when the attempt and controller still match. Object identity is not a separate check: release, retry and dispose bump the attempt before a replacement entry can settle, so a stale completion cannot land on the new object.

`whenReady` loops until required registrations for the request are ready and a commit acknowledgement has been observed, then confirms the registration revision did not change and every live entry is still ready. `retain` does not bump that revision, so the post-microtask ready check is what keeps a registration that appears during confirmation from being treated as settled. It does not take one `Promise.all` of the initial set. New registrations and version changes continue the loop under the same frame generation. The configured deadline is not restarted. Cancellation resolves as `{ ok: false, aborted: true }` and emits no Diagnostic. A deadline with pending registrations returns one `asset.not-ready` Diagnostic listing every pending owner and `details.timeoutMs`. A loader rejection returns `asset.load-failed` even if the deadline has already expired; `pending()` does not list failed registrations. An empty registry does not mean undeclared assets are ready; it means no registered resource is pending.

Font loads use `FontFace.load()`, then `document.fonts.ready` and `document.fonts.check` for the declared face. Image loads use `HTMLImageElement.decode()`. Failures carry phase `load`, `font-set` or `decode`. The thrown React error is a stable `AssetLoadError`; its Diagnostic was already built by the single producer. `runtime.fail` merges that diagnostic with every failed registration, deduplicated by source and phase, and does not abort settlement while another registration is still pending. `whenReady` waits for that sibling unless the deadline has already fired, then publishes the full failure set. The reported source contains scheme, host, path and at most a redacted query marker. Redaction is idempotent: the marker form and `[asset source]` are returned unchanged, so a second producer pass, including the host deadline probe of an already-redacted `pending()` inventory, cannot percent-encode the marker. An absolute URL is serialized after userinfo, query and fragment removal, so the marker is the only query trace: `https://example.com/a.png (+3 query parameters, redacted)`. One parameter uses the singular `parameter`. The marker carries the parameter count only, never a name or value, and there is no name allowlist. A relative source reports its path plus the same marker. Fragments and URL userinfo stay stripped, including userinfo the parser still leaves in the serialized URL. A digest of the query is not included, because it would let a reader confirm a guessed credential. The producer discards exception messages and stacks. Zod accepts a secret-bearing details object; redaction is a producer obligation.

`settleFrame` awaits `whenReady` before integration settlement and a ready lease. Asset versions are on the lease, so a source change invalidates capture without publishing the previous bytes. The host still classifies a responsive `pendingAssets` inventory as `asset.not-ready`. Three upload and model phases are not implemented here.

## Consequences

Scene authors opt in by calling `useAsset`. A raw `<img>` or CSS font is outside the guarantee. A component that suspends and is removed before its effect commits can leave a registration until release or disposal; pass-end garbage collection was rejected because a suspended child does not re-render. _Amended 2026-11-02 (TASK-281):_ such a registration no longer reaches a preview reply: `assetReadiness(generation)` leaves out the owners that never committed from an earlier generation, and an owner that unmounted or that a Suspense fallback hid since it committed (`markUncommitted`, in `useAsset`'s layout-effect cleanup). StrictMode double-mounting is unverified. Font weight substitution, variable fonts, glyph coverage and large raster decode pressure remain the parked Phase 2 qualification. GPU resources stay in three.

The opt-in mutation round is `node scripts/mutate-asset-readiness.ts`. Each mutant is restored in `finally`.

| Mutant                             | Killing test                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| Register after the suspense read   | `registers before the suspense read is observable`                                  |
| Single `Promise.all` snapshot      | `drains registrations discovered after the first pending set settles`               |
| Cache key includes caller id       | `shares a load for the same source and distinguishes weight and source`             |
| Retry does not start               | `retries a failed load as a new attempt`                                            |
| Accept a stale acknowledgement     | `suppresses a stale load acknowledgement`                                           |
| Skip source redaction              | `redacts credentials signed queries and loader exception text`                      |
| Copy loader exception text         | `redacts credentials signed queries and loader exception text`                      |
| Timeout lists one asset            | `lists every pending registration and timeoutMs`                                    |
| Map load failure to not-ready      | `maps font and image load failures to asset.load-failed`                            |
| Keep userinfo                      | `redacts credentials signed queries and loader exception text`                      |
| Image key ignores source           | `shares a load for the same source and distinguishes weight and source`             |
| Confirm ignores new pending        | `keeps the barrier waiting when a registration appears during confirmation`         |
| Timeout before failure             | `prefers asset.load-failed when the deadline flag and a rejection are both visible` |
| Pending includes failed            | `reports load-failed when a rejection and a still-pending registration coexist`     |
| Publish only the first diagnostic  | `publishes every asset diagnostic from a failed settlement`                         |
| Restore query parameter names      | `redacts query values under unrelated parameter names`                              |
| Redact an already-redacted marker  | `returns an already-redacted source unchanged`                                      |
| Boundary drops registered failures | `publishes every failed registration when the boundary fails`                       |

`drop-entry-identity-stale-check` is not a survivor. The object-identity comparison was removed because release, retry and dispose increment `attempt` before a replacement entry can settle. A stale completion already fails the attempt check, so the identity line had no separate behavior to pin.

## Alternatives

- Export the registry from the package root: scene code would depend on barrier objects that preview and render must own.
- Snapshot `Promise.all` once: misses assets discovered by the commit that the first load unblocks.
- Treat `document.fonts.ready` or DOM scans as the inventory: a failed face can still settle the font set, and undeclared assets would be silently assumed ready.
- Put GLTF and texture upload in core: pulls three across the context boundary.
- Let schema parsing redact secrets: a Diagnostic can already validate while still carrying credentials, so redaction has to happen at the producer.
- Denylist query names or credential-shaped values, or keep a benign allowlist such as `v`, `w`, `h` and `scale`: an unrelated name can carry an AWS secret, a JWT, `sig2` or `GoogleAccessId`, and value inspection cannot be proved complete. The reported source contains scheme, host, path and at most a redacted query marker.
