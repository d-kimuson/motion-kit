# Reference examples

Four complete videos that fix motion-kit's output quality. Each one stresses a different axis of the
framework, and each one is a consumer of the published package: an example imports
`@kimuson/motion-kit` by name and its own modules, never a relative path into `src/`.
[The reference-examples design doc](../docs/design-doc/20261025-reference-examples.md) owns the
layout, the CI gates and the acceptance look; each example's own `README.md` owns how to run it.

Nothing here is shipped in the npm package (`package.json#files` is `dist` only).

## The four targets

| Composition           | Resolution | fps | Frames       | Axis                                                                                  | CI gate                                                                        |
| --------------------- | ---------- | --- | ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `teaser`              | 1920×1080  | 30  | 720 (24 s)   | Dense springs and easing, a stagger of small elements, determinism under heavy motion | smoke renders `teaser-ci`, determinism runs `teaser-probe`                     |
| `explainer`           | 1920×1080  | 30  | 6660 (222 s) | Long duration, many `Sequence`s and `Transition`s, subtitles against audio            | smoke renders `explainer-ci`, determinism runs `explainer-probe`               |
| `chart`               | 1920×1080  | 30  | 600 (20 s)   | Schema-first props, inline SVG, animated numbers, regenerate from other data          | smoke renders `chart-ci` with a second dataset, determinism runs `chart-probe` |
| `slideshow`           | 1080×1920  | 30  | 900 (30 s)   | Vertical 9:16, Ken Burns, audio mixing, aspect switching                              | smoke renders `slideshow-ci`, determinism runs `slideshow-probe`               |
| `slideshow-landscape` | 1920×1080  | 30  | 900 (30 s)   | The same slide components at 16:9 (`useTimeline().width/height`)                      | descriptor plus one still frame in the smoke test                              |

## The short Compositions

Every example's entry holds more than one Composition, so `--composition <id>` is always required.
The `-ci` Compositions are half linear resolution and exactly 60 frames, and they reuse the full
example's scene components — never a simplified copy. The `-probe` Compositions live in a separate
`probe.tsx` registry, are 480×270 and 30 frames, and exist only for the determinism gate in
`src/render/determinism/examples.determinism.test.ts`.

| Composition       | Resolution | fps | Frames | Gate                                       |
| ----------------- | ---------- | --- | ------ | ------------------------------------------ |
| `teaser-ci`       | 960×540    | 30  | 60     | smoke MP4 (`teaser.smoke.test.ts`)         |
| `teaser-probe`    | 480×270    | 30  | 30     | determinism, frames `[0, 15, 29]`          |
| `explainer-ci`    | 960×540    | 30  | 60     | smoke MP4                                  |
| `explainer-probe` | 480×270    | 30  | 30     | determinism, frames `[0, 15, 29]`          |
| `chart-ci`        | 960×540    | 30  | 60     | smoke MP4, `--props` from a second dataset |
| `chart-probe`     | 480×270    | 30  | 30     | determinism, frames `[0, 15, 29]`          |
| `slideshow-ci`    | 540×960    | 30  | 60     | smoke MP4                                  |
| `slideshow-probe` | 480×270    | 30  | 30     | determinism, frames `[0, 15, 29]`          |

## Running an example

Every command runs from the repository root, because the CLI's `projectRoot` is `process.cwd()` and
React, ReactDOM and Zod resolve against the repository root:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/

node dist/cli.js render examples/teaser/entry.tsx --composition teaser --out out/teaser.mp4 --json

# An example with media: generate the placeholders first, then render
node examples/slideshow/fetch-assets.ts
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow --out out/slideshow.mp4 --json
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow-landscape --out out/slideshow-landscape.mp4 --json
```

`--out` picks the format from the extension: `.mp4` encodes H.264 with the system FFmpeg 6.0+ and
`libx264`, anything else writes PNG frames plus `manifest.json`. Render output belongs under `out/`,
which `.gitignore` already ignores; `assets.local/` is the only other generated location.

## What is a placeholder

- **`teaser` (TASK-206), `chart` (TASK-207), `slideshow` (TASK-208) and `explainer` (TASK-209) are
  the examples implemented so far.** Each row above is the shape its entry declares, and its
  `-ci`/`-probe` twins are the rows in the short-Composition table.
- **Motion is hand-rolled arithmetic.** `/motion` (`interpolate`, `easing`, `spring`, `Stagger`) and
  `/theme` are Phase 2 and have no public subpath yet, so every example computes its animation from
  `useTime()`/`useSequence()` with plain arithmetic and hard-coded values. The example that lands
  after Phase 2 replaces that arithmetic; the Composition ids and the acceptance look do not change.
- **`teaser`, `chart` and `slideshow` commit no font.** They draw with the system sans stack, so their
  frames are fixed on one machine rather than across machines: the determinism evidence is
  fixed-environment, as the
  [Phase 1 determinism record](../docs/contexts/render/knowledge/20261024-phase1-determinism.md)
  states. `explainer` is the exception the design doc allows: it commits Noto Sans JP, which is
  OFL-1.1, with `OFL.txt` beside it, and loads it through `useAsset({ kind: 'font' })`.
- **`explainer` and `slideshow` media are generated locally.** The voices, sprites, photos and music
  never enter the tree: `fetch-assets.ts` writes them into the gitignored `assets.local/`, and CI
  renders flat/generated placeholders (see the
  [asset licensing ADR](../docs/decisions/20261026-example-asset-licensing.accepted.md)). Both
  examples' `fetch-assets.ts` run in their own smoke test as its setup, so CI needs no committed
  bytes and no network.
- **`chart`'s committed datasets are synthetic**, shaped like an index so the example never waits on
  a data-source decision.
- **Every full-length render is a local QA Check**, not a CI step. CI renders each `-ci` Composition
  and runs each `-probe` Composition through the eight determinism modes.
