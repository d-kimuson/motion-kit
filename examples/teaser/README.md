# `teaser`

A 24-second silent teaser for a fictional product: eight words, one at a time, reading as one
sentence — _Notes that think ahead of their time — ZEPHYR_ — each snapping in on a spring and leaving
on an easing curve, over a dark ground with one accent colour. It is the reference
example for **dense motion and determinism under it** — every frame changes, and every frame is the
same file however the frames are traversed.
[The reference-examples design doc](../../docs/design-doc/20261025-reference-examples.md#teaser--dense-springs-stagger-theme-tokens-determinism-under-heavy-motion)
owns the target; this file says how to run and read it.

## Compositions

| id             | Resolution | fps | Frames | Rendered by                                                |
| -------------- | ---------- | --- | ------ | ---------------------------------------------------------- |
| `teaser`       | 1920×1080  | 30  | 720    | a local QA Check, never CI                                 |
| `teaser-ci`    | 960×540    | 30  | 60     | `teaser.smoke.test.ts` (CI)                                |
| `teaser-probe` | 480×270    | 30  | 30     | `src/render/determinism/examples.determinism.test.ts` (CI) |

- `teaser` shows all eight words; `teaser-ci` and `teaser-probe` render the **same** `TeaserScene`
  component with the opening word plus the first two transitions, at half resolution and at probe
  size. Nothing is a simplified copy: word count, crossfade length and scene length all come from the
  Composition's own `durationInFrames` and `frameRate` (`planWords` in `scenes.tsx`).
- The words live in `copy.ts`, one per scene, and the last one is the product name. The product and
  its tagline are deliberately fictional: the design doc leaves the teaser's product to the owner, and
  changing it is an edit to that one file.

## Files

| File                   | What it is                                                             |
| ---------------------- | ---------------------------------------------------------------------- |
| `copy.ts`              | The words, the product name and the tagline                            |
| `motion.ts`            | Springs and easings as plain arithmetic (`springStep`, `springChain`)  |
| `scenes.tsx`           | `TeaserScene`, the backdrop, the word stage and the shared `CrossFade` |
| `entry.tsx`            | The `teaser` and `teaser-ci` registry                                  |
| `probe.tsx`            | The `teaser-probe` registry the determinism gate imports by path       |
| `teaser.smoke.test.ts` | The CI smoke test (descriptors plus the `teaser-ci` MP4 and `ffprobe`) |

No `fetch-assets.ts`: this example has no media to generate or fetch.

## The expected look

High contrast on a near-black ground (`#07080c`), one warm accent (`#ff5a3c`), one display face at
15.5% of the frame height, and nothing that sits still:

- The **word** enters letter by letter, 35 ms apart, each on a spring that overshoots by a few percent
  and settles; the whole block lifts into place behind it, and the accent rule under the word grows
  from the centre. A crossfade lifts the outgoing word away on a decelerating curve while the incoming
  word rises into the same place on an accelerating one, and their opacities (`(1 - p)³` and `p³`) sum
  to at most 1 in every frame: the handoff dims the type for a frame or two rather than double-exposing
  two words on top of each other. The overlap is a tenth of a scene (7 frames, 0.23 s at the full
  teaser's size), short enough that the swap reads as a snap instead of a dissolve.
- The **backdrop** has something moving in every frame, though not all of it all the time: a soft
  accent glow drifts on springs whose targets change mid-flight every 1.45 s — the last one at 15.95 s
  — three hairlines drift with it, sixteen accent bars pulse in a 35 ms stagger with their last target
  at ~11 s, and the word counter ticks over at each crossfade. The progress rule along the bottom edge
  follows `timeline.progress`, so it grows through the whole clip and the video never has a still
  frame: after ~16 s the glow, the hairlines and the bars have all settled, and the progress rule is
  the element that is still moving.
- The **last second** holds: the final word is the product name, and nothing in the type moves once it
  has settled (`ZEPHYR` is on screen for the last ~2.9 s, ~2.4 s of them still).

Each word is on screen alone except during a crossfade, when two are visible at once, so the video
never shows more than two words at a time.

## Running it

Every command runs from the repository root, because the CLI's `projectRoot` is `process.cwd()` and
React, ReactDOM and Zod resolve against it:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/

# The full teaser (needs FFmpeg 6.0+ with libx264 on PATH for the .mp4 route)
node dist/cli.js render examples/teaser/entry.tsx --composition teaser --out out/teaser.mp4 --json

# A still frame for visual review
node dist/cli.js frame examples/teaser/entry.tsx --composition teaser --frame 300 --out out/teaser-300.png

# A contact sheet: one frame per word, tiled. The words start every 89 frames (a 98-frame scene,
# less the 9-frame overlap) and each of the first seven stills is 40 frames into its own scene; the
# eighth is the held last frame.
ffmpeg -y -i out/teaser.mp4 -vf "select='eq(n\,40)+eq(n\,129)+eq(n\,218)+eq(n\,307)+eq(n\,396)+eq(n\,485)+eq(n\,574)+eq(n\,712)',scale=480:-1,tile=2x4" -frames:v 1 out/teaser-contact.png
```

`--composition` is always required: the entry holds two Compositions. Getting it wrong is documented
behaviour — a missing entry is `cli.entry-not-found` (exit 2), an unknown id is
`cli.composition-not-found`, and `--props` other than a JSON object string is
`cli.invalid-arguments`. This example has no props, so `--props` is never needed.

## The two CI gates

```bash
pnpm test --project cli examples/teaser/teaser.smoke.test.ts                    # renders teaser-ci
pnpm test --project frame-transport src/render/determinism/examples.determinism.test.ts
```

The smoke test renders `teaser-ci` to `out/examples/teaser-ci.mp4` through `node dist/cli.js render
… --json` and asserts the envelope and the file with `ffprobe`: 60 frames, `30/1`, 960×540, a 2.000 s
duration and a clean FFmpeg decode. `pnpm test` builds `dist/` first (`pretest`), so the shipped CLI
is the thing under test.

The determinism gate runs `defineDeterminismSuite` over `probe.tsx` — reached as a module path string,
never imported by an example — at frames `[0, 15, 29]`, exact PNG bytes, all seven traversal modes
(sequential, random, reverse, repeated, fresh realm, held session, fresh renderer).

## Known limitations

- **The type is the system sans stack, so the look is fixed per machine, not across machines.** The
  design doc allows committing an OFL font with its `OFL.txt`; this example does not, so its
  determinism evidence is fixed-environment (as the
  [Phase 1 determinism record](../../docs/contexts/render/knowledge/20261024-phase1-determinism.md)
  says) and a frame rendered on another OS will differ in its glyphs.
- **Motion is hand-rolled arithmetic.** `/motion` (`interpolate`, `easing`, `spring`, `Stagger`) and
  `/theme` are Phase 2 and have no public subpath, so `motion.ts` implements the springs and `scenes.tsx`
  hard-codes the colours, sizes and durations. The example that lands after Phase 2 replaces both; the
  Composition ids and the acceptance look do not change.
- **Two rendering choices are load-bearing for the gate, and touching them breaks it.** A `translateY`
  on an individual text span, and a `transform` on the full-frame layer that holds a word, both made
  Chromium rasterise the same frame differently between paints — `reverse` and `random` failed with
  ~4–42 k differing bytes and PNGs of three different sizes. The vertical motion therefore rides on
  the whole word block (inside `WordStage`) and the letters only scale and fade, with the crossfade's
  slide passed as `lift`. It is a workaround for a platform behaviour, not a design preference.
- **No audio.** Audio arrives with the muxing pipeline (TASK-171); no Composition may declare it yet.

## Assets and credit

**This example commits no asset and needs no credit line.** There is no media, no font file, no
downloaded image and no generated placeholder: the whole video is text, CSS gradients and arithmetic.
The [asset licensing ADR](../../docs/decisions/20261026-example-asset-licensing.accepted.md) therefore
has nothing to grant here, and `assets.manifest.json` is not needed.
