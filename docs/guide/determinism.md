# Determinism

motion-kit's central promise is that **a frame is a pure function of its index**. The renderer seeks
the page to frame `n`, waits until the tree and every asset it declared are ready, captures the
pixels, and moves on. Nothing about how it got there — the order the frames were captured in, which
renderer captured them, how long the page had been open — is allowed to change the bytes.

This page states what that guarantee covers, what it does not, and how to check your own Composition.

## What is guaranteed

- **Traversal independence, in one fixed environment.** Capturing a frame after a sequential sweep,
  in a random order, in reverse, repeatedly, in a fresh realm, after holding a session, alone in a
  freshly opened renderer, or through a two-renderer pool produces byte-identical PNGs. The suite
  that checks this lives in `src/render/determinism` and runs in CI (`pnpm test --project
  frame-transport`); it compares exact bytes against the sequential baseline, and it fails closed
  when a mode did not run.
- **Readiness before capture.** A frame is captured only after the readiness barrier drains the
  Composition's content acknowledgement and every pending asset registration. A timer is never
  treated as readiness, so a slow font does not produce a frame of fallback glyphs.
- **Pool independence.** `render --concurrency <n>` deals frames across `n` renderers; a frame's
  bytes do not depend on which one captured it, and the suite's `concurrent` mode checks exactly
  that.
- **The output of a render is a file, not a stream of surprises.** The `.mp4` route captures JPEG
  (quality 95) instead of PNG because the H.264 encode is lossy anyway; the frames route writes PNG.
  Both are deterministic in the same sense — the same Composition rendered twice under the same
  conditions produces the same files.
- **The shapes the suite covers:** DOM text with a `useAsset` font, CSS transform driven by the
  frame, SVG path geometry, canvas 2D drawing (with sustained passes), `Sequence` boundaries,
  `TransitionSeries` overlaps with `useTransitionProgress`, and nested `Suspense` around font and
  image assets.

## What breaks it

These are the ways a Composition stops being a pure function of time. The suite cannot detect them
for you — they are authoring errors:

- **Wall clock and randomness.** `Date.now()`, `performance.now()`, `new Date()`,
  `Math.random()`, an unseeded generator, a `setTimeout`-driven value. Derive everything from
  `useFrame()`, `useTime()`, `useSequence()` or `useTimeline()`.
- **CSS animation and transition.** A `transition` or `@keyframes` animation runs on the browser's
  own clock, not on the frame index: its value at capture time depends on when the capture happened.
  Drive the animated property from a hook instead.
- **State that accumulates across frames.** `useState` that adds to itself on every render, a module
  counter, a cache keyed by visit order. A frame must be reproducible from its index alone.
