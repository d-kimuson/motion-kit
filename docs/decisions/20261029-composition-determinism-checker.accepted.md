# Ship a sampled composition determinism checker as `check` and `checkComposition`

## Context

A dialogue video exposed a visible authoring error that the existing evidence did not catch. A
`useLayoutEffect` fitted text to its line box once and guarded the measurement with a ref. The
measured subtree contained a frame-animated transformed descendant, so the width — and therefore the
font size — belonged to whichever frame first entered the renderer realm. A round-robin pool gave
adjacent frames different prefixes and the MP4 alternated font sizes. Every fresh-realm still looked
right. Rendering twice with the same `--concurrency` looked right too, because the pool deals frames
deterministically: the second render replays the first traversal and carries the same stale state.

The repository's internal determinism suite (`src/render/determinism/suite.ts`) already covers eight
traversal modes against repository probes, but it is not a package export and it compares exact PNG
bytes in a fixed environment. It cannot answer "is my Composition dependent on capture history?" for
an author's own project, and its byte tolerance is not a perceptual comparison. The
[determinism guide](../../guide/determinism.md) told authors to render twice and run `diff -r`,
which is insufficient for the reason above.

This decision adds a user-facing checker without changing the renderer, the pool, `render`, `frame`,
`docs`, or the internal suite's semantics. It follows the [CLI output contract](../contexts/agent/adr/20261024-cli-output-contract.accepted.md)
and the [context map](../CONTEXT-MAP.md): render owns capture and comparison, agent maps the report
to the envelope.

## Decision

### Interface

- The fourth shipped CLI subcommand is `motion-kit check <entry>` (`src/cli/commands.ts`,
  `CheckArgsSchema` in `src/cli/args.ts`). `inspect` and `validate` stay reserved.
- The library entry point is `checkComposition` from `@kimuson/motion-kit/render`
  (`src/render/check/check.ts`, re-exported by `src/render/index.ts`), with its public types
  (`CheckCompositionOptions`, `CheckReport`, `CheckSampleResult`, `CheckHistoryResult`,
  `CheckHistory`, `CheckComparison`, `CheckDifference`) and `defaultCheckComparison`.
- `checkReportPassed(report)` is true iff no diagnostic has severity `error`. The CLI uses it for the
  envelope's `ok`; there is no `passed` field in `data`.

### Histories

`CheckHistory` is the closed set `cold | after-earlier | after-later | pool`
(`src/render/check/history.ts`).

- `cold` — a freshly opened Renderer captures the sample frame as its first capture. This capture is
  the **reference** every other history is compared against.
- `after-earlier` — a dedicated Renderer captures `predecessor` (`p < f`), then `f`.
- `after-later` — a dedicated Renderer captures `predecessor` (`p > f`), then `f`.
- `pool` — the run's single two-Renderer pool captures the ascending window and `f` is read back
  from whichever Renderer the round-robin dealt it to.

The default predecessors for a sample `f` are `f - 1` and `f + 1`, each kept only when inside
`[0, durationInFrames)`. Explicit `--predecessor` values replace that list for every sampled frame.
The default histories are all four the inputs can support. An unrequested history the frame cannot
support is absent; a history requested explicitly (via `--history`) that cannot run, or a sample
that would be left with only the cold reference, is a `check.history-not-run` error.

The pool window for sample `f` and predecessor `p` is the ascending half-open range
`[max(0, min(f, p) - 1), min(durationInFrames, max(f, p) + 2))`. The result names the requested `p` as
`predecessor`; the pool's actual predecessor for `f` is whichever frame that Renderer captured
before it. Two Renderers are opened once per run and reused across samples in ascending sample order.

### Comparison

`CheckComparison` is a closed union (`src/render/check/compare.ts`):

```ts
type CheckComparison =
  | { mode: 'exact' }
  | { mode: 'pixels'; channelTolerance: number; maxChangedRatio: number; alpha: 'ignore' };
```

The default is `{ mode: 'pixels', channelTolerance: 32, maxChangedRatio: 0.002, alpha: 'ignore' }`.
`channelTolerance` is an integer 0..255 and `maxChangedRatio` is a number in 0..1.

- Pixels mode decodes both PNGs to 8-bit pixels and never compares compressed bytes. Exact mode
  compares the PNG byte buffers; it does not decode.
- A pixel **changed** iff any compared channel differs by **more than** `channelTolerance`
  (`|Δ| > channelTolerance`; `|Δ| == channelTolerance` is inside tolerance).
- `changedRatio = changedPixels / totalPixels` over the reference capture's pixel count. A capture is
  **within tolerance** iff `changedRatio <= maxChangedRatio` (inclusive).
- `alpha: 'ignore'` compares R, G and B only, as stored (straight alpha, no premultiplication); the
  alpha channel never changes a pixel's status and `maxChannelDelta` covers only compared channels.
  Chromium's PNG capture is opaque; a future alpha mode is a new union value.
- Differing dimensions are a `dimensions` difference and always count as `differs`.
- `maxChannelDelta` is the maximum absolute per-channel difference over compared channels and all
  pixels, reported even within tolerance.
- Exact mode reports `differentBytes`, `referenceBytes` and `actualBytes`. Exact byte identity and
  tolerance-based visual equality are distinct claims, and `comparison.mode` / each difference's
  `mode` names which one was used.

