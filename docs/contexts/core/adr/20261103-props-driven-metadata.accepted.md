# Resolve Composition metadata from the validated props at mount

## Context

Issue #58, item 4: `durationInFrames` depends on data the entry does not have at module evaluation, such as the length of synthesized audio, so the author had to write generated JSON to disk and import it statically into the entry. `--props` alone could not drive a data-driven video, and the alternative — regenerating and reimporting the entry per run — defeats the point.

The forces:

- Props are validated by the Composition's Zod schema in the page, and the schema's defaults are the only defaults authority ([composition registry ADR](20261024-composition-registry.accepted.md)). A metadata resolver must read the same validated values the component receives, not raw input.
- The page owns loading. Node never evaluates the user's TSX entry: the loading service serves it through Vite and Playwright (or the user's browser, for preview) mounts it. Render, frame, check and preview all mount through `CompositionEntry.prepare`, and the resulting `MountReceipt` carries the descriptor to Node. Preview is the constraint that decides the place: it mounts in the user's browser with no Node-side evaluation of the entry at all.
- A frame is a pure function of its Presentation Time, and `check` compares realms that mounted independently, so metadata must be a deterministic function of the props and the project data.
- Recoverable failures are a `Result` with a `Diagnostic`, never a thrown error ([coding guidelines](../../../guidelines/coding/index.md)).

## Decision

`defineComposition` accepts an optional **metadata resolver**:

```ts
type CompositionMetadataInput<TProps extends object> = Readonly<{
  declared: CompositionDescriptor; // the declaration, the baseline an override applies to
  props: TProps; // the validated props the component receives
}>;
type CompositionMetadataOverride = Readonly<{
  durationInFrames?: number;
  width?: number;
  height?: number;
  fps?: RationalInput;
}>;
type MetadataResolver<TProps extends object> = (
  input: CompositionMetadataInput<TProps>,
) => Result<CompositionMetadataOverride> | Promise<Result<CompositionMetadataOverride>>;

defineComposition({ id, width, height, fps, durationInFrames, schema, component, resolveMetadata? });
```

A resolver returns a **partial** override: every field it omits keeps the declared value, and `{}` keeps the declaration. It cannot change `id` (identity), `audio` (a declaration the [audio muxing ADR](../../render/adr/20261026-audio-track-muxing.accepted.md) turns into encoder input) or the schema/component, and any other field is rejected. The resolver receives `declared` so it can derive from the declared frame rate without repeating it.

**Resolution happens in the page, inside `prepare`, once per mount**: after the props schema (so the resolver reads exactly what the component receives) and before `PreparedComposition` is returned. That is the single resolution point, because every host mounts through it:

- `render` and `frame` read `Renderer.descriptor()`;
- `check` reads the pool's descriptor and validates samples against it;
- `preview` mounts the same registry in the user's browser and draws its timeline and frame range from the reply;
- the Composition realm itself validates its output frames and serves `useTimeline()` from the prepared descriptor.

`listCompositions()` keeps reporting the **declaration**, because a list is props-independent and runs before any mount; it is a baseline, not a promise about a selected props object. Nothing caches a resolution: a different props object is a different mount and resolves again, and a pool of N renderers resolves N times (hence determinism, below).

The resolver may be asynchronous. It has the mount's loading budget: a fresh, configurable timeout per mount, exactly like the props parse, and a result that lands after the deadline is ignored. A resolver promise that does not settle, a callback that throws or rejects, a return that is not a `Result`, and a failure that is not a valid `Diagnostic` are all `render.page-error`, with the message naming metadata resolution and the hint naming `resolveMetadata`; the exception text never reaches the Diagnostic.

The host's own mount deadline (`src/render/loading/session.ts`) allows the mount's phases on top of that budget, because it starts before the page parses props. A host timer with the same budget would expire first and replace the page's Diagnostic with a generic `Loading props parse and mount timed out.` that names neither the phase nor the composition. The host deadline therefore stays a backstop for a page that cannot answer at all, and a hung resolver surfaces as the page's metadata Diagnostic.

