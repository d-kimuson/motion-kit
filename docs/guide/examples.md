# Examples

Four complete videos live under `examples/`. Each one is a consumer of the published package — it
imports `@kimuson/motion-kit` by name and never a relative path into `src/` — and each one fixes the
output quality bar for one axis of the framework. They are the best answer to "what does a real
Composition look like?".

The examples ship in the repository, not in the npm package, which contains `dist/` and the
documentation you are reading. Every command below therefore runs from a checkout:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/
```

An `.mp4` target also needs FFmpeg 6.0+ with `libx264` on `PATH`, and `ffprobe` for a Composition that
declares audio.

## The four videos

| Composition           | Resolution | fps | Frames | Axis                                                                         |
| --------------------- | ---------- | --- | ------ | ---------------------------------------------------------------------------- |
| `teaser`              | 1920×1080  | 30  | 720    | Dense springs and easing, a stagger of small elements, motion everywhere     |
| `explainer`           | 1920×1080  | 30  | 6660   | Long duration, many `Sequence`s and `Transition`s, subtitles against audio   |
| `chart`               | 1920×1080  | 30  | 600    | Schema-first props, inline SVG, animated numbers, regenerate from other data |
| `slideshow`           | 1080×1920  | 30  | 900    | Vertical 9:16, Ken Burns, asset readiness, aspect switching                  |
| `slideshow-landscape` | 1920×1080  | 30  | 900    | The same slide components at 16:9                                            |

Every entry holds more than one Composition, so `--composition <id>` is always required.

## Commands

Run from the repository root. Each line was rendered against the built package.

**teaser** — no props, no media:

```bash
node dist/cli.js render examples/teaser/entry.tsx --composition teaser --out out/teaser.mp4 --json
node dist/cli.js frame examples/teaser/entry.tsx --composition teaser --frame 300 --out out/teaser-300.png
```

**explainer** — generates its placeholders first, then renders. The full render is 6660 frames and
takes minutes; it is a local check, not a CI step:

```bash
node examples/explainer/fetch-assets.ts --placeholders     # music bed, whoosh, silent voice clips
node dist/cli.js frame examples/explainer/entry.tsx --composition explainer --frame 2200 --out out/explainer-2200.png
node dist/cli.js render examples/explainer/entry.tsx --composition explainer --out out/explainer.mp4 --json
```

**chart** — its props are always supplied, so the still route is a frames render rather than `frame`:

```bash
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-30y.json)" --out out/chart-30y.mp4 --json

# The same Composition, second dataset: same layout, new y-domain, new numbers
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-20y.json)" --out out/chart-20y.mp4 --json

# A still: render PNG frames and take the one you want
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-30y.json)" --out out/chart-frames --json
```

**slideshow** — generates its placeholders first, and renders at both aspects:

```bash
node examples/slideshow/fetch-assets.ts                    # eight photos and a tone bed, no network
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow --out out/slideshow.mp4 --json
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow-landscape \
  --out out/slideshow-landscape.mp4 --json
node dist/cli.js frame examples/slideshow/entry.tsx --composition slideshow-landscape \
  --frame 400 --out out/slideshow-400.png
