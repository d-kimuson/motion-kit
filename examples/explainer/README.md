# `explainer`

The explainer: 222 seconds on what an index fund is, in 19 spoken lines over 10 slides, drawn by
three layers that share one storyboard. `script.ts` is the script; `script.schema.ts` owns the format,
the reading rate and the timing arithmetic; `script.test.ts` holds the numbers to their literals;
`plan.ts` converts seconds to frames once for every layer.
[The reference-examples design doc](../../docs/design-doc/20261025-reference-examples.md#explainer--long-duration-many-sequences-and-transitions-subtitles-against-audio)
owns the target.

This README covers **how to run the example, what is committed and what is credited**. The timing and
the prose belong to `script.ts` and `script.schema.ts`; the layers that draw them are listed below.

## Layout

| File                   | What it owns                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `script.ts`            | The script: 19 spoken lines, a slide cue on each, the disclaimer, the credits    |
| `script.schema.ts`     | The format, `seconds = ceil(codePoints / 5)`, the frame-free timing arithmetic   |
| `plan.ts`              | The one conversion to frames — `Storyboard`, shared by all three layers          |
| `entry.tsx`            | `explainer` (1920×1080, 6660 frames) and `explainer-ci` (960×540, 60 frames)     |
| `probe.tsx`            | `explainer-probe` (480×270, 30 frames) for the determinism gate                  |
| `ExplainerScene.tsx`   | The tree: slides, sprites, subtitles over one storyboard; the font `Suspense`    |
| `slides/`              | `SlideSeries` (a `TransitionSeries`, 0.4 s crossfades) and the four slide bodies |
| `Sprites.tsx`          | One `Sequence` per line: both characters, the speaker lit, mouth every 0.15 s    |
| `Subtitles.tsx`        | One `Sequence` per line, no transitions: the band with the speaker's name        |
| `look.ts`              | Palette, committed font, sprite/voice paths, the shared arithmetic               |
| `audio.ts`             | One voice track per line, at the line's frame start and end                      |
| `fetch-assets.ts`      | Step 1 placeholders (FFmpeg) and step 2 the fetched sprites and voice            |
| `assets.manifest.json` | Every file under `assets/` and `assets.local/`, with its provenance              |

## Running it

Every command runs from the repository root (`pnpm test` builds `dist/` first):

```bash
pnpm build
node examples/explainer/fetch-assets.ts --placeholders   # sprites, tone bed, silent voice
node dist/cli.js render examples/explainer/entry.tsx --composition explainer-ci --out out/explainer-ci.mp4 --json
node dist/cli.js frame examples/explainer/entry.tsx --composition explainer --frame 2200 --out out/still.png
```

`--placeholders` is step 1 and the only step CI needs; a bare `node examples/explainer/fetch-assets.ts`
also copies `assets.local/sprite-source/` into `assets.local/sprites/final/` and synthesizes the voice
(VOICEVOX on `VOICEVOX_ENGINE_URL`, or macOS `say -v Kyoko`), skipping with an instruction when neither
is available. The voice is fitted to the script rather than the other way round: each clip's lead-in is
trimmed, its pace moved by FFmpeg `atempo` inside ±25 %, and the result padded or cut to the line's own
`seconds`, so narration starts on the line's frame and stops where the subtitle and the sprite do
(`assets.local/voice/durations.json` records the result). `--props '{"assets":"final"}'` renders the
fetched sprites instead of the placeholders. The full 6660-frame render is a local QA Check:
`--out out/explainer.mp4` takes minutes and is never a CI step.

## Known limitations

- **`explainer-probe` draws opaque rectangles and nothing else.** The determinism gate compares PNG
  bytes with no tolerance on macOS and on the Linux runner, so the probe draws only what rasterises
  identically on both: solid, fully opaque, integer-pixel rectangles with square corners
  (`flat.tsx`). No font, no glyph, no sprite image (`useAsset` inside a `Sequence` is the construct
  the design doc records as an intermittent `reverse` failure), no `border-radius`, no `box-shadow`,
  no gradient, no `opacity < 1`, no fractional size or position, and no animation of a paint
  property. Every one of those is a construct that has painted differently between two platforms or
  between two paints of the same frame: antialiased edges are a coverage mask, fractional alpha is a
  blend, and a glyph is the platform's rasteriser, not ours. `explainer-ci`, which does load two
  placeholder images and the committed font, stays out of the gate.
- **The probe's arrival and crossfade are discrete.** `useSlideReveal` never runs under `flat`:
  `SlideSeries` swaps the reveal-only `Slide` for `FlatSlide` and the 0.4 s crossfade for a switch at
  the overlap's first frame, where the incoming slide is painted alone and fully opaque. Nothing is
  half-arrived, so no frame depends on the paint that came before it. The ramp and the blend belong
  to the look and only the real compositions draw them.
- **The probe keeps the structure, not the picture.** What it still exercises is the axis the gate
  exists for: the `TransitionSeries` overlap, one `Sequence` per line in the sprite and subtitle
  layers, the cue-driven slide shape (a bullets slide's item count and item widths are the cue's own
  data) and the speaker alternation. Correctness of the byte comparison wins over fidelity here.
- **A placeholder sprite is an opaque rectangle, so it covers the text under it.** Step 1's panels
  fill the 324×605 slot at 90 % (speaker) and 60 % (the other), where the real 立ち絵 has
  transparency: the title's tagline and the last item of a bullets slide therefore read through a
  panel rather than beside a character, until step 2 copies the downloaded sets into
  `assets.local/sprites/final/` and `--props '{"assets":"final"}'` draws them. This is what the
  full-length render in a fresh clone looks like.
- **The chart slide's year axis sits behind the subtitle band.** The slide reuses the `chart`
  example's full-frame layout (its plot runs from 0.235 to 0.815 of the height, with the year labels
  below the plot), and a three-line subtitle band starts around 0.62. The caption, the series and its
  valleys read; the year labels and the source line do not. Moving the plot means a box override on
  `ChartScene`, which is the `chart` example's own interface to change.

