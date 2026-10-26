# `chart`

A 20-second chart of a synthetic index that draws itself on, drops a marker on every year, and
counts its final value up. It is the reference example for **schema-first props and inline SVG**: the
data is a validated Composition prop, so the same entry renders a second dataset from a second JSON
file and nothing about the layout moves — the y-domain, the tick count and the label positions are
computed from the points.
[The reference-examples design doc](../../docs/design-doc/20261025-reference-examples.md#chart--schema-first-props-svg-animated-numbers-regenerate-from-other-data)
owns the target; this file says how to run and read it.

## Compositions

| id            | Resolution | fps | Frames | Rendered by                                                |
| ------------- | ---------- | --- | ------ | ---------------------------------------------------------- |
| `chart`       | 1920×1080  | 30  | 600    | a local QA Check, never CI                                 |
| `chart-ci`    | 960×540    | 30  | 60     | `chart.smoke.test.ts` with the **second** dataset (CI)     |
| `chart-probe` | 480×270    | 30  | 30     | `src/render/determinism/examples.determinism.test.ts` (CI) |

- `chart`, `chart-ci` and `chart-probe` render the **same** `ChartScene`. Only the props and the
  `durationInFrames` differ: a shorter clip keeps the shape of the animation and scales every phase
  down (`planChart` in `scale.ts`), so the 60-frame twin draws on in 1 s rather than 3 s.
- `chart-probe` lives in its own `probe.tsx` registry because the determinism suite cannot take a
  nested props object: `DeterminismComposition.props` is a flat record, so the probe's dataset is a
  module constant there and its schema is empty. `chart` and `chart-ci` are what a reader renders.

## Files

| File                  | What it is                                                                     |
| --------------------- | ------------------------------------------------------------------------------ |
| `entry.tsx`           | The `chart` and `chart-ci` registry, and the Zod props schema                  |
| `probe.tsx`           | The `chart-probe` registry the determinism gate imports by path                |
| `chart.tsx`           | `ChartScene`, the inline `<svg>`                                               |
| `scale.ts`            | The timing plan, the two axes, the number format — all pure functions of data  |
| `data/index-30y.json` | The default dataset: 1995–2024, thirty yearly closes                           |
| `data/index-20y.json` | The second dataset: 2005–2024, rebased to 2005 = 100                           |
| `chart.smoke.test.ts` | The CI smoke test (descriptors, both datasets, the bad-props path, `chart-ci`) |

Each file under `data/` is a whole props object (`title`, `unit`, `source`, `series`), not a bare
array, so `--props "$(cat …)"` works verbatim and the year range is derived from the points instead
of being declared twice.

## The expected look

One large chart on a warm off-white ground, nothing decorative around it:

- **Palette.** Ground `#faf7f2`, ink `#14161c` (title and axes), muted `#6f6f77` (labels, legend,
  source), grid `#e2ddd4`, and one accent per series — `#c2410c` for the first, with `#1d4ed8` and
  `#0f766e` behind it so a second series would not need a new colour.
- **Layout**, as fractions of the frame: the plot box runs from 10.5% to 95.5% across and 23.5% to
  81.5% down; the title sits top-left above it, the legend row under the title, the unit label just
  above the y-axis, and the source line at 95.5% height.
- **Type** (at 1080p): a 49 px bold title, a 28 px legend, 26 px axis labels, a 56 px bold accent
  value label, and the 24 px grey source line the design doc asks for. No font is committed, so the
  stack is the system sans.
- **Geometry.** The axes are filled rectangles, not strokes — a 2 px ink spine and baseline, a wider
  and much lighter `#e2ddd4` gridline per y tick, a tick rectangle per year. Every length this chart
  hands to the rasteriser is a whole pixel and every font size a whole number, which is what keeps a
  frame one file (see the determinism note below).
- **The line** is a polyline at 4 px (0.35% of the height) that is drawn without antialiasing, and
  **the marker** is an open square, 14 px at 1080p with a 2 px accent outline, one per year. A square
  is not a stylistic preference here; it is the shape that has no antialiased edge.

## What moves, and what holds

- The axes, gridlines and labels fade in over the first 0.3 s.
- The line draws on left to right over the first 3 s of the clip (frames 0–90 of 600, and the draw is
  never more than half the clip, so `chart-ci` draws in 1 s). A marker appears as the draw reaches
  its year: it grows from about 45% of its size and comes to full opacity, so the head of the line is
  always the newest mark.
- The final value counts up from 0 over 1.5 s and lands at 16 s (frames 435–480), which is the last
  motion in the clip; the label itself fades in over its first four frames.
- **The rest of the frames are still, deliberately.** The draw finishes at 3 s and the count-up begins
  at 14.5 s, so frames 91–434 are one held image; the last 4 s are held too (every frame from 481 to
  599 renders the same picture). A still for review is therefore best taken at the end of the clip —
  and on the second dataset too, because the held frame is where the layout is fully populated.

## Running it

Every command runs from the repository root, because the CLI's `projectRoot` is `process.cwd()` and
React, ReactDOM and Zod resolve against it:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/

# The full chart, default dataset (needs FFmpeg 6.0+ with libx264 on PATH for the .mp4 route)
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-30y.json)" --out out/chart-30y.mp4 --json