```

A render started before `fetch-assets.ts` runs fails with `asset.load-failed` naming the missing file
instead of rendering a blank frame.

## The short Compositions

Every example also declares a short twin, so a full-length review is never needed to check a change.
They reuse the real scene components — never a simplified copy.

| Composition       | Resolution | fps | Frames | Purpose                              |
| ----------------- | ---------- | --- | ------ | ------------------------------------ |
| `teaser-ci`       | 960×540    | 30  | 60     | smoke MP4 (CI)                       |
| `explainer-ci`    | 960×540    | 30  | 60     | smoke MP4 (CI)                       |
| `chart-ci`        | 960×540    | 30  | 60     | smoke MP4 with a second dataset (CI) |
| `slideshow-ci`    | 540×960    | 30  | 60     | smoke MP4 (CI)                       |
| `teaser-probe`    | 480×270    | 30  | 30     | determinism gate                     |
| `explainer-probe` | 480×270    | 30  | 30     | determinism gate                     |
| `chart-probe`     | 480×270    | 30  | 30     | determinism gate                     |
| `slideshow-probe` | 480×270    | 30  | 30     | determinism gate                     |

```bash
node dist/cli.js render examples/teaser/entry.tsx --composition teaser-ci --out out/teaser-ci.mp4 --json
node dist/cli.js render examples/chart/entry.tsx --composition chart-ci \
  --props "$(cat examples/chart/data/index-20y.json)" --out out/chart-ci.mp4 --json
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow-ci --out out/slideshow-ci.mp4 --json
node dist/cli.js render examples/explainer/entry.tsx --composition explainer-ci --out out/explainer-ci.mp4 --json
```

The probes live in each example's `probe.tsx` and exist only for the determinism suite. They draw
opaque, whole-pixel rectangles rather than glyphs, images or fractional opacity, because the gate
compares exact PNG bytes on macOS and on the Linux runner — see
[determinism](determinism.md#what-breaks-it).

## What is a placeholder

Nothing third-party is committed under `examples/`. What a clone renders by default is generated,
drawn or synthetic, and each example says which:

| Example     | Placeholder                                                              | Real thing                                            |
| ----------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| `teaser`    | Nothing — text, CSS gradients and arithmetic                             | —                                                     |
| `chart`     | Two synthetic datasets shaped like an index                              | A real series, cited on screen and in its README      |
| `slideshow` | Eight FFmpeg `gradients`/`noise` stills, one tone bed                    | A licensed CC0 photo per slide                        |
| `explainer` | Badge characters, a synthesised music bed and whoosh, silent voice clips | VOICEVOX voice and the two portraits the engine ships |

`explainer` and `slideshow` share one props switch, so a run without the fetched media is still a
complete video:

```bash
# placeholder (the default): generated media and the committed font
node dist/cli.js render examples/explainer/entry.tsx --composition explainer --out out/explainer.mp4

# final: the locally generated voice and portraits
node dist/cli.js render examples/explainer/entry.tsx --composition explainer \
  --props '{"assets":"final"}' --out out/explainer-final.mp4
```

The switch is not a licence mechanism: nothing third-party becomes committed by taking it.

## Asset policy

The rule the examples follow is that a committed file must be redistributable by every clone:

- **Committed**: the Noto Sans JP variable font (OFL-1.1) with its `OFL.txt` beside it under
  `examples/explainer/assets/fonts/`, and the authored JSON datasets under `examples/chart/data/`.
- **Generated, gitignored** under `examples/<name>/assets.local/`: the slideshow's photos and tone
  bed, the explainer's music bed, whoosh and silent voice clips. A re-run writes byte-identical
  files, so a clone and CI generate the same stills.
- **Fetched locally, never committed**: VOICEVOX voice clips and the two character portraits, written
  by `examples/explainer/fetch-assets.ts` against a local engine (`VOICEVOX_ENGINE_URL`, default
  `http://127.0.0.1:50021`).
- **Credited**: the explainer carries the voice, illustrator, character-project and font credit lines
  in its README and on the video's credit slide, as the repository's asset licensing rules require.

Each example also commits an `assets.manifest.json` listing every file under `assets/` and
`assets.local/` with its source and licence. No script reads it; it is reviewed with the example's PR.

## The CI gates

```bash
pnpm test --project cli examples/teaser/teaser.smoke.test.ts
pnpm test --project frame-transport src/render/determinism/examples.determinism.test.ts
```

Each smoke test renders its `-ci` Composition through `node dist/cli.js render … --json` and asserts
the envelope and the file with `ffprobe` (60 frames, `30/1`, the reduced resolution, a 2.000 s
duration, a clean decode). The determinism test runs all eight traversal modes over each `-probe`
Composition at frames `[0, 15, 29]`, exact PNG bytes.

CI never renders a full-length video: the full renders are human QA checks. Every CI render is silent,
because the fetched voice and music are local-only and never committed.

## Read one example end to end

Each example has a README of its own beside its entry file, in a checkout of the repository:

- `examples/teaser/README.md` — dense motion, and the two rendering choices that are load-bearing for
  its gate.
- `examples/explainer/README.md` — five layers over one storyboard, the regions, the credit lines and
  what is committed.
- `examples/chart/README.md` — schema-first props, the SVG, the `composition.props-invalid` path, and
  the antialiasing findings.
- `examples/slideshow/README.md` — Ken Burns, aspect switching, the dissolve arithmetic and the
  generated placeholders.

The layout, the CI budget and the acceptance look each example is measured against are recorded in
the repository's design notes beside the examples guide.

## Related

- [Authoring](authoring.md) — the APIs these examples use.
- [Determinism](determinism.md) — why each example has a probe, and what the probes draw.
- [Troubleshooting](troubleshooting.md) — the `asset.load-failed` a missing placeholder produces.
