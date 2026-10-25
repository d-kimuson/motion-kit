# Reference examples: the four videos that fix motion-kit's output quality

## Goal

Fix the set of reference videos that answers "does motion-kit still produce good video?", so every later example task has one target to hit. Four **reference examples** live under `examples/`, each a complete video that stresses one axis of the framework; this document fixes their layout, the features each one depends on, where its assets come from, how it is rendered from the CLI, and exactly what runs in CI.

The product owner decided the four examples and their axes on 2026-10-24 (below). This document decides everything else: directory and Composition ids, the surface an example may import, the asset provenance rule, the CI gates and their budget. It writes no example code, no asset and no renderer change; the example implementations are their own Backlog tasks.

Verification of this document: every API, flag, path and package name it names exists in the repository today or is marked planned with its phase; the design follows the [Phase 0 time-control and frame-capture ADR](../decisions/20261024-time-control-and-frame-capture.accepted.md), the [CLI output contract](../contexts/agent/adr/20261024-cli-output-contract.accepted.md), the [system FFmpeg encoding ADR](../contexts/render/adr/20261025-system-ffmpeg-encoder.accepted.md) and the [composition-loading Design Doc](../contexts/render/design-doc/20261024-composition-loading.md).

## Non-Goals

- Implementing any example, script, slide, storyboard asset or fetch script.
- Deciding which third-party assets may be committed or how they are credited: TASK-169 records that as an ADR. This document only fixes the mechanism and the directory that ADR plugs into.
- Writing the explainer script or its content: TASK-170.
- Muxing audio into the MP4, and the audio declaration contract: TASK-171.
- A video asset kind, video frame seeking, or an image sequence that stands in for a clip: no task exists (see [Open questions](#open-questions)).
- Three.js, shader or WebGL examples: deferred to Phase 3 and Spike B (TASK-144), per the owner's decision.
- Changing the renderer, CLI or package exports to make an example easier. In particular, no `--frame-range` flag: a short clip is a separate Composition (see [CI policy](#ci-policy)).
- Preview UI, `inspect`, `validate`, contact sheets and layout diagnostics (Phase 4), and shipping `examples/` in the npm package (`package.json#files` is `dist` only).
- Claiming cross-environment pixel equality. Each example's determinism evidence is fixed-environment, as in the [Phase 1 determinism record](../contexts/render/knowledge/20261024-phase1-determinism.md).

## Design

### What is decided, and by whom

| Point                                                                    | Status                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Four examples and the axis each stresses                                 | Decided by the owner, 2026-10-24                     |
| Every example works silent first; audio arrives with the muxing pipeline | Decided by the owner                                 |
| No Three.js/shader example before Phase 3 and Spike B                    | Decided by the owner                                 |
| `examples/<name>/` layout, Composition ids, CLI invocation               | Decided here                                         |
| The public surface an example may import                                 | Decided here                                         |
| Asset provenance rule and `assets.manifest.json`                         | Decided here; the license allowlist is TASK-169      |
| CI gates: determinism, smoke MP4, resolution, frame counts, budget       | Decided here                                         |
| Explainer script content, schema and disclaimer wording                  | Open: TASK-170 (owner reviews the script)            |
| Which Voice/sprites/fonts/music may be committed, and the credit lines   | Open: TASK-169                                       |
| Audio declaration and muxing behaviour                                   | Open: TASK-171                                       |
| Video clips in the slideshow                                             | Open: needs the owner to schedule a task (see below) |
| Teaser's fictional product, and the chart's data source                  | Open: owner ([Open questions](#open-questions))      |

### Layout

```text
examples/
├── README.md                     # the four targets, how to render each, what is placeholder
├── explainer/
│   ├── entry.tsx                 # exports `compositions`: explainer, explainer-ci
│   ├── script.ts                 # the structured script (TASK-170) and its Zod schema
│   ├── script.schema.ts          # the script schema, next to the data it validates
│   ├── slides/                   # slide components the script's cues select
│   ├── Sprites.tsx               # character sprite + expression switching
│   ├── Subtitles.tsx             # the subtitle line component
│   ├── assets/                   # committed original/generated assets, and the ADR's allowlist
│   ├── assets.local/             # fetched/generated third-party assets, gitignored
│   ├── fetch-assets.ts           # Node script that fills assets.local/ (VOICEVOX, sprites)
│   ├── assets.manifest.json      # every file under assets/ and assets.local/, with provenance
│   ├── explainer.determinism.test.ts
│   ├── explainer.smoke.test.ts
│   └── README.md
├── teaser/                       # same shape, no script/
├── chart/
│   ├── entry.tsx                 # exports `compositions`: chart, chart-ci
│   ├── data/                     # JSON props objects, one file per dataset
│   └── ...
└── slideshow/
    ├── entry.tsx                 # exports `compositions`: slideshow, slideshow-landscape, slideshow-ci
    ├── slides/                   # Ken Burns slide components
    └── ...
```

- One directory per example; the directory name is the Composition id prefix. Each entry file exports a `compositions` registry (`defineCompositions`) with exactly two definitions: the full Composition `<name>` and the CI Composition `<name>-ci`. `slideshow` adds a third, `slideshow-landscape`, which reuses the same slide components at 16:9 (that is its aspect-switching axis); no other example needs a second full Composition.
- Because every entry holds more than one Composition, `--composition <id>` is always required. There is no single-entry entry file under `examples/`.
- `examples/<name>/README.md` states the expected look, the asset provenance, the known limitations, the exact local QA commands, and the credit lines the TASK-169 ADR requires.
- `examples/README.md` indexes the four targets, one row each: Composition id, resolution, fps, frame count, axis, CI gate.

#### How `examples/` enters the checks

| Check                         | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`pnpm typecheck`) | Add `"examples"` to `include` in `tsconfig.json`. `scripts/check-tsconfig-coverage.ts` fails on any `.ts`/`.tsx` file outside the program, so the first example cannot land without this line.                                                                                                                                                                                                                             |
| oxlint                        | Examples are linted by the default rules (`oxlint` walks the repository). Add one override for `examples/**`: `no-restricted-imports` forbids relative imports that reach into the framework's own source (`**/src/**`) and Node.js built-ins (`node:*`), so an example imports only `@kimuson/motion-kit`, its own modules, `react` and `zod`. Node.js is allowed only in `examples/*/fetch-assets.ts` and in test files. |
| Formatting (`pnpm fix`)       | Unchanged; `oxfmt` formats `examples/**` like the rest of the repository.                                                                                                                                                                                                                                                                                                                                                  |
| Dependency licenses           | `pnpm lint:licenses` runs `pnpm licenses list --prod` over the workspace. Examples add no `package.json` and no dependency, so an example may use only packages the repository already depends on; a new package fails that check at the root `package.json`.                                                                                                                                                              |
| Media licenses                | Out of reach of `scripts/check-licenses.ts`, which only reads npm metadata. Media is governed by the TASK-169 ADR and declared in `assets.manifest.json` (below); the check that reads the manifest lands with that ADR.                                                                                                                                                                                                   |
| Git                           | `examples/*/assets.local/` is added to `.gitignore`. Render output goes to `out/`, which `.gitignore` already ignores, so no example writes an artifact into the tree.                                                                                                                                                                                                                                                     |

### The surface an example may use

An example is a consumer of the published package, not part of it. It imports `@kimuson/motion-kit` by name (the loading session aliases that id to the package entry, `src` under vitest and `dist` for the CLI) and never a relative path into `src/`.

Available today:

| Surface                                      | Names                                                                                                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kimuson/motion-kit` (root, `src/index.ts`) | `defineComposition`, `defineCompositions`, `Sequence`, `TransitionSeries`, `TransitionScene`, `Transition`, `useTransitionProgress`, `useTime`, `useFrame`, `useSequence`, `useTimeline`, `useAsset` (font and image), and the Time Module functions |
| `@kimuson/motion-kit/render`                 | `createRenderer` and its types (Node only)                                                                                                                                                                                                           |
| `@kimuson/motion-kit/agent`                  | the CLI output envelope schemas                                                                                                                                                                                                                      |
| CLI                                          | `motion-kit render <entry> [--composition <id>] --out <file.mp4 \| dir> [--props <json>] [--json]` and `motion-kit frame <entry> [--composition <id>] --frame <n> --out <png> [--json]`                                                              |

Not available yet, so no example may use them:

- `/browser` (TASK-190), `/motion` (Phase 2), `/theme` (Phase 2), `/presets` (Phase 3), `/three` (Phase 3). `package.json#exports` has only `.`, `./render` and `./agent`.
- `src/motion` holds `interpolate`, `easing`, `keyframes`, `spring`, `springState`, `springSettleTime` and `retarget` with no public subpath yet, so an example does not reach them. `Animate`, `Reveal` and `Stagger` do not exist in any form.
- Audio: no Composition may declare audio until TASK-171.
- Video assets: `AssetDescriptor` is a union of `FontAssetDescriptor` and `ImageAssetDescriptor`; there is no video kind and no frame-seeking integration.
- `inspect`, `validate` (Phase 4; the CLI reserves the subcommand names and reports them as not implemented).

Consequences the example tasks must live with:

- **Motion before Phase 2 is plain arithmetic on time.** A component computes style values from `useTime()` (for example `opacity = Math.min(1, useTime() / 0.3)`), inside a component, without a library. When `/motion` and `/theme` arrive, the example task replaces that arithmetic with `interpolate`/`spring`/`Stagger` and Theme tokens; the Composition structure and the acceptance look do not change.
- **Every `useAsset` consumer sits in a local `<Suspense fallback={null}>`** inside the tree. `Composition` and `CompositionContent` are exported, but they belong to the page bootstrap: an example never renders `Composition` itself and cannot build the `ContentRegistration` that `CompositionContent` needs. A throw that reaches the root `Suspense` keeps `RootContent` from committing, so the Composition's own content acknowledgement (`composition-root`) never happens and the readiness barrier waits until its deadline. `src/render/determinism/fixtures/references.tsx` shows the working shape (`asset-suspense`).
- **A `Transition`'s children mount only during the overlap**, and only they can read `useTransitionProgress()`. A crossfade therefore re-declares the outgoing and incoming scene inside the `Transition` child with `opacity = 1 - progress` and `progress`. Every example uses one shared `CrossFade` component for that; folding it into a preset is Phase 3 work, not an API change here.
- **Fonts and images are addressed by root-relative URL** (`/examples/explainer/assets/fonts/NotoSansJP-Regular.woff2`), never by a JavaScript import of the file. The loading session serves the project root (`process.cwd()`), and the determinism suite needs the same string to work in its temporary project, where it copies the file into `public/` under the same relative path (`staticFiles`).

### Running an example

The CLI's `projectRoot` is `process.cwd()`, and React, ReactDOM and Zod resolve against the repository root, so every command runs from the repository root:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium

# Full render (needs FFmpeg 6.0+ with libx264 on PATH for the .mp4 route)
node dist/cli.js render examples/teaser/entry.tsx --composition teaser --out out/teaser.mp4 --json

# A still frame for visual review
node dist/cli.js frame examples/teaser/entry.tsx --composition teaser --frame 42 --out out/teaser-42.png

# Same Composition, different data (the chart axis)
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-30y.json)" --out out/chart.mp4

# A fetched-asset run: the assets prop selects the final look instead of placeholders
node examples/explainer/fetch-assets.ts
node dist/cli.js render examples/explainer/entry.tsx --composition explainer \
  --props '{"assets":"final"}' --out out/explainer.mp4
```

- `motion-kit` is the same bin (`bin.motion-kit` → `dist/cli.js`); a reader with an installed package writes `motion-kit render …`. Under `--json` the envelope carries `data.format`, `width`, `height`, `fps`, `frameCount` and `durationSeconds`, which is how an example's smoke test asserts its own output.
- `--out` picks the format from the extension: `.mp4` encodes H.264, anything else writes PNG frames plus `manifest.json`. There is no `--format` flag.
- A missing entry is `cli.entry-not-found` (exit 2), an unknown `--composition` id is `cli.composition-not-found`, `--props` that is not a JSON object string is `cli.invalid-arguments`, and valid JSON that fails the Composition's schema is `composition.props-invalid`. All four are what an example README tells the reader to expect when they get the command wrong.
- Every render writes under `out/` at the repository root. `assets.local/` is the only other generated location.

### `explainer` — long duration, many Sequences and Transitions, subtitles against audio

**Composition.** `explainer`: 1920×1080, 30 fps, `durationInFrames` = `frameCount(createTimelineTime(totalSeconds), { numerator: 30, denominator: 1 })` with the `Result` unwrapped to its `bigint` and then to the plain safe integer the registry declares (`durationInFrames: number`); `totalSeconds` is the script's dialogue total plus a 3-second tail for the disclaimer and credits; target 180–300 seconds (5400–9000 frames). `explainer-ci`: 960×540, 60 frames.

**Structure.** Three layers, all computed from `script.ts` at module load, so the video and the data cannot disagree:

1. **Slide layer** — one `TransitionSeries` from frame 0. Each script slide cue becomes a `TransitionScene`; adjacent slides get a `Transition` of 0.4 s (12 frames) with the shared `CrossFade`. `TransitionScene` duration is "the sum of that slide's lines' seconds + its outgoing overlap (0.4 s, zero for the last slide)". With that rule the series total is exactly `Σ lines + Σ overlaps − Σ overlaps = Σ lines`, and slide `i` starts exactly at its first line because its predecessor's outgoing overlap is what pays for the crossfade; the overlap then runs over the first 0.4 s of slide `i`'s first line.
2. **Subtitle layer** — one `Sequence` per line, `from` = the cumulative sum of the preceding lines' seconds, `duration` = the line's seconds. This layer has no transitions: it proves that many Sequences in one Composition keep exact timing.
3. **Sprite layer** — the speaker's sprite for the lines in view, switched by the line's `expression`, inside its own `Sequence`s. Two characters side by side, the non-speaker dimmed to 60% opacity.

Slide content is DOM and inline SVG only (no chart library): title, bullet list, or a `chart` cue that renders the same SVG chart component as the `chart` example, from the same JSON.

**Script format** (TASK-170 fills it in). `examples/explainer/script.schema.ts` validates it with Zod, and `entry.tsx` imports the typed result:

```ts
type Expression = 'normal' | 'happy' | 'surprised' | 'thinking' | 'wink' | 'serious';
type SlideCue =
  | { kind: 'title'; text: string }
  | { kind: 'bullets'; title: string; items: readonly string[] }
  | { kind: 'chart'; chartId: string; caption: string }
  | { kind: 'disclaimer'; text: string };
type ScriptLine = {
  readonly id: string; // stable key; also the subtitle Sequence key
  readonly speaker: 'zundamon' | 'metan';
  readonly text: string; // Japanese, no speaker prefix
  readonly expression: Expression;
  readonly slide: SlideCue;
  readonly seconds: number; // ceil(codePoints(text) / 5)
};
type Script = {
  readonly title: string;
  readonly disclaimer: string;
  readonly lines: readonly ScriptLine[];
};
```

- `seconds = ceil(codePoints(text) / 5)`, i.e. 5 Japanese characters per second, counted over the raw `text` including punctuation. TASK-170's own bounds (900–1500 characters, 180–300 seconds) come out of this rate, so the script and the Composition duration agree by construction.
- The voice track never becomes the timing authority. When VOICEVOX audio exists, `fetch-assets.ts` writes `assets.local/voice/durations.json` (line id → measured seconds) and `entry.tsx` prefers it over `seconds`; the timeline stays frame-derived, the audio is placed at those same times by TASK-171, and `durations.json` is generated, never committed.
- Content rules are TASK-170's, and this document adds only the ones the video shell must enforce: the last slide is the `disclaimer` cue and stays on screen for the 3-second tail; no line names a fund, broker or allocation; the credit lines the TASK-169 ADR requires appear in the tail slide and in `README.md`.

**Dependencies.** `Sequence`, `TransitionSeries` and the hooks — TASK-156 and TASK-154 (already in `src` on `main`). Font and image readiness — TASK-158. MP4 encoding — TASK-159. The determinism suite — TASK-160. The CLI — TASK-161. Script content and schema — TASK-170. Voice and music muxing — TASK-171. Subtitle easing with `spring`/`interpolate` — TASK-152/155 plus `/motion` (Phase 2). Font tokens and typography — theme and presets (Phase 2/3). A first version needs nothing beyond `main`; every later phase tightens it without changing the script format.

**Assets.** The script is authored and committed. VOICEVOX WAVs for Zundamon and Shikoku Metan are generated by `fetch-assets.ts` against a local VOICEVOX engine (`POST /audio_query`, then `POST /synthesis`, engine version recorded in the manifest) into `assets.local/voice/`, never committed. Sprites are third-party 立ち絵 sets fetched the same way into `assets.local/sprites/`. The Japanese font is an OFL family (Noto Sans JP or BIZ UDPGothic). All three are TASK-169's to allow or forbid; until that ADR lands the example renders with `assets: 'placeholder'` (authored flat-silhouette sprites committed as SVG under `assets/sprites/` and loaded through `useAsset`, the system sans-serif stack, no audio) and commits no third-party file.

**Acceptance look.** A calm 16:9 deck: warm off-white background, one accent colour, the two characters at the lower corners, a three-line subtitle band at the bottom third in a legible Japanese face (≥72 px at 1080p, no clipped descenders), and a slide that changes every 15–25 seconds with a 0.4-second crossfade that never shows both slides at full opacity. Numbers and charts enter by counting up while the narration reaches them. Nothing in the frame moves while nobody speaks. A person watching it should be able to follow the argument with the sound off (subtitles) and with the picture off (narration).

**CI.** `explainer-ci` at 960×540 for 60 frames selects the disclaimer slide plus one dialogue line plus one crossfade, with placeholder assets and no audio — it exercises the three layers, a `Transition` overlap, `useAsset` for two placeholder images, and Japanese text through the fallback stack. It is the only explainer render in CI; the full-length render is a local QA Check.

### `teaser` — dense springs, Stagger, Theme tokens, determinism under heavy motion

**Composition.** `teaser`: 1920×1080, 30 fps, 450–900 frames (15–30 s). `teaser-ci`: 960×540, 60 frames (the opening word plus the first two transitions).

**Structure.** 8–12 words, one to three on screen at a time, each entering with a spring and leaving with an easing curve; a `Stagger` of 8–20 small elements (dots, rules, letter masks) behind the type; every colour, font size and duration read from a Theme token once Phase 2 lands. Motion is dense on purpose: at least one element is in motion in every frame, and several springs change target mid-flight (the `retarget` case once `/motion` exposes it), which is what makes the determinism test meaningful.

**Dependencies.** The final form needs `/motion` (`Animate`, `Reveal`, `Stagger`, spring and easing) and `/theme` — both Phase 2, and neither has a Backlog task yet; TASK-152 (pure motion) and TASK-155 (closed-form spring) are the parts that exist. Typography and transition presets are Phase 3. The Phase 1 version of the teaser is therefore plain arithmetic on `useTime()` with hard-coded values, and the example task that lands after Phase 2 replaces it; the Composition ids and the acceptance look stay.

**Assets.** No media. One OFL font (TASK-169) or the system stack; the product name and tagline are text.

**Acceptance look.** 15–30 seconds of type that never sits still and never looks busy: high contrast on a dark ground, one accent colour, words that snap in with a spring overshoot of a few percent and settle, letters that stagger by 30–50 ms, and a final frame that holds the product name for the last second. Played twice, every frame is identical; that is the point of the example.

**CI.** `teaser-ci` renders as an MP4 in CI, plus the determinism suite over the full `teaser` at four frames (0, one mid-transition frame, one mid-hold frame, the last frame). Exact PNG bytes, no tolerance: the teaser is the Composition that would expose a wall-clock or history-dependent animation first.

### `chart` — schema-first props, SVG, animated numbers, regenerate from other data

**Composition.** `chart`: 1920×1080, 30 fps, 600 frames (20 s). It is already 16:9, so it has no second aspect variant; the entry carries `chart-ci` at 960×540, 60 frames. A second dataset is a `--props` argument, never a second Composition.

**Props schema** (`examples/chart/entry.tsx`, in the Composition registry, so the page validates it):

```ts
const pointSchema = z.object({ year: z.int().min(1900), value: z.number().nonnegative() });
const seriesSchema = z.object({
  label: z.string().min(1),
  points: z.array(pointSchema).min(2),
});
const chartProps = z.object({
  title: z.string().default('30 years of an index'),
  unit: z.string().default('index points'),
  source: z.string().default(''), // rendered under the chart; empty renders nothing
  series: z.array(seriesSchema), // no default: always supplied by data or --props
});
```

- `series` has no schema default, so the entry's own `data/index-30y.json` is passed as `--props` in the documented command; a reader who omits `--props` gets `composition.props-invalid` with the failing path, which is the schema-first behaviour the example exists to demonstrate. The example README documents both commands.
- Each file under `examples/chart/data/` is a complete props object (`{ "title": …, "source": …, "series": […] }`), not a bare array, so `--props "$(cat examples/chart/data/index-30y.json)"` works verbatim and the from/to year range is derived from the points rather than declared twice.
- Rendering is inline `<svg>` written as JSX: axes, gridlines, a polyline per series, a marker per point, and a value label that counts up from 0 to the final value over the last 1.5 s. No chart library, so no dependency and no nondeterminism.
- Number formatting is a small local function, not `Intl.NumberFormat`: ICU data differs between a developer machine and the CI runner, and the determinism suite compares PNG bytes.

**Dependencies.** Schema-first props through the registry (TASK-154) and `--props` through the CLI (TASK-161) exist today; SVG and DOM text are Phase 1 rendering features covered by the existing determinism fixtures (`svg-path`, `dom-text`). `interpolate`/`easing` for the draw-on and count-up curves arrive with `/motion` (TASK-152, Phase 2); until then the curves are `Math.min(1, t / duration)`.

**Assets.** One committed props JSON file per dataset under `examples/chart/data/`, authored for the repository, with the source recorded in its `source` string and in the example README. Which public series may be used, and how it is cited, is an open question for the owner (below); the committed dataset is a synthetic series that behaves like an index (30 yearly closes) so the example is never blocked.

**Acceptance look.** A single large chart on a light ground with the title top-left, the unit on the y-axis, years on the x-axis, and the source line in 24 px grey at the bottom. The line draws on left to right in 3 seconds, points pop in as the draw passes them, and the final value counts up and then holds for 4 seconds. Regenerating with a different dataset changes the shape and the numbers and nothing else about the layout: the y-domain, tick count and label positions are computed from the data, so a 1995–2024 series and a 2005–2024 series both fill the frame correctly.

**CI.** `chart-ci` renders as an MP4 with `--props` pointing at a second, small dataset committed under `examples/chart/data/`, so CI covers the regeneration axis rather than only the default data; plus the determinism suite over the full `chart` with the same props at four frames.

### `slideshow` — 9:16 vertical, Ken Burns, audio mixing, aspect switching

**Composition.** `slideshow`: 1080×1920, 30 fps, 600–1200 frames (20–40 s), 6–10 slides. `slideshow-landscape`: the same slide components at 1920×1080, proving that the components read `useTimeline().width/height` instead of a hard-coded frame. `slideshow-ci`: 540×960, 60 frames.

**Structure.** One `TransitionSeries` over the slides, 0.5 s crossfades, each slide a Ken Burns move computed from `useSequence().time` and `useSequence().duration` (scale 1.0 → 1.12 and a pan of ±4%, alternating direction per slide). Images load through `useAsset({ kind: 'image', … })` inside a local `<Suspense>`; the slide's alt text or caption is drawn from the same props so a missing image is a visible diagnostic, not a blank frame.

**Dependencies.** `useAsset` image readiness (TASK-158), `Sequence`/`TransitionSeries` (TASK-156/154), MP4 encoding (TASK-159) and the CLI (TASK-161) exist. Background music needs TASK-171. Video clips need a `video` asset kind and a frame-seeking integration (Tier B at best, per the [Phase 0 ADR](../decisions/20261024-time-control-and-frame-capture.accepted.md)) — no task exists, so the first version is images-only and the video-clip axis is deferred ([Open questions](#open-questions)).

**Assets.** Photos are CC0 sources fetched into `assets.local/photos/`, or original generated placeholders committed under `assets/` (a gradient plus a label, as SVG). Music is a CC0 track or a synthesized tone bed via FFmpeg, both subject to TASK-169. Placeholder photos are committed because they are authored here; nothing third-party is committed before that ADR.

**Acceptance look.** A vertical feed video: full-bleed images, slow Ken Burns with no visible stepper, white captions in the lower third with a subtle shadow, 0.5-second crossfades, and a music bed that ends with the last slide rather than being cut off. The same components at 16:9 must fill the wider frame without letterboxing and without the caption leaving the safe area.

**CI.** `slideshow-ci` at 540×960 renders as an MP4 with placeholder images and no audio, plus the determinism suite over the full `slideshow` at four frames. The landscape variant is checked by its descriptor and one still frame in the same test, not by a full render.

### Assets and provenance

Two directories, one rule:

- `examples/<name>/assets/` — **committed**. Only original work authored for this repository (SVG/CSS placeholders, generated WAV tones, the authored JSON datasets), plus whatever the TASK-169 ADR explicitly allows to be redistributed with credit.
- `examples/<name>/assets.local/` — **gitignored**, filled by `examples/<name>/fetch-assets.ts` (Node, never Python). Third-party media (VOICEVOX audio, 立ち絵 sprites, music, photos) lands here until, and if, the ADR allows committing it.

`assets.manifest.json` declares every file in both directories with `path`, `kind` (`font`/`image`/`audio`/`video`/`data`), `source` (URL or "authored"), `license` (SPDX id or "authored") and `credit`. The TASK-169 ADR supplies the allowed SPDX set and the exact credit strings; the check that reads the manifest (`scripts/check-licenses.ts` reading the manifests under `examples/`) lands with that ADR, so this document fixes the mechanism and the ADR fixes the policy.

Every example's props schema carries one shared switch, so a run without the fetched media is still a complete video:

```ts
const assets = z.enum(['placeholder', 'final']).default('placeholder');
```

`placeholder` uses only what `assets/` provides (the authored silhouette SVGs, the authored gradient photos, the system sans-serif stack, no audio); `final` uses `assets.local/`. CI and every commit-time render use the default; the local QA render passes `--props '{"assets":"final"}'`. When TASK-169 allows an asset to be committed, it moves into `assets/` and stops depending on the switch, but the prop stays: it is how a reader without VOICEVOX still renders the explainer.

| Example     | Asset                           | Where                              | Committed today         | Decided by                       |
| ----------- | ------------------------------- | ---------------------------------- | ----------------------- | -------------------------------- |
| `explainer` | Script and slide outline        | `script.ts`                        | Yes, authored           | TASK-170                         |
| `explainer` | Silhouette sprite placeholders  | `assets/sprites/*.svg`             | Yes, authored           | this document                    |
| `explainer` | VOICEVOX voices (2 characters)  | `assets.local/voice/*.wav`         | No, generated locally   | TASK-169 (terms), TASK-171 (mux) |
| `explainer` | Character sprites (expressions) | `assets.local/sprites/*.png`       | No, fetched             | TASK-169                         |
| `explainer` | Japanese font                   | `assets/fonts/` or `assets.local/` | Only if the ADR allows  | TASK-169                         |
| `explainer` | Slide charts                    | inline SVG in `slides/`            | Yes, authored           | this document                    |
| `teaser`    | One font (Latin)                | `assets/fonts/` or system stack    | Only if the ADR allows  | TASK-169                         |
| `chart`     | Series JSON (2 datasets)        | `data/*.json`                      | Yes, authored/synthetic | this document; real source open  |
| `slideshow` | Photos (8 placeholders)         | `assets/photos/*.svg`              | Yes, authored           | this document                    |
| `slideshow` | Photos (final) and music        | `assets.local/photos`, `music`     | No, fetched             | TASK-169                         |
| `slideshow` | Video clips                     | —                                  | No                      | Open (no task)                   |

Audio is never committed by this document's rules except generated tones; a committed voice track is exactly what TASK-169 must allow or forbid.

### CI policy

CI proves three things about the examples: they typecheck and lint, their frames are traversal-independent, and the CLI can render them to a valid MP4. It does not prove the videos look right — that is a human check.

| Gate               | Where                                                                                                | What runs                                                                                                                                                                                                                         | Added cost budget                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Typecheck and lint | `pnpm lint`, `pnpm typecheck` in the existing `check` job                                            | `examples/**` through `tsconfig.json#include`, oxlint, oxfmt, the manifest check once TASK-169 lands                                                                                                                              | < 10 s                            |
| Determinism        | `frame-transport` project: add `examples/**/*.determinism.test.ts` to `include` (`vitest.config.ts`) | One `defineDeterminismSuite` per example over the **full** Composition: 4 frames (0, one mid-scene, one mid-transition or mid-move, the last). Exact PNG bytes, no tolerance.                                                     | ≤ 45 s per example, ≤ 120 s total |
| Smoke MP4          | `cli` project: add `examples/**/*.smoke.test.ts` to `include` (`vitest.config.ts`)                   | `<name>-ci` → `out/examples/<name>-ci.mp4` through `node dist/cli.js render … --json`, then `ffprobe` asserts 60 frames, 30/1 fps, the CI width/height and a 2.0 s duration. `chart-ci` passes `--props` from the second dataset. | ≤ 20 s per example, ≤ 60 s total  |
| Not in CI          | —                                                                                                    | Full-length renders of `explainer`, `teaser`, `chart`, `slideshow`; any audio; any `assets: 'final'` render; the landscape variants' full renders                                                                                 | —                                 |

- **CI renders are 2 seconds at reduced size.** The `check` job has a 15-minute timeout and already runs six vitest projects (about 28 s for `frame-transport` before this work). A 1080p 60-frame encode plus 30 captures costs tens of seconds per example, and a full 20–30 s clip would consume minutes. The `-ci` Compositions are therefore half linear resolution (960×540, and 540×960 for the vertical) and exactly 60 frames, and they must reuse the full example's scene components — never a simplified copy.
- **No `--frame-range` flag is added.** The only way to render a short window today is a Composition with a short duration, which is what the `-ci` definitions are. If the agent context later adds a frame range to `render`, the `-ci` Compositions are removed and CI renders a window of the real Composition instead.
- **Determinism uses the full Composition**, not the `-ci` one: capture cost is set by resolution and the frame list, not by duration. That keeps the gate on the real tree. If an example's suite exceeds 45 s on the CI runner, reduce its frame list to three frames; do not add a tolerance — the suite accepts one only as `{ purpose: 'cross-environment', maxDifferentBytes }` at the call site.
- **Audio is manual.** CI runs are silent (no audio declarations), because the voice and music files are generated locally and gitignored. TASK-171's own tests prove muxing and onset alignment; the explainer's QA Check is where the real track is judged.
- **What the QA Check does instead** (`docs/guidelines/quality-assurance/index.md`, human check): render each full example at its real resolution, watch it, compare against the acceptance look in this document, render the same four frames sequentially and by random seek for one example, and record the command, the wall time and the stills in the example's README or a `knowledge/` note next to the example. A change to what a video looks like is a human check by the [criteria](../guidelines/quality-assurance/human-check-criteria.md).

## Open questions

These need the owner; they do not block the layout, the CI policy or the first silent versions.

1. **The teaser's fictional product.** The signature line needs a name and a tagline. Recommendation: an obviously fictional developer tool ("Zephyr — notes that think"), chosen so no real product is implied; the example ships the words in one `copy.ts` constant, so changing them is a one-line edit.
2. **The chart's data source.** A 30-year series from a named public source (cited on screen and in the README) is more convincing than a synthetic one, but index values carry provider terms that TASK-169 does not cover. Recommendation: ship the synthetic series as the committed default and, if the owner accepts the source's terms, add one real series as a second dataset; the video never presents it as advice either way.
3. **Video clips in the slideshow.** Frame-accurate clip playback needs a `video` asset kind plus a seeking integration, which no Backlog task covers, and it is Tier B at best. Recommendation: ship the slideshow images-only first (it still proves asset readiness, audio mixing and aspect switching), and schedule a `[render]` video-asset task when Phase 2 opens; the `slideshow` Composition id and its slide components stay unchanged when clips arrive.

## Alternatives

- **One showcase video instead of four.** A single 3–5 minute demo stresses everything and isolates nothing: when it breaks, no context owns the failure, and its CI cost would be the whole budget. Four targets give each axis an owner and a cheap gate.
- **`examples/` as its own pnpm workspace package with a `package.json` per example.** It would test the consumer install path more faithfully, but it doubles dependency resolution, hides self-reference bugs (`@kimuson/motion-kit` resolves through the loading session's alias anyway), and adds an install step to CI. The repository root stays the project root; `--props` and the loading session already cover the consumer path.
- **Put the examples under `spikes/`.** Spikes are Phase 0 experiments with their own vitest configs: their tests run only through `pnpm spike:*`, never in `pnpm test` or CI, and they are not shipped. Reference examples are the quality bar and must be typechecked, linted and gated like `src/`.
- **CI renders the full clips and relies on image regression against stored baselines.** There is no baseline store, full-length renders do not fit the 15-minute job, and byte comparison against a stored baseline breaks on every legitimate visual change. Traversal determinism plus an MP4 smoke test catches the failures CI can attribute; the look is a human check.
- **A `--frame-range` flag on `render` to clip CI renders out of the real Composition.** It changes the CLI contract (agent context) to save an `-ci` Composition per example, and the CLI's envelope would have to describe a partial render. A second short Composition is the cheaper decision; the flag can replace it later without changing this document's targets.