- **Layout measured from frame-dependent styles.** A `useLayoutEffect` that fits text by measuring a
  subtree containing a frame-animated transform chooses the size of whichever frame entered the
  realm first, and keeps it. Fit frame-independent styles or derive the size from the frame index;
  the `traversal-dependent` fixture under `src/render/check/fixtures` reproduces it. The
  [checker section](#example-layout-measured-through-a-frame-animated-descendant) explains why.
- **Network and external inputs.** A remote image, a fetch, a clock-driven external API: besides
  breaking determinism, a remote URL is not served by the project root and is outside the render
  boundary.
- **Locale- and ICU-dependent formatting.** `Intl.NumberFormat`, `toLocaleString` and friends use
  ICU data that differs between a developer machine and the CI runner. Format by hand if you want
  portable bytes.
- **Antialiased edges, when you need byte equality.** Chromium recomputes an antialiased edge's
  coverage per paint, so a curved or fractionally positioned edge can differ by a few pixels between
  two paints of the same frame. The [reference examples](examples.md) work around it with whole-pixel
  coordinates, opaque axis-aligned rectangles and `shapeRendering="crispEdges"`; their READMEs record
  which construct failed and by how many bytes. A Composition that only needs to _look_ right does
  not have to care; one that wants byte equality does.
- **Transformed text layers.** A glyph run inside a transformed layer rasterises differently between
  paints; the slideshow example therefore keeps its captions outside the Ken Burns transform.

## What is not guaranteed

- **Byte equality across machines.** The suite's evidence is fixed-environment: one macOS arm64
  machine and the Linux CI runner, each comparing against its own sequential baseline. A different
  OS, GPU, Chromium build or device pixel ratio may rasterise the same tree differently. Cross-GPU
  and cross-platform certification is later work, with an explicit
  `{ purpose: 'cross-environment', maxDifferentBytes }` tolerance at the call site rather than exact
  bytes.
- **Headless versus headed Chromium.** Not compared.
- **Linux qualification as a whole.** CI runs the suite on the Linux runner, which is evidence, not
  certification of every Linux GPU stack.
- **Encoded audio.** Muxing is tested for onset alignment and for the declared gain — the AAC stream
  starts within a frame of its declared offset — but the encoded audio samples are not compared byte
  for byte.
- **Integrations with uncontrolled time.** An integration that registers uncontrolled time (Tier C)
  makes the render emit a `seek.uncontrolled` warning, and the determinism suite refuses to certify
  that Composition instead of pretending. No such integration ships in 0.0.1; the warning exists so a
  later one cannot claim determinism silently.
- **WebGL, Three.js and video.** No Three.js example ships in 0.0.1 (`/three` is a later phase), and
  video assets do not exist yet, so neither is covered.

## A recorded limit: an image inside a `Sequence`

There is one observed, intermittent failure that is worth knowing about, because it was reproduced
and then not reproduced:

- An image loaded through `useAsset({ kind: 'image' })` inside `<Sequence from={0.5} duration={1}>`,
  within a `TransitionSeries`, failed the suite's `reverse` mode twice — once at frame 44 of a
  1920×1080, 120-frame Composition (`1697` differing bytes, `39832` vs `39830`), once at frame 38 of
  a 480×270, 60-frame Composition (`3269` differing bytes, `3494` vs `3534`).
- The other six modes passed on both runs, and twelve further runs across four shapes passed
  completely.

Two failures of one mode on one construct were enough to keep that construct out of the example
probes — the probes draw flat surfaces instead of images — and not enough to call the path broken. It
is recorded as an observed, intermittent race with the frames and byte counts as evidence, not as a
settled defect. If you compare bytes of a Composition that loads an image inside a `Sequence`, expect
this to be the first thing to check.

## Check your own Composition

The determinism suite is not a package export, but the property it checks is: `motion-kit check` and
the `checkComposition` API from `@kimuson/motion-kit/render` capture the same frame after different
capture histories and compare the results. This guide ships in the package as well
(`motion-kit docs determinism`), so the workflow below works from an installed copy.

### Why two renders can agree and still be wrong

Rendering the same Composition twice with the same `--concurrency` is not a determinism check. The
pool deals frames to renderers deterministically, so a second identical render replays the first's
traversal: every renderer sees the same predecessors in the same order. If a frame's layout depends
on which frame entered its realm first, both renders carry the same stale state and produce the same
wrong pixels. `diff -r` then reports them identical.

What makes the dependence visible is a different history: a different `--concurrency`, a different
sample set, or a cold single-frame capture whose realm has never rendered anything else. Comparing
two concurrency values is useful supplemental evidence, but it samples only two of the possible
traversals and cannot prove the absence of others.

### Histories

Every sample frame is captured after four histories. `cold` is the reference that every other history
is compared against:

| History         | What the capture does                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cold`          | A freshly opened Renderer captures the sample frame as its first capture. This is the reference.                                                              |
| `after-earlier` | A dedicated Renderer captures a predecessor `p < f`, then `f`.                                                                                                |
| `after-later`   | A dedicated Renderer captures a predecessor `p > f`, then `f`.                                                                                                |
| `pool`          | The run's single two-Renderer pool captures the ascending window around the sample, and `f` is read back from whichever Renderer the round-robin dealt it to. |

By default a sample at frame `f` uses `f - 1` and `f + 1` as its predecessors, each kept only when it
is inside `[0, durationInFrames)`. `--frame` and `--predecessor` are repeatable or comma-separated;
explicit `--predecessor` values replace the default list for every sampled frame. The pool renders
the ascending half-open range `[max(0, min(f, p) - 1), min(durationInFrames, max(f, p) + 2))` and
reads back `f`; the `predecessor` in the report names the requested `p`, while the frame that pool
Renderer actually captured before `f` is whichever frame of that window it was dealt.

At scene boundaries a sample may not support every history: frame `0` has no earlier frame and the
last frame has no later one. Such a history is absent from the sample when it was not requested;
when it was requested (with `--history`) or would leave the sample with no comparison at all, the
check fails with `check.history-not-run` instead of passing without it. A history that did not run is
not evidence.

### Run the check

For a short video, sample a few frames and let the defaults produce the earlier, later and pool
histories:

```bash
motion-kit check entry.tsx --composition hello --frame 2,6
```

The `traversal-dependent` fixture in this repository is a Composition that looks plausible until a
warm realm enters it on a different frame. The same shape of check reports it (`--json` shown trimmed
to the finding):

```bash
motion-kit check entry.tsx --composition traversal-dependent --frame 2,6 --json
```

```json
{
  "schemaVersion": 1,
  "command": "check",
  "ok": false,
  "data": { "format": "check", "composition": "traversal-dependent", "frameCount": 12 },
  "diagnostics": [
    {
      "code": "check.frame-differs",
      "severity": "error",
      "message": "A warm capture of frame 2 differs from its cold reference.",
      "location": { "compositionId": "traversal-dependent", "frame": 2 },
      "details": {
        "frame": 2,
        "histories": [
          {
            "history": "after-earlier",
            "predecessor": 1,
            "status": "differs",
            "difference": {
              "mode": "pixels",
              "totalPixels": 14400,
              "changedPixels": 1189,
              "changedRatio": 0.08256944444444445,
              "maxChannelDelta": 224
            }
          }
        ]
      }
    }
  ]
}
```

That run exits `1` and also reports the `after-later` and `pool` histories as differing. The
`traversal-fixed` Composition is the same scene fitted against frame-independent styles; the same
check exits `0`, every warm status is `identical`, and `diagnostics` is empty:

```bash
motion-kit check entry.tsx --composition traversal-fixed --frame 2,6 --json
```

Without `--json`, a passing run prints one line on stdout and a failing run writes the diagnostic and
the summary to stderr, for example:

```text
checked 1 of 12 frames (2) across 2 histories: frame 2 differs in after-earlier (8.3% of pixels) in
2353.3ms
```

For a long video, do not sweep every frame. Sample a few frames — scene starts, transition edges, a
frame before and after a large layout change — and pass an explicit predecessor for each so the run
captures only those windows. For example, a long `explainer` composition:

```bash
motion-kit check entry.tsx --composition explainer \
  --frame 600,1200,1800,2400 \
  --predecessor 599,1199,1799,2399 \
  --history after-earlier --json
```

The pool renders only the ascending window around a sample and its predecessor, not the whole
`[0, durationInFrames)` range; a far-away predecessor widens that window, so a long-video recipe
that keeps `pool` should pair each frame with a nearby predecessor, or restrict the run to
`after-earlier`/`after-later`. The `frameCount` in the report tells you how many frames the
Composition has, not how many were captured.

### The API

The CLI is a thin mapper over the same engine, which is available from
`@kimuson/motion-kit/render`:

```ts
import { checkComposition, checkReportPassed } from '@kimuson/motion-kit/render';

const result = await checkComposition({
  projectRoot: process.cwd(),
  entry: 'entry.tsx',
  compositionId: 'hello',
  frames: [2, 6],
  predecessors: [1, 5],
  comparison: { mode: 'pixels', channelTolerance: 32, maxChangedRatio: 0.002, alpha: 'ignore' },
});
```

`result` is a `Result<CheckReport>` or an aborted result. `report.samples` names every sample frame,
its cold reference dimensions and each history with its predecessor, status and difference;
`report.diagnostics` carries forwarded capture warnings and the checker's findings, and
`checkReportPassed(report)` is true iff none has severity `error`. `frames` is required; omitting
`predecessors` or `histories` uses the defaults described above.

### Exact bytes or pixel tolerance

The default comparison decodes both PNGs and compares pixels. `--channel-tolerance` (default `32`)
is an integer from 0 to 255 and `--changed-ratio` (default `0.002`) is a number from 0 to 1:

- A pixel **changed** iff any compared channel differs by **more than** the tolerance. `|Δ| == 32` is
  inside the tolerance; `|Δ| == 33` is outside.
- `changedRatio = changedPixels / totalPixels`. A capture is **within tolerance** iff
  `changedRatio <= maxChangedRatio`, so exactly `0.002` is inside.
- Alpha is ignored: Chromium's PNG capture is opaque, and R, G and B are compared as stored (straight
  alpha, no premultiplication).
- Differing dimensions are a `dimensions` difference and always count as `differs`; the pixels are
  never silently compared.
- `maxChannelDelta` is the largest absolute per-channel difference over the compared channels; it is
  reported even when the capture is within tolerance.

`--exact` instead compares the two PNG byte buffers and reports `differentBytes`, `referenceBytes`
and `actualBytes`. Exact byte identity and tolerance-based visual equality are **distinct claims**,
and the report's `comparison.mode` and each difference's `mode` say which one was used. Pixels mode
compares decoded output; exact mode compares the PNG buffers themselves. Neither treats a
compressed-byte offset as a perceptual measure: two PNG buffers can differ in bytes without a
visible pixel changing, which is why the default is pixel based.

### Example: layout measured through a frame-animated descendant

A common authoring bug is a `useLayoutEffect` that fits a headline to its line box once, guards with a
ref so it never measures again, and keeps that font size for the realm's lifetime. If the measured
subtree contains a descendant whose transform follows the frame, the measured width belongs to
whichever frame first entered the realm. A warm realm that first rendered frame `p` keeps `p`'s font
size when it later renders `f`, so adjacent frames can alternate sizes even though each fresh-realm
still looks fine.

The fix is to measure frame-independent styles — the text width plus the marker's untransformed
footprint, not the transformed descendant — or to derive the size from the frame index instead of
measuring at all. `src/render/check/fixtures/traversal.tsx` contains both: `traversal-dependent`
reproduces the bug and `traversal-fixed` fits frame-independent styles. Its
`traversal.check.test.ts` proves the checker fails the first and passes the second.

### Limits and cost

A pass is evidence only for the frames, histories, comparison settings and environment actually
sampled. It is not a claim about other frames, another machine, another GPU or WebGL. The framework's
own probe suite covers eight traversal modes across the reference probes, but that is evidence about
those probes, not a guarantee for an arbitrary user Composition. The checker finds the dependence it
can observe; it cannot detect every authoring error, and a clean run is not proof that a Composition
is deterministic everywhere.

Each cold capture opens a Renderer. Each `after-earlier` or `after-later` history opens its own
Renderer for the predecessor pair, disposed with that sample. The two-Renderer pool opens once and is
reused across samples. A run therefore costs roughly one Renderer per cold sample, one per warm
predecessor pair, plus two for the pool; keep the sample list small and targeted rather than sweeping
a long video. Start with the frames around scene boundaries and layout changes, then add frames where
a failure points.

## Related

- [Authoring](authoring.md) — the hooks a deterministic Composition derives from.
- [Examples](examples.md) — how each reference video's determinism gate is set up and why its probe
  draws flat surfaces.
