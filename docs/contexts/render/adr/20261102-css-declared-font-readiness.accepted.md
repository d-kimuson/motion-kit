# Wait for the CSS-declared faces a frame's text needs

## Context

`@fontsource/*` ships one family as dozens of `@font-face` rules split by `unicode-range`, one file
per subset. `useAsset({ kind: 'font' })` takes one `source`, so it cannot declare that family, and a
plain CSS `font-family` is outside the readiness guarantee: the browser fetches a subset lazily when
the frame's text first needs it, and a capture that runs before it lands draws the system fallback,
whose glyphs differ per machine. [Issue #58](https://github.com/d-kimuson/motion-kit/issues/58) item 5
reports the workaround (a top-level `await document.fonts.load` over every rendered string) and asks
for a declaration the registry can wait on.

Chromium's `FontFaceSet.load(font, text)` already performs the matching the guarantee needs, measured
in the `composition-dom` browser project:

- It loads only the faces whose `unicode-range` intersects `text`; a family of two subsets, one
  covering `U+3040-30FF` and one `U+0041-005A`, loads one face for the text `あい` and leaves the
  other `unloaded`.
- It resolves with the matched `FontFace` objects, including on a repeat call once they are loaded.
- It rejects with `NetworkError` when a matched face's file cannot be fetched, and resolves with an
  empty array when no declared rule matches the family.
- `document.fonts.check(font, text)` is true only for a loaded face; it cannot tell a covered
  character from one no subset covers, because the system fallback is a loaded font too.

The [asset readiness contract](../../core/adr/20261024-asset-readiness.accepted.md) already requires
registration before suspend, a cache entry per resource, and a failure reported as a Diagnostic. An
undeclared asset is not assumed ready; the frame is captured only after the Readiness Barrier passes.

## Decision

`useAsset` accepts a third descriptor, `FontFamilyAssetDescriptor` (`kind: 'font-family'`), exported
from the package root with the other descriptor types. It names the CSS family, weight, style and the
`text` the frame renders, and returns the loaded faces.

```ts
type FontFamilyAssetDescriptor = {
  kind: 'font-family';
  id: string;
  family: string;
  weight?: number | string;
  style?: string;
  /** The text the frame renders: the faces covering its characters are required. */
  text: string;
  sceneId?: string;
};
declare function useAsset(descriptor: FontFamilyAssetDescriptor): readonly FontFace[];
```

- The loader calls `document.fonts.load('<style> <weight> 16px <family>', text)` inside the registry's
  attempt and `AbortSignal`. A rejected load is phase `load`; an empty result, or a matched face that
  is not `loaded`, is phase `font-set`. Both are `asset.load-failed`, the Diagnostic the other asset
  kinds produce.
- Cache identity is kind, family, weight, style **and** text. Two owners in one frame may render
  different characters, and one load cannot satisfy both.
- The requirement reports its **family** as the source. Redaction is chosen by kind, and only
  `font-family` is exempt: that source is authored CSS with nothing to strip, and every other kind,
  including one a later version adds, is treated as a URL and redacted, so a new kind fails closed. `FontFace` exposes no source, so the failing subset's URL stays in the stylesheet.
- The Readiness Barrier is unchanged. The registry entry is pending until the load settles, its
  attempt is a resource version, and the host re-settles or reports `asset.not-ready` as for every
  other asset. No capture path is added.
- `text` is required: an ASCII probe would load the Latin subset of a Japanese family and leave the
  frame's own subsets pending, so the probe's readiness would be a false one.

## Consequences

A fontsource-style import works with one hook per text run:

```tsx
import '@fontsource/noto-sans-jp/400.css';

const Title = () => {
  useAsset({
    kind: 'font-family',
    id: 'title',
    family: 'Noto Sans JP',
    weight: 400,
    text: 'こんにちは',
  });
  return <h1 style={{ fontFamily: 'Noto Sans JP' }}>こんにちは</h1>;
};
```

Only the subsets the text needs are fetched, the first capture waits for them, and `useAsset` for
every frame that shows the text is a cache hit.

- A subset file that failed stays failed for the **life of the page**. A stylesheet's `@font-face` is
  connected to the CSSOM, so a script can neither replace nor delete it, and Chromium keeps the
  failed face in `error` after the server starts answering. The registry still starts a new attempt
  per `retry`, and that attempt reports the same failure: the `load`-phase hint says to reload the
  preview or start a new renderer, and that is the only recovery. A retry inside a long-lived realm
  is therefore not a repair, which the [asset readiness
  contract](../../core/adr/20261024-asset-readiness.accepted.md) now records.
- A family no rule declares, or whose declared faces do not cover the text at all, fails the frame
  instead of silently capturing the fallback. A text that mixes covered and uncovered characters
  still falls back for the uncovered ones; glyph coverage is the parked Phase 2 qualification, as
  the [asset readiness contract](../../core/adr/20261024-asset-readiness.accepted.md) records.
- The Diagnostic names the family and not the subset URL, so an author reads the CSS for the file.
- The stylesheet must be in the page before the frame renders. A CSS import in the entry is; a style
  element rendered inside the suspending subtree is not (the first commit is the fallback's).
- Varying the rendered text per frame creates one cache entry per distinct string. The first frame
  pays for a new subset, later frames hit the loaded face.

Tests: `src/core/assets/use-asset.browser.test.tsx` (Chromium `composition-dom`) covers the lazy
load, the unicode-range selection, the returned faces and both failure phases;
`src/render/capture/asset-readiness.test.ts` gates the Japanese subset over HTTP and asserts the
capture happens only after it is fulfilled, that the Latin subset is never fetched, and that the next
capture of the same frame is byte-identical; `css-font-split` in the determinism suite captures the
same Japanese text identically across the eight traversal modes plus a sustained session. The
browser test also pins the retry limit: a failed stylesheet face stays in `error`, a `retry` starts a
second attempt (`1:failed` then `2:failed`) that reports the same `load` failure and the reload hint,
and `registry.test.ts` pins the fail-closed redaction (an unknown kind keeps nothing) and the
per-phase hints. `node scripts/mutate-asset-readiness.ts` includes
`font-family-ready-without-waiting`.

## Alternatives

- **Load the family automatically from rendered DOM text.** CSSOM exposes no "which font does this
  character resolve to": a scan would have to re-implement font matching over computed styles,
  invent loads the registry never registered, and assume undeclared assets ready — the opposite of
  the barrier's contract.
- **Keep `source` and make it a repeated field.** A face list is a different resource: its identity,
  failure and readiness are "the faces covering this text", not "this file", and the browser already
  owns the unicode-range matching.
- **Make `text` optional and default to an ASCII probe.** The probe loads the Latin subset only, so a
  Japanese frame reports ready while its own subsets are still pending.
- **Resolve `document.styleSheets` and load each rule's `src`.** Cross-origin stylesheets are
  unreadable, it duplicates font matching, and it turns a CSS-authored URL into a Diagnostic source
  the author never wrote.
- **Report the family in a new `family` field of the asset record.** The record's `source` is already
  the reported identity, and a redaction rule that exempts only `font-family` keeps the transport
  schema unchanged.
