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

The determinism suite is not a package export in 0.0.1, but the property it checks is reproducible by
hand with the CLI: render the same Composition twice into two directories and compare the files.

```bash
motion-kit render entry.tsx --composition hello --out out/det-a --json
motion-kit render entry.tsx --composition hello --out out/det-b --json
diff -r out/det-a out/det-b && echo IDENTICAL
```

```text
IDENTICAL
```

`diff -r` compares the PNGs and `manifest.json`; the manifest carries no timestamp, so a clean render
pair is identical file for file. A difference names the frame that moved, which is the frame to
inspect for a wall clock, a random value or an antialiased edge.

For a cheaper loop, render a short Composition of the same structure — the examples keep a
`-probe`/`-ci` twin of each full video for exactly this reason
([examples](examples.md#the-short-compositions)).

## Related

- [Authoring](authoring.md) — the hooks a deterministic Composition derives from.
- [Examples](examples.md) — how each reference video's determinism gate is set up and why its probe
  draws flat surfaces.