# The same Composition, second dataset: same layout, new y-domain, new numbers
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-20y.json)" --out out/chart-20y.mp4 --json
```

`--composition` is always required: the entry holds two Compositions. `--out` picks the format from
the extension, and under `--json` the envelope carries `width`, `height`, `fps`, `frameCount` and
`durationSeconds`, which is how the smoke test asserts its own output.

**A still is a frames render, not `frame`.** `series` has no schema default, so the Composition always
needs `--props`, and `frame` has no `--props` flag (`src/cli/commands.ts`). Render PNG frames instead
and take the one you want:

```bash
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-30y.json)" --out out/chart-frames --json
# out/chart-frames/frame-00599.png is the held final frame; every frame and manifest.json are there

# A contact sheet: one frame every 50, tiled 4x3
ffmpeg -y -i out/chart-30y.mp4 -vf "select='not(mod(n\,50))',scale=480:-1,tile=4x3" \
  -frames:v 1 out/chart-30y-contact.png
```

## Getting it wrong

Omitting `--props` is the failure this example exists to show: the registry validates the props before
the first frame is captured, so the render stops with `composition.props-invalid` and the failing
path rather than a blank frame.

```bash
node dist/cli.js render examples/chart/entry.tsx --composition chart --out out/chart.mp4 --json
```

```json
{
  "code": "composition.props-invalid",
  "message": "Composition props must satisfy the schema and produce a JSON object.",
  "location": { "compositionId": "chart" },
  "details": {
    "issues": [
      { "code": "invalid_type", "path": ["series"], "message": "Invalid composition prop." }
    ]
  },
  "severity": "error"
}
```

That is the one entry of `diagnostics` in the `--json` envelope, which also carries `schemaVersion`,
`command`, `ok: false`, `data: null` and a `hint`. It is shown on its own because it is the part a
reader matches on. The command exits 1 and writes no file. The other three documented failures hold
too: a missing entry is `cli.entry-not-found` (exit 2), an unknown id is `cli.composition-not-found`,
and `--props` that is not a JSON object string is `cli.invalid-arguments`.

## The two CI gates

```bash
pnpm test --project cli examples/chart/chart.smoke.test.ts                       # chart-ci
pnpm test --project frame-transport src/render/determinism/examples.determinism.test.ts
```

The smoke test checks the three descriptors, validates both committed datasets against the props
schema, asserts that a missing `series` fails at `["series"]`, and renders `chart-ci` with
`data/index-20y.json` — so CI covers the regeneration axis rather than only the default data — then
asserts the envelope and the file with `ffprobe`: 60 frames, `30/1`, 960×540, a 2.000 s duration and a
clean FFmpeg decode. `pnpm test` builds `dist/` first (`pretest`), so the shipped CLI is the thing
under test.

The determinism gate runs `defineDeterminismSuite` over `probe.tsx` — reached as a module path string,
never imported by an example — at frames `[0, 15, 29]`, exact PNG bytes, all seven traversal modes.

## The data, and its provenance

**Both datasets are synthetic.** They were authored for this repository, shaped like a real index so
the example never waits on a data-source decision: `index-30y.json` is 30 yearly closes from 100 in
1995 to 742 in 2024, and `index-20y.json` is the shorter window 2005–2024 rebased to 2005 = 100,
ending at 421. Neither is a real index, a fund, or investment advice, and the `source` prop carries
that sentence into the frame so a viewer of the video reads it too. Which public series may be used,
and how it would be cited, is an open question in the design doc; swapping in a real one is a new
file under `data/` and no code change.

## Known limitations

- **The type is the system sans stack, so the look is fixed per machine, not across machines.**
  Committing an OFL font with its `OFL.txt` is allowed and is not done here, so the determinism
  evidence is fixed-environment, as the
  [Phase 1 determinism record](../../docs/contexts/render/knowledge/20261024-phase1-determinism.md)
  says.
- **No antialiased curve anywhere, and that is load-bearing.** A stroked circle marker made the probe
  fail four of the seven modes: the sequential capture of frame 29 and a re-capture in a fresh
  renderer disagreed on eight pixels of one marker's arc edge, by at most 8/255, and the byte
  comparison failed on the whole PNG. Chromium recomputes an antialiased edge's coverage per paint and
  the result is not history-independent, so the marks are axis-aligned rectangles, the polyline is
  drawn with `shapeRendering="crispEdges"`, and every coordinate is a whole pixel. Replacing a marker
  with a `<circle>`, or the polyline's `crispEdges` with smoothing, brings the failure back. See
  [the troubleshot](../../.agents/troubleshots/chromium-antialiased-edge-png-drift.md).
- **Motion is hand-rolled arithmetic.** `/motion` (`interpolate`, `easing`) and `/theme` are Phase 2
  and have no public subpath, so `scale.ts` implements `clamp01`/`easeOutCubic`/the timing plan and
  `chart.tsx` hard-codes the palette. The example that lands after Phase 2 replaces both; the
  Composition ids and the acceptance look do not change.
- **No `Intl`.** `formatNumber` groups thousands by hand: ICU data differs between a developer machine
  and the CI runner, and the gate compares PNG bytes.
- **`frame` cannot render this example.** A still is a frames render (above); `--props` on `frame` is a
  CLI follow-up, not this example's.

## Assets and credit

**This example commits two JSON files, no media and no font.** Both are authored for the repository,
so they need no credit line and the
[asset licensing ADR](../../docs/decisions/20261026-example-asset-licensing.accepted.md) grants
nothing here; `assets.manifest.json` is not needed.