## Credit lines

The [asset licensing ADR](../../docs/decisions/20261026-example-asset-licensing.accepted.md#credit-lines)
requires this block in this README and on the video's credit slide:

```text
音声: VOICEVOX:ずんだもん / VOICEVOX:四国めたん
立ち絵: 坂本アヒル
キャラクター: 東北ずん子・ずんだもんプロジェクト (https://zunko.jp/)
フォント: Noto Sans JP (SIL Open Font License 1.1 — ./assets/fonts/OFL.txt)
```

The voice terms ([音源利用ガイドライン](https://zunko.jp/con_ongen_kiyaku.html)) require the credit
where a viewer who goes looking finds it. The
[character guideline](https://zunko.jp/guideline.html) requires no copyright notice, but it does
require the characters to stay recognisable, so naming the illustrator is the courtesy this
repository keeps. The font is OFL-1.1, whose only condition is that the licence text travels with
every copy: `assets/fonts/NotoSansJP[wght].woff2` ships with `OFL.txt` beside it, at the path above.

## What is committed, and what never is

| Asset                                             | In the repository                           | Where it comes from                                                         |
| ------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Font (Noto Sans JP, variable, OFL-1.1)            | Yes — `assets/fonts/*.woff2` with `OFL.txt` | Converted once from the upstream TTF — commands below — and committed       |
| Voice (VOICEVOX:ずんだもん / VOICEVOX:四国めたん) | No — `assets.local/voice/`                  | Synthesized from `script.ts` against a **local** VOICEVOX engine            |
| Sprites (坂本アヒル 立ち絵)                       | No — `assets.local/sprites/`                | Fetched by the setup script into the ignored directory                      |
| Music and backgrounds                             | No — generated                              | FFmpeg (`sine`, `anoisesrc`, `color`), so they are the project's own output |

Sprites, voice and music are **generated or fetched into `assets.local/` and never committed**: the
voice libraries and the 立ち絵 sets are licensed for use but not for re-sublicensing, and a committed
file is redistributed by every clone and fork. `.gitignore` keeps `assets.local/` out of the tree, the
generation and fetch scripts are committed, and a render started before setup fails through the
asset-readiness diagnostic rather than falling back silently. The rule and its reasoning are the asset
licensing ADR's.

Only the font is committed: `examples/explainer/` holds the script, the entries, the layers and the
OFL font, and nothing else — the voice, the sprites, the tone bed and the music are all one
`fetch-assets.ts` run away.

`assets.manifest.json` is the design doc's provenance record for both directories
([Assets and provenance](../../docs/design-doc/20261025-reference-examples.md#assets-and-provenance)):
one row per file under `assets/` and `assets.local/` with `path`, `kind`, `source`, `license` and
`credit`, committed while the files it names mostly are not. The font rows carry the OFL, the
placeholders, the tone bed and `durations.json` are `generated`, the voice clips name the voices and
the fetched `final/` sprite set names the illustrator. No script reads it, so it is reviewed by hand
with this example's PR.

### The committed face is reproducible

`ofl/notosansjp` publishes no `.woff2`, only the variable `NotoSansJP[wght].ttf` (9,589,900 bytes), so
the committed file is converted once from that TTF — the
[ADR's documented command block](../../docs/decisions/20261026-example-asset-licensing.accepted.md):

```sh
curl -sS -o 'NotoSansJP[wght].ttf' 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf'
curl -sS -o 'OFL.txt' 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt'
npx --yes --package wawoff2 woff2_compress.js 'NotoSansJP[wght].ttf'   # → NotoSansJP[wght].woff2, 4,350,136 bytes
```

Copy the two results into `assets/fonts/`. The `.woff2` is 4,350,136 bytes and a `wOF2` header, which
is the size to check when a change touches the font: the 9.6 MB `.ttf` must never be the file that
lands. The `css2` API is not a substitute — it answers with 124 `@font-face` blocks, one per
`unicode-range` subset, so committing it would commit 124 files whose coverage is Google's rather than
this script's (the ADR records the reasoning).
