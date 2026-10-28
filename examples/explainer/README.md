# `explainer`

The explainer: 222 seconds on what an index fund is, in 19 spoken lines over 10 slides, drawn by
five layers that share one storyboard. `script.ts` is the script; `script.schema.ts` owns the format,
the reading rate and the timing arithmetic; `script.test.ts` holds the numbers to their literals;
`plan.ts` converts seconds to frames once for every layer.
[The reference-examples design doc](../../docs/design-doc/20261025-reference-examples.md#explainer--long-duration-many-sequences-and-transitions-subtitles-against-audio)
owns the target.

This README covers **how to run the example, what is committed and what is credited**. The timing and
the prose belong to `script.ts` and `script.schema.ts`; the layers that draw them are listed below.

## Layout

| File                   | What it owns                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `script.ts`            | The script: 19 spoken lines, a scene cue and an expression on each, the credits        |
| `script.schema.ts`     | The format, the ten cue kinds, `seconds = ceil(codePoints / 5)`, the timing arithmetic |
| `plan.ts`              | The one conversion to frames — `Storyboard`, sentences included — shared by the layers |
| `entry.tsx`            | `explainer` (1920×1080, 6660 frames) and `explainer-ci` (960×540, 60 frames)           |
| `probe.tsx`            | `explainer-probe` (480×270, 30 frames) for the determinism gate                        |
| `flat.tsx`             | The probe's drawing language: opaque, axis-aligned rectangles on whole pixels          |
| `ExplainerScene.tsx`   | The tree: five layers in one 1920×1080 design space, scaled once; the font `Suspense`  |
| `Background.tsx`       | The ground, a drifting grid and lights, the stage panel                                |
| `slides/`              | `SlideSeries` (a `TransitionSeries`, 0.4 s handoffs) and the probe's `FlatSlide`       |
| `scenes/`              | One designed scene per cue kind, every beat keyed to a narrated phrase (`clock.at`)    |
| `Chrome.tsx`           | The title and the chapter progress along the top                                       |
| `Speakers.tsx`         | Both portraits in the side lanes: the speaker lit and bobbing, a reaction mark         |
| `Subtitles.tsx`        | One `Sequence` per sentence: the plate, the speaker's name, emphasis in gold           |
| `look.ts`              | Palette, committed font, asset paths, the fixed regions, credit lines                  |
| `layout.ts`            | How a sentence is broken into phrase-whole lines and sized to fit the plate            |
| `motion.ts`            | The arrival curves every scene shares (a spring, rises, pops)                          |
| `audio.ts`             | The narration per line, the music bed under all of it, a whoosh on every slide change  |
| `synth.ts`             | The music bed and the whoosh, synthesised sample by sample (no download, no licence)   |
| `fetch-assets.ts`      | Step 1 the bed, the whoosh and silent voice; step 2 VOICEVOX voice and portraits       |
| `assets.manifest.json` | Every file under `assets/` and `assets.local/`, with its provenance                    |

## Running it

Every command runs from the repository root (`pnpm test` builds `dist/` first):

```bash
pnpm build
node examples/explainer/fetch-assets.ts --placeholders   # music bed, whoosh and silent voice clips
node dist/cli.js render examples/explainer/entry.tsx --composition explainer-ci --out out/explainer-ci.mp4 --json
node dist/cli.js frame examples/explainer/entry.tsx --composition explainer --frame 2200 --out out/still.png
```

`--placeholders` is step 1 and the only step CI needs. A bare `node examples/explainer/fetch-assets.ts`
also runs step 2 against a local VOICEVOX engine (`VOICEVOX_ENGINE_URL`, default
`http://127.0.0.1:50021`): the narration (四国めたん style 2, ずんだもん style 3; macOS `say -v Kyoko`
where no engine answers) and the two portraits the engine ships (`/speaker_info`), each part skipping
with an instruction when its input is missing. The voice is fitted to the script rather than the other
way round: each sentence's clip is trimmed, its pace moved by FFmpeg `atempo`, and the result padded or
cut to the sentence's own slot, so the voice starts a sentence on the frame its subtitle does
(`assets.local/voice/durations.json` records the result). `--props '{"assets":"final"}'` draws the
portraits instead of the placeholder badges. The full 6660-frame render is a local QA Check:
`--out out/explainer.mp4` takes minutes and is never a CI step.

## Known limitations

- **`explainer-probe` draws opaque rectangles and nothing else.** The determinism gate compares PNG
  bytes with no tolerance on macOS and on the Linux runner, so the probe draws only what rasterises
  identically on both: solid, fully opaque, integer-pixel rectangles with square corners
  (`flat.tsx`). No font, no glyph, no image, no `border-radius`, no `box-shadow`, no gradient, no
  `opacity < 1`, no fractional size or position, and no animation of a paint property. Each is a
  construct that has painted differently between two platforms or between two paints of the same
  frame. `explainer-ci`, which loads the committed font and draws the real scenes, stays out of the
  gate.
- **The probe keeps the structure, not the picture.** `SlideSeries` swaps each scene for `FlatSlide`
  and the 0.4 s handoff for a switch at the overlap's first frame. What it still exercises is the
  axis the gate exists for: the `TransitionSeries` overlap, one `Sequence` per sentence in the
  subtitle layer, the cue-driven shape of each slide and the speaker alternation.
- **The portraits are one pose each.** The VOICEVOX engine ships one 立ち絵 per speaker, so a line's
  `expression` is drawn as a reaction mark beside the face (漫符: "!", "?", sparkles, sweat) rather
  than a different picture, and speaking is a bob and a glow rather than a moving mouth. A full
  expression set would be a hand-downloaded 立ち絵 pack, which this example deliberately does not
  require.
- **`/motion` has no public subpath yet.** `motion.ts` names the curves the scenes share (a closed-form
  spring, rises and pops) as plain arithmetic on a scene's local seconds; Phase 2 swaps them for
  `/motion` without changing the scenes.
- **The subtitle line breaks are computed, not left to the browser.** Chromium's `word-break:
  auto-phrase` cannot be predicted from Node, so the plate could not be sized against it.
  `layout.ts` cuts a sentence into phrases (after a particle before a word, after punctuation, never
  inside an emphasised word) and picks the most even packing; each line is then drawn `nowrap`.

## Regions

`look.ts` fixes every region once in the 1920×1080 design space, and `ExplainerScene` scales that
space to the Composition's own size, so the layers cannot disagree about where they may paint and
the CI twin is the same picture at half size:

| Region     | Box (left, top, width, height) | Who draws there                                                      |
| ---------- | ------------------------------ | -------------------------------------------------------------------- |
| `TOP_BAR`  | 330, 30, 1260, 56              | the title and the chapter progress                                   |
| `STAGE`    | 330, 112, 1260, 652            | every scene, inside `SCENE_BODY` under its heading                   |
| `SUBTITLE` | 330, 792, 1260, 256            | one sentence at a time, the speaker's name on its edge               |
| side lanes | x < 330 and x > 1590           | the portraits (めたん left, ずんだもん right), head beside the stage |

The plate is a fixed height. A sentence is set at 60 px on up to two lines, shrinking towards 44 px
until it fits; only a sentence too long for that gets a third, tighter line at the largest size the
plate allows (one sentence of the script, at 48 px). `layout.test.ts` holds the fit, the phrase-whole
breaks, the minimum time on screen and the regions; `scenes/scenes.test.ts` renders every scene and
fails when a beat keys to a phrase the narration never says.

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

| Asset                                             | In the repository                           | Where it comes from                                                   |
| ------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Font (Noto Sans JP, variable, OFL-1.1)            | Yes — `assets/fonts/*.woff2` with `OFL.txt` | Converted once from the upstream TTF — commands below — and committed |
| Voice (VOICEVOX:ずんだもん / VOICEVOX:四国めたん) | No — `assets.local/voice/`                  | Synthesized from `script.ts` against a **local** VOICEVOX engine      |
| Portraits (坂本アヒル 立ち絵)                     | No — `assets.local/portraits/`              | Written from the **local** VOICEVOX engine (`/speaker_info`)          |
| Music bed and whoosh                              | No — `assets.local/music/`, `sfx/`          | Synthesised by `synth.ts`, so they are the project's own output       |

Portraits, voice and music are **generated or fetched into `assets.local/` and never committed**: the
voice libraries and the 立ち絵 sets are licensed for use but not for re-sublicensing, and a committed
file is redistributed by every clone and fork. `.gitignore` keeps `assets.local/` out of the tree, the
generation and fetch scripts are committed, and a render started before setup fails through the
asset-readiness diagnostic rather than falling back silently. The rule and its reasoning are the asset
licensing ADR's.

Only the font is committed: `examples/explainer/` holds the script, the entries, the layers and the
OFL font, and nothing else — the voice, the portraits, the music bed and the whoosh are all one
`fetch-assets.ts` run away.

`assets.manifest.json` is the design doc's provenance record for both directories
([Assets and provenance](../../docs/design-doc/20261025-reference-examples.md#assets-and-provenance)):
one row per file under `assets/` and `assets.local/` with `path`, `kind`, `source`, `license` and
`credit`, committed while the files it names mostly are not. The font rows carry the OFL, the
music bed, the whoosh and `durations.json` are `generated`, the voice clips name the voices and
the portraits name the illustrator. No script reads it, so it is reviewed by hand
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