A status is `reference` for the cold capture, or `identical`, `within-tolerance` (pixels mode only)
or `differs`. The difference union is `exact | pixels | dimensions`; it is `null` only for the
reference. `src/render/check/png.ts` decodes non-interlaced 8-bit colour types 0, 2, 4 and 6 with all
five filter types using `node:zlib` only; an unsupported PNG is a contract violation converted by the
check layer to `internal.unexpected`, never thrown across the boundary.

### CLI data, diagnostics and exit codes

The envelope gains one strict `data` member with `command: 'check'` and `format: 'check'`
(`CheckDataSchema` in `src/agent/cli-output.ts`): the Composition id, descriptor dimensions, `fps`,
`frameCount`, the `comparison` actually used, and `samples`. Each sample carries its frame, the cold
reference dimensions, and its histories; each history carries its name, `predecessor` (`null` only
for cold), its own dimensions, `status`, and `difference`. There is deliberately no `passed` field and
no `durationSeconds`: a check passes iff the envelope is `ok: true`, a failing check retains `data` so
the caller can name the sample and histories that differed, and `check` is not a render.

The design adds three diagnostic codes to `src/lib/diagnostic.ts`; all are errors and the addition is
compatible, so `schemaVersion` stays `1`:

- `check.frame-differs` — a sample's warm capture differs from the cold reference under at least one
  history. `location.frame` is set. `details` is
  `{ frame, histories: [{ history, predecessor, status, difference }] }`, listing only histories
  whose status is `differs`.
- `check.history-not-run` — a requested history could not be produced, or a sample had no comparable
  capture. `location.frame` is set when the sample is known. `details` is
  `{ frame, history, reason }`, with `reason` one of `no-valid-predecessor`,
  `history-not-supported` or `sample-without-comparison`.
- `check.uncontrolled-time` — a capture emitted `seek.uncontrolled`; the checker refuses to certify
  instead of pretending. Has no `details`; the forwarded `seek.uncontrolled` warning stays.

The library produces every diagnostic, including forwarded capture warnings; the CLI only maps the
result to the envelope. Exit codes follow the existing contract: pass `0`; differing or otherwise
uncertified check `1`; invalid arguments `2`; internal failure `3`; cancellation emits no envelope and
exits `130`/`143`/`129`. Out-of-range sample or predecessor frames are reported after the descriptor
is known as `composition.props-invalid`, exit `1`. Validation before a browser opens also rejects
empty, repeated, negative or non-integer frames/predecessors, unknown or repeated histories, and
invalid comparison settings as `cli.invalid-arguments`. `--exact` with either tolerance flag is
`cli.invalid-arguments`.

The command writes no artifact. It accepts the same `--composition`, `--props`, `--project-root`,
`--vite-config`, `--software-webgl`, `--disable-sandbox` and `--json` options as the other commands,
plus repeatable/comma-separated `--frame`, `--predecessor` and `--history`, `--exact`,
`--channel-tolerance` and `--changed-ratio`.

### Why compressed-byte differences are not perceptual differences

Two PNG encoders, zlib runs or Chromium builds can produce different compressed bytes for identical
pixels. Reporting that as a visible difference would make ordinary rasterisation noise look like an
authoring bug and would hide the actual changed-pixel statistics the author needs. The default
therefore decodes the images and reports changed pixels, the changed ratio and the maximum channel
delta.

### Scope and non-guarantees

- A pass is evidence only for the sampled frames, the histories, comparison settings and environment
  actually used. It is not proof for the whole Composition and does not detect every authoring error.
- No cross-machine, cross-GPU or WebGL promise is added. The checker runs in the same environment as
  the renderer and inherits its limits.
- The internal determinism suite keeps its existing byte-exact semantics and probe coverage; this
  checker neither replaces it nor changes it. Framework probe coverage is evidence about those
  probes, not a guarantee for an arbitrary user Composition.
- Cost is proportional to the sample: one Renderer per cold capture, one per warm predecessor pair,
  and two for the shared pool. Long videos use explicit sampled frames and predecessors instead of a
  full sweep. The guide documents the workflow and the limits.

## Consequences

Authors can find capture-history dependence in their own project through the CLI or the public API,
and the failure names the frame, histories and difference statistics. The determinism guide no longer
recommends two renders plus `diff -r` as a sufficient check. The envelope, schema version and all
existing commands are unchanged; the new codes and the `check` command value are additive. The
renderer, pool and internal suite keep their behaviour, and the checker owns the new comparison code
in `src/render/check`.

The fixture `src/render/check/fixtures/traversal.tsx` is the runnable reproduction:
`traversal-dependent` fits against frame-dependent styles and fails, `traversal-fixed` fits against
frame-independent styles and passes. `src/render/check/traversal.check.test.ts` and
`src/cli/check.test.ts` record the verdicts, exit codes and messages.

## Alternatives

- **Render twice with the same concurrency and `diff -r`.** Rejected: the pool deals frames
  deterministically, so the second render repeats the first traversal and both can be wrong in the
  same way.
- **Expose the internal determinism suite as the public checker.** Rejected: it is built around
  repository probes and exact byte comparison in a fixed environment. Reusing its concepts (cold,
  warm, pool) is intentional; changing its tolerance or probe coverage is not.
- **Make the checker fail on any compressed-byte difference.** Rejected: compressed bytes are not a
  perceptual measure, and a byte difference can occur without a visible pixel changing.
- **Report a `passed` boolean in `data`.** Rejected: the envelope already defines pass/fail as
  `ok`/`error diagnostics`, and a second flag could disagree with it.
- **A fixed threshold with no configuration.** Rejected: the default is a starting point;
  `channelTolerance` and `maxChangedRatio` are explicit, and exact bytes stay available as a distinct
  claim.