Validity and code mapping are the declaration's, not a new namespace:

| Invalid…                                                     | Code                           |
| ------------------------------------------------------------ | ------------------------------ |
| `durationInFrames`: negative, fractional, non-finite, unsafe | `composition.duration-invalid` |
| `width`, `height`: not a positive safe integer               | `render.page-error`            |
| `fps`: not a positive exact rational                         | `render.page-error`            |
| an unknown or `undefined` field, or a malformed `Result`     | `render.page-error`            |

A resolver that fails returns its own `Diagnostic`, which is passed through with `location.compositionId` added when absent. No code is added, so `DiagnosticCodeSchema`, the committed JSON Schema and `schemaVersion` are unchanged. This keeps one code per fault: the same invalid duration reports `composition.duration-invalid` whether it was declared or resolved. The page-side frame-range mapping is unchanged: an out-of-range request is `composition.props-invalid` from the host (`validateOutputFrame`) and `render.page-error` at the realm boundary.

**Data access.** The resolver runs in the browser: it can `fetch` a project file (the loading service serves the project root) but cannot read the filesystem or run FFmpeg. A pipeline that probes an audio file is expected to compute the duration in its own Node script and pass it through `--props`; a resolver that wants the file itself fetches it. A Composition whose audio clips outlast a derived duration is not rejected: the encoder's audio graph pads and trims to the output duration.

Determinism is the resolver's obligation, stated in its type documentation: for the same props and project data it must return the same metadata. A resolver reading a wall clock, unseeded randomness or mutable process state would let two realms of the same Composition disagree, which `check` reports as a difference and the determinism suite treats as a bug.

## Consequences

- A data-driven video renders with `--props` alone: `motion-kit render entry.tsx --props "$(cat script.json)" --out out.mp4`. For example, `defineComposition({ ..., resolveMetadata: ({ props }) => ({ ok: true, value: { durationInFrames: props.frames } }) })`.
- The declared `durationInFrames` stays required. It is the props-independent metadata `listCompositions` reports and the value a Composition without a resolver runs with, so no shape becomes optional and existing entries are unaffected.
- `defineComposition` validates that `resolveMetadata` is a function at declaration (`render.page-error`), like the other declaration fields.
- The [composition registry ADR](20261024-composition-registry.accepted.md) sentence "Props do not recompute metadata in Phase 1" is superseded by this record; its validation mapping and defaults authority still govern.
- A resolver failure stops the mount, so no realm opens and no frame is captured: `render`, `frame`, `check` and `preview` report it as the command's failure before any output exists.
- `docs/contexts/core/CONTEXT.md` gains the terms Composition metadata resolver and Metadata Override, and the guides show the `--props`-only workflow.

## Alternatives

- **Resolve on the Node side before the browser opens.** Rejected: it means evaluating the user's TSX entry in Node (React, browser-only module code, Vite config resolution), and preview mounts in the user's browser with no such step, so the two hosts would need two implementations of one contract.
- **Return the whole metadata instead of an override.** Rejected: every resolver would repeat width, height and FPS, and a mistake there would silently change resolution for one mount.
- **A second `defaultProps`-style metadata object.** Rejected for the same reason as `defaultProps`: it creates a second authority beside the declaration.
- **Add `composition.metadata-invalid`.** Rejected: the same invalid value would report a different code depending on whether it was declared or resolved, and agents would have to know which path produced it.
- **Mount, then remount with the resolved descriptor.** Rejected: two realms per mount, and preview cannot reload the page without losing the user's playhead and comments.
- **Let the resolver throw and catch it.** Rejected: a `Result` keeps the failure branch explicit and typed, per the coding guidelines.
- **Resolve for `listCompositions()` too.** Rejected: the list has no props, so there is nothing to resolve against; a list that invented a duration would be a second metadata authority.
