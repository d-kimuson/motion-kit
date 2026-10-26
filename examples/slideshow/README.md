# `slideshow`

A 30-second vertical (9:16) slideshow: eight full-bleed photos, a slow Ken Burns move on each, white
captions in the lower third and 0.5-second crossfades between them. It is the reference example for
**asset readiness, aspect switching and audio mixing** — the same components render at 16:9 without a
second implementation, and every photo is a generated placeholder until a real one is licensed.
[The reference-examples design doc](../../docs/design-doc/20261025-reference-examples.md#slideshow--916-vertical-ken-burns-audio-mixing-aspect-switching)
owns the target; this file says how to run and read it.

## Compositions

| id                    | Resolution | fps | Frames | Rendered by                                                |
| --------------------- | ---------- | --- | ------ | ---------------------------------------------------------- |
| `slideshow`           | 1080×1920  | 30  | 900    | a local QA Check, never CI                                 |
| `slideshow-landscape` | 1920×1080  | 30  | 900    | a local QA Check; CI renders one still (`frame`)           |
| `slideshow-ci`        | 540×960    | 30  | 60     | `slideshow.smoke.test.ts` (CI)                             |
| `slideshow-probe`     | 480×270    | 30  | 30     | `src/render/determinism/examples.determinism.test.ts` (CI) |

- `slideshow` and `slideshow-landscape` render the **same** `SlideshowScene` with the same slides and
  the same timeline; only the frame differs. `slideshow-ci` renders the same component with the first
  three slides at half linear resolution. Nothing is a simplified copy: the slide count, the crossfade
  length and every geometry value come from the Composition's own `durationInFrames`, `frameRate`,
  `width` and `height`.
- `--composition` is always required: the entry holds three Compositions.

## Files

| File                      | What it is                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- |
| `slides/plan.ts`          | The slide list, the timing plan, the Ken Burns arithmetic and `layoutFor`     |
| `slides/slides.tsx`       | `SlideshowScene`, the picture layer, the caption, the pending panel, the fade |
| `slides/flat.tsx`         | The probe's flat surface: shapes only, no file                                |
| `entry.tsx`               | The `slideshow`, `slideshow-landscape` and `slideshow-ci` registry            |
| `probe.tsx`               | The `slideshow-probe` registry the determinism gate imports by path           |
| `fetch-assets.ts`         | Node + FFmpeg: the placeholder photos and the tone bed into `assets.local/`   |
| `slideshow.smoke.test.ts` | The CI smoke test (descriptors, `slideshow-ci` MP4, one landscape still)      |

## The expected look

Full-bleed pictures over a near-black ground (`#0b0b0d`), white type with a soft shadow, one 0.5-second
dissolve between slides:

- **Ken Burns.** Each slide's picture zooms from 1.0 to 1.12 across its whole life and drifts ±4% of
  the frame, the direction alternating per slide. The pan is scaled by the same progress as the zoom,
  so it always stays inside the room the zoom has created: at 1.0 the picture exactly fills the frame
  and cannot slide away from an edge, which is why the first frame of a slide has no gap. Progress
  comes from `useSequence().time / useSequence().duration`, so it is the slide's own position, and a
  crossfade continues each side's move instead of restarting it.
- **Captions.** A two-digit kicker (`02 / 08`) and the caption, in the lower third, over a gradient
  scrim. Both come from the slide list in `plan.ts`, never from the file, so a slide whose photo never
  arrives still says which slide it is. The type scale is 7.5% of the **shorter** side, so 1080×1920
  and 1920×1080 use the same size and the caption stays inside the safe area at both aspects.
- **Crossfade.** The outgoing picture is the opaque base of the fade and the incoming one dissolves in
  over it at `p`, so a frame is exactly `(1 - p)·outgoing + p·incoming`: full brightness throughout,
  never a dip towards the ground. Each slide keeps its ink ground _inside_ its own fading layer — an
  opaque ground on the stacked upper frame paints over the picture below it, which turns the dissolve
  into a fade from black. The captions use the faster `p³` pair and the incoming one is held back to
  the midpoint of the fade, so two legible captions never sit on top of each other: the outgoing
  caption is nearly gone before the incoming one starts. In the middle of a 0.5-second fade the
  outgoing caption is at `(1 - p)³ ≈ 0.13` and the incoming one is still at zero — that faint
  outgoing line is the intended swap, not a dropped frame.
- **Music.** `fetch-assets.ts` writes a 30-second `sine`/`anoisesrc` tone bed that fades in and out and
  ends with the last slide. No Composition declares audio yet (TASK-171), so nothing muxes it: the
  video is silent, and the file is what the muxing step will read.

## Running it

Every command runs from the repository root, because the CLI's `projectRoot` is `process.cwd()` and
React, ReactDOM and Zod resolve against it:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/

# The generated placeholders: eight photos and the tone bed, no network, nothing committed
node examples/slideshow/fetch-assets.ts        # add --force to regenerate

# The full 30-second vertical slideshow (needs FFmpeg 6.0+ with libx264 on PATH for the .mp4 route)
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow --out out/slideshow.mp4 --json

# The same components at 16:9
node dist/cli.js render examples/slideshow/entry.tsx --composition slideshow-landscape --out out/slideshow-landscape.mp4 --json

# A still frame for visual review (frame 400: the fourth slide, outside every crossfade)
node dist/cli.js frame examples/slideshow/entry.tsx --composition slideshow-landscape --frame 400 --out out/slideshow-400.png

# A contact sheet: one frame per slide, tiled. Slide i starts at frame 111 * i and frame 60 into it is
# outside its crossfade; the last slide starts at 777.
ffmpeg -y -i out/slideshow.mp4 -vf "select='eq(n\,60)+eq(n\,171)+eq(n\,282)+eq(n\,393)+eq(n\,504)+eq(n\,615)+eq(n\,726)+eq(n\,837)',scale=270:-1,tile=4x2" -frames:v 1 out/slideshow-contact.png
```

A render started before `fetch-assets.ts` has run does not render a blank frame: `useAsset` throws
`asset.load-failed` naming the missing photo, and the CLI reports it. A photo that is still decoding
shows the pending panel (the slide id and the URL) instead of nothing.

Getting the command wrong is documented behaviour — a missing entry is `cli.entry-not-found` (exit 2),
an unknown id is `cli.composition-not-found`, and `--props` other than a JSON object string is
`cli.invalid-arguments`.

## Props

One optional prop, shared with the explainer: `{"assets":"placeholder"}` (the default) reads
`assets.local/`, `{"assets":"final"}` reads `assets/`. All three Compositions take it, `slideshow-ci`
included — CI renders the default, so it never needs `assets/`, and `final` fails there with
`asset.load-failed` rather than silently rendering the placeholders. Nothing committed is under
`assets/` today, so the `final` set is what a local QA run would place there once a CC0 photo is
chosen. The switch is not a licence mechanism: it never moves a third-party file into the tree.

## The two CI gates

```bash
pnpm test --project cli examples/slideshow/slideshow.smoke.test.ts                    # renders slideshow-ci
pnpm test --project frame-transport src/render/determinism/examples.determinism.test.ts
```

The smoke test runs the placeholder generator as its own setup, then renders `slideshow-ci` to
`out/examples/slideshow-ci.mp4` through `node dist/cli.js render … --json` and asserts the envelope and
the file with `ffprobe`: 540×960, 60 frames, `30/1`, a 2.000 s duration and a clean FFmpeg decode. It
then reads the mean luma of every frame of that render (`signalstats`) and asserts that no frame-to-frame
step exceeds a quarter of the clip's brightness range, because a dissolve that dips towards the ground is
invisible in the envelope: the crossfade this example shipped with first fell from luma 108 to 25 in a
single frame and every assertion above still passed. A missing placeholder fails that render with
`asset.load-failed`, so a green envelope is also proof that the generated media loaded. `pnpm test` builds `dist/` first (`pretest`), so the shipped CLI is the
thing under test. The landscape variant is covered by its descriptor plus one 1920×1080 still, never by
a second full render.

The determinism gate runs `defineDeterminismSuite` over `probe.tsx` — reached as a module path string,
never imported by an example — at frames `[0, 15, 29]`, exact PNG bytes, all seven traversal modes
(sequential, random, reverse, repeated, fresh realm, held session, fresh renderer). The probe renders
the same `TransitionSeries` and the same `layoutFor(width, height)` at 480×270 with flat surfaces
instead of the `useAsset` photos, because an image inside a `Sequence` failed `reverse` twice and has
not reproduced since ([CI policy](../../docs/design-doc/20261025-reference-examples.md#ci-policy)).

## Known limitations

- **Every photo is an FFmpeg placeholder.** `fetch-assets.ts` writes eight `color`/`testsrc2` stills, so
  the look is verified structurally, not photographically. Replacing them is a licensing decision
  ([asset ADR](../../docs/decisions/20261026-example-asset-licensing.accepted.md)), not a code change:
  the slide list already holds the file names.
- **No audio.** The tone bed is generated but no Composition declares audio; muxing is TASK-171. The bed
  is 30 seconds — the full `slideshow`'s length — so it will end with the last slide rather than being
  cut off.
- **No video clips.** A clip needs a `video` asset kind and a frame-seeking integration that no Backlog
  task covers (the design doc's open question 3), so this version is images-only. The Composition ids
  and the slide components stay unchanged when clips arrive.
- **The type is the system sans stack, so the look is fixed per machine**, exactly as the teaser: its
  determinism evidence is fixed-environment, per the
  [Phase 1 determinism record](../../docs/contexts/render/knowledge/20261024-phase1-determinism.md).
- **Motion is hand-rolled arithmetic.** `/motion` and `/theme` are Phase 2 and have no public subpath,
  so `plan.ts` does the Ken Burns maths and the colours, sizes and durations are constants. The example
  that lands after Phase 2 replaces them; the ids and the acceptance look do not change.
- **Two rendering choices are load-bearing for the gate.** A glyph run inside the transformed picture
  layer made `random`, `reverse`, `fresh-realm`, `held-session` and `fresh-renderer` differ (5.9–9.8 k
  bytes): Chromium rasterises text in a transformed layer differently between paints. The probe's
  surface is therefore shapes only, and the caption lives outside the transform in the real tree too.
  This is a platform behaviour the example works around, not a design preference.

## Assets and credit

**This example commits no media and needs no credit line.** The photos and the tone bed are generated
by `fetch-assets.ts` into `assets.local/`, which `.gitignore` carries; nothing under `assets/` exists.
The captions are authored text in `plan.ts`. The
[asset licensing ADR](../../docs/decisions/20261026-example-asset-licensing.accepted.md) therefore has
nothing to grant here, and there is no `assets.manifest.json` until a real photo or font is committed —
at that point it must record the file, its source URL, its licence and its credit.
