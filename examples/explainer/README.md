# `explainer`

The explainer's script as validated data: the spoken lines, the slide cue each line sits under, and
the timing the video is built from. `script.ts` is the script; `script.schema.ts` owns the format, the
reading rate and the timing arithmetic; `script.test.ts` holds the numbers to their literals.
[The reference-examples design doc](../../docs/design-doc/20261025-reference-examples.md#explainer--long-duration-many-sequences-and-transitions-subtitles-against-audio)
owns the target.

This README covers **provenance and credit** only. The render entry, the asset setup script and the
run instructions arrive with TASK-209, which grows this file; nothing below changes with them.

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
| Font (Noto Sans JP, variable, OFL-1.1)            | Yes — `assets/fonts/*.woff2` with `OFL.txt` | Fetched once from `google/fonts` `ofl/notosansjp`, converted, committed     |
| Voice (VOICEVOX:ずんだもん / VOICEVOX:四国めたん) | No — `assets.local/voice/`                  | Synthesized from `script.ts` against a **local** VOICEVOX engine            |
| Sprites (坂本アヒル 立ち絵)                       | No — `assets.local/sprites/`                | Fetched by the setup script into the ignored directory                      |
| Music and backgrounds                             | No — generated                              | FFmpeg (`sine`, `anoisesrc`, `color`), so they are the project's own output |

Sprites, voice and music are **generated or fetched into `assets.local/` and never committed**: the
voice libraries and the 立ち絵 sets are licensed for use but not for re-sublicensing, and a committed
file is redistributed by every clone and fork. `.gitignore` keeps `assets.local/` out of the tree, the
generation and fetch scripts are committed, and a render started before setup fails through the
asset-readiness diagnostic rather than falling back silently. The rule and its reasoning are the asset
licensing ADR's.

Only the font is committed, and it lands with the render entry (TASK-209): this branch holds the
script alone under `examples/explainer/`.
