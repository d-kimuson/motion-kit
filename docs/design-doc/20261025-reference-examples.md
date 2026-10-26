# Reference examples: the four videos that fix motion-kit's output quality

## Goal

Fix the set of reference videos that answers "does motion-kit still produce good video?", so every later example task has one target to hit. Four **reference examples** live under `examples/`, each a complete video that stresses one axis of the framework; this document fixes their layout, the features each one depends on, where its assets come from, how it is rendered from the CLI, and exactly what runs in CI.

The product owner decided the four examples and their axes on 2026-10-24 (below). This document decides everything else: directory and Composition ids, the surface an example may import, the asset provenance rule, the CI gates and their budget. It writes no example code, no asset and no renderer change; the example implementations are their own Backlog tasks.

Verification of this document: every API, flag, path and package name it names exists in the repository today or is marked planned with its phase; the design follows the [Phase 0 time-control and frame-capture ADR](../decisions/20261024-time-control-and-frame-capture.accepted.md), the [CLI output contract](../contexts/agent/adr/20261024-cli-output-contract.accepted.md), the [system FFmpeg encoding ADR](../contexts/render/adr/20261025-system-ffmpeg-encoder.accepted.md) and the [composition-loading Design Doc](../contexts/render/design-doc/20261024-composition-loading.md).

## Non-Goals

- Implementing any example, script, slide, storyboard asset or fetch script.
- Deciding which third-party assets may be committed or how they are credited: the [example-asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md) decides that. This document only fixes the layout those files land in and which asset each example needs.
- Writing the explainer script or its content: TASK-170.
- Muxing audio into the MP4, and the audio declaration contract: TASK-171.
- A video asset kind, video frame seeking, or an image sequence that stands in for a clip: no task exists (see [Open questions](#open-questions)).
- Three.js, shader or WebGL examples: deferred to Phase 3 and Spike B (TASK-144), per the owner's decision.
- Changing the renderer, CLI or package exports to make an example easier. In particular, no `--frame-range` flag: a short clip is a separate Composition (see [CI policy](#ci-policy)).
- Preview UI, `inspect`, `validate`, contact sheets and layout diagnostics (Phase 4), and shipping `examples/` in the npm package (`package.json#files` is `dist` only).
- Claiming cross-environment pixel equality. Each example's determinism evidence is fixed-environment, as in the [Phase 1 determinism record](../contexts/render/knowledge/20261024-phase1-determinism.md).

## Design

### What is decided, and by whom

| Point                                                                    | Status                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Four examples and the axis each stresses                                 | Decided by the owner, 2026-10-24                                                                                                      |
| Every example works silent first; audio arrives with the muxing pipeline | Decided by the owner                                                                                                                  |
| No Three.js/shader example before Phase 3 and Spike B                    | Decided by the owner                                                                                                                  |
| `examples/<name>/` layout, Composition ids, CLI invocation               | Decided here                                                                                                                          |
| The public surface an example may import                                 | Decided here                                                                                                                          |
| Layout of the asset directories and `assets.manifest.json`               | Decided here; the allowlist and the credits are the [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md)            |
| CI gates: determinism, smoke MP4, resolution, frame counts, budget       | Decided here                                                                                                                          |
| Explainer script content, schema and disclaimer wording                  | Open: TASK-170 (owner reviews the script)                                                                                             |
| Which Voice/sprites/fonts/music may be committed, and the credit lines   | Accepted: the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md)                                        |
| Audio declaration and muxing behaviour                                   | Open: TASK-171                                                                                                                        |
| Video clips in the slideshow                                             | Open: needs the owner to schedule a task (see below)                                                                                  |
| Teaser's fictional product, and the chart's data source                  | Open: owner ([Open questions](#open-questions))                                                                                       |
| Determinism of images inside `Sequence`s                                 | Open: an observed, intermittent race — 2 recorded failures, 0 in 12 re-runs; a finding, not a numbered task ([CI policy](#ci-policy)) |

### Layout

```text
examples/
├── README.md                     # the four targets, how to render each, what is placeholder
├── explainer/
│   ├── entry.tsx                 # exports `compositions`: explainer, explainer-ci
│   ├── probe.tsx                 # exports `compositions`: explainer-probe (the determinism gate)
│   ├── script.ts                 # the structured script data (TASK-170 fills it in)
│   ├── script.schema.ts          # the Zod schema for that script, next to the data it validates
│   ├── slides/                   # slide components the script's cues select
│   ├── Sprites.tsx               # character sprite + expression and mouth switching
│   ├── Subtitles.tsx             # the subtitle line component
│   ├── assets/                   # committed: the OFL font, authored data, CC0 media (ADR)
│   ├── assets.local/             # generated placeholders and fetched third-party media, gitignored
│   ├── fetch-assets.ts           # Node script: FFmpeg placeholders, then the VOICEVOX/sprite fetch
│   ├── assets.manifest.json      # every file under assets/ and assets.local/, with provenance
│   ├── explainer.smoke.test.ts
│   └── README.md
├── teaser/                       # same shape, no script/
├── chart/
│   ├── entry.tsx                 # exports `compositions`: chart, chart-ci
│   ├── probe.tsx                 # exports `compositions`: chart-probe
│   ├── data/                     # JSON props objects, one file per dataset
│   └── ...
└── slideshow/
    ├── entry.tsx                 # exports `compositions`: slideshow, slideshow-landscape, slideshow-ci
    ├── probe.tsx                 # exports `compositions`: slideshow-probe
    ├── slides/                   # Ken Burns slide components
    └── ...
```

- One directory per example; the directory name is the Composition id prefix. Each entry file exports a `compositions` registry (`defineCompositions`) with exactly two definitions: the full Composition `<name>` and the CI Composition `<name>-ci`. `slideshow` adds a third, `slideshow-landscape`, which reuses the same slide components at 16:9 (that is its aspect-switching axis); no other example needs a second full Composition.
- `probe.tsx` is a separate registry with one short Composition, `<name>-probe` (480×270, 30 frames), used only by the determinism gate ([CI policy](#ci-policy)). It is not a second full Composition and no CLI command in this document renders it; keeping it out of `entry.tsx` is what lets the entry document exactly the two Compositions a reader renders.
- Because every entry holds more than one Composition, `--composition <id>` is always required. There is no single-entry entry file under `examples/`.
- `examples/<name>/README.md` states the expected look, the asset provenance, the known limitations, the exact local QA commands, and the credit lines the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md) requires.
- `examples/README.md` indexes the four targets, one row per Composition (five, counting `slideshow-landscape`): Composition id, resolution, fps, frame count, axis, CI gate.

#### How `examples/` enters the checks

| Check                         | Treatment                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`pnpm typecheck`) | Add `"examples"` to `include` in `tsconfig.json`. `scripts/check-tsconfig-coverage.ts` fails on any `.ts`/`.tsx` file outside the program, so the first example cannot land without this line.                                                                                                                                                                                                                             |
| oxlint                        | Examples are linted by the default rules (`oxlint` walks the repository). Add one override for `examples/**`: `no-restricted-imports` forbids relative imports that reach into the framework's own source (`**/src/**`) and Node.js built-ins (`node:*`), so an example imports only `@kimuson/motion-kit`, its own modules, `react` and `zod`. Node.js is allowed only in `examples/*/fetch-assets.ts` and in test files. |
| Formatting (`pnpm fix`)       | Unchanged; `oxfmt` formats `examples/**` like the rest of the repository.                                                                                                                                                                                                                                                                                                                                                  |
| Dependency licenses           | `pnpm lint:licenses` runs `pnpm licenses list --prod` over the workspace. Examples add no `package.json` and no dependency, so an example may use only packages the repository already depends on; a new package fails that check at the root `package.json`.                                                                                                                                                              |
| Media licenses                | Out of reach of `scripts/check-licenses.ts`, which only reads npm metadata. Media is governed by the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md) and declared in `assets.manifest.json` (below); no script reads that manifest yet, so it is reviewed by hand.                                                                                                                        |
| Git                           | `assets.local/` is already in `.gitignore` (the [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md) added it), so nothing generated or fetched can be committed by accident. Render output goes to `out/`, which `.gitignore` already ignores, so no example writes an artifact into the tree.                                                                                                          |

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
- The determinism suite. `defineDeterminismSuite`/`runDeterminismSuite` live in `src/render/determinism/suite.ts`; `/render` exports `createRenderer` and its types only, and `package.json#exports` has no third subpath, so no file under `examples/` can import them without violating the boundary below. The gate reaches an example from the outside instead ([CI policy](#ci-policy)).

Consequences the example tasks must live with:

- **Motion before Phase 2 is plain arithmetic on time.** A component computes style values from `useTime()` (for example `opacity = Math.min(1, useTime() / 0.3)`), inside a component, without a library. When `/motion` and `/theme` arrive, the example task replaces that arithmetic with `interpolate`/`spring`/`Stagger` and Theme tokens; the Composition structure and the acceptance look do not change.
- **Every `useAsset` consumer sits in a local `<Suspense fallback={null}>`** inside the tree. `Composition` and `CompositionContent` are exported, but they belong to the page bootstrap: an example never renders `Composition` itself and cannot build the `ContentRegistration` that `CompositionContent` needs. A throw that reaches the root `Suspense` keeps `RootContent` from committing, so the Composition's own content acknowledgement (`composition-root`) never happens and the readiness barrier waits until its deadline. `src/render/determinism/fixtures/references.tsx` shows the working shape (`asset-suspense`).
- **A `Transition`'s children mount only during the overlap**, and only they can read `useTransitionProgress()`. A crossfade therefore re-declares the outgoing and incoming scene inside the `Transition` child with `opacity = 1 - progress` and `progress`. Every example uses one shared `CrossFade` component for that; folding it into a preset is Phase 3 work, not an API change here.
- **Fonts and images are addressed by root-relative URL** (`/examples/explainer/assets/fonts/NotoSansJP[wght].woff2`), never by a JavaScript import of the file. The loading session serves the project root (`process.cwd()`), and the determinism suite needs the same string to work in its temporary project, where it copies the file into `public/` under the same relative path (`staticFiles`).

### Running an example

The CLI's `projectRoot` is `process.cwd()`, and React, ReactDOM and Zod resolve against the repository root, so every command runs from the repository root:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/

# Full render (needs FFmpeg 6.0+ with libx264 on PATH for the .mp4 route)
node dist/cli.js render examples/teaser/entry.tsx --composition teaser --out out/teaser.mp4 --json

# A still frame for visual review (teaser has no required props; see the chart note below)
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
- `render` creates the directories its output path needs; `frame` does not, and fails with `internal.unexpected` on a missing parent, which is why the block starts with `mkdir -p out`.
- `frame` has no `--props` (only `render` declares one, `src/cli/commands.ts`). An example whose schema has a required prop therefore has no still route: `chart`'s `series` has no default, so its still is a frames render (`render … --out out/chart-frames`, which writes every frame plus `manifest.json`) rather than `frame`. A `--props` on `frame` is a CLI follow-up, not this document's.
- A missing entry is `cli.entry-not-found` (exit 2), an unknown `--composition` id is `cli.composition-not-found`, `--props` that is not a JSON object string is `cli.invalid-arguments`, and valid JSON that fails the Composition's schema is `composition.props-invalid`. All four are what an example README tells the reader to expect when they get the command wrong.
- Every render writes under `out/` at the repository root. `assets.local/` is the only other generated location.

### `explainer` — long duration, many Sequences and Transitions, subtitles against audio

**Composition.** `explainer`: 1920×1080, 30 fps, `durationInFrames` derived from the script (both Time Module calls return a `Result`, so both are unwrapped):

```ts
import { createFrameRate, createTimelineTime, frameCount, type Result } from '@kimuson/motion-kit';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`explainer: ${result.error.message}`);
  return result.value;
};

const fps = unwrap(createFrameRate({ numerator: 30, denominator: 1 })); // FrameRate
const durationInFrames = Number(unwrap(frameCount(unwrap(createTimelineTime(totalSeconds)), fps))); // bigint → the number the registry declares
```

`totalSeconds` is the script's dialogue total plus a 3-second tail for the disclaimer and credits; target 180–300 seconds (5400–9000 frames, exact in a `Number`). `explainer-ci`: 960×540, 60 frames. `explainer-probe`: 480×270, 30 frames ([CI policy](#ci-policy)).

**Structure.** Three layers, all computed from `script.ts` at module load, so the video and the data cannot disagree:

1. **Slide layer** — one `TransitionSeries` from frame 0. Each script slide cue becomes a `TransitionScene`; adjacent slides get a `Transition` of 0.4 s (12 frames) with the shared `CrossFade`. `TransitionScene` duration is "the sum of that slide's lines' seconds + its outgoing overlap (0.4 s, zero for the last slide)". With that rule the series total is exactly `Σ lines + Σ overlaps − Σ overlaps = Σ lines`, and slide `i` starts exactly at its first line because its predecessor's outgoing overlap is what pays for the crossfade; the overlap then runs over the first 0.4 s of slide `i`'s first line.
2. **Subtitle layer** — one `Sequence` per line, `from` = the cumulative sum of the preceding lines' seconds, `duration` = the line's seconds. This layer has no transitions: it proves that many Sequences in one Composition keep exact timing.
3. **Sprite layer** — the speaker's sprite for the lines in view, switched by the line's `expression`, inside its own `Sequence`s. Two characters side by side, the non-speaker dimmed to 60% opacity. `expression` is not the only channel: each expression ships a resting and an open-mouth frame, and the sprite alternates them every 0.15 s inside a speaking line, so the owner's "expression/mouth" axis is covered without a lip-sync asset contract. Both frames come from the same place the sprite itself does ([Assets and provenance](#assets-and-provenance)): nothing sprite-related is committed.

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

- `seconds = ceil(codePoints(text) / 5)`, i.e. 5 Japanese characters per second, counted over the raw `text` including punctuation. TASK-170's own bounds (900–1500 characters, and 180–300 seconds for `totalSeconds` — the dialogue plus the tail, so the bound is on the length the Composition actually renders) come out of this rate, so the script and the Composition duration agree by construction.
- The voice track never becomes the timing authority. When VOICEVOX audio exists, `fetch-assets.ts` writes `assets.local/voice/durations.json` (line id → measured seconds) and `entry.tsx` prefers it over `seconds`; the timeline stays frame-derived, the audio is placed at those same times by TASK-171, and `durations.json` is generated, never committed.
- Content rules are TASK-170's, and this document adds only the ones the video shell must enforce: the last slide is the `disclaimer` cue and stays on screen for the 3-second tail; no line names a fund, broker or allocation; the credit lines the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md) requires appear in the tail slide and in `README.md`.

**Dependencies.** `Sequence`, `TransitionSeries` and the hooks — TASK-156 and TASK-154 (already in `src` on `main`). Font and image readiness — TASK-158. MP4 encoding — TASK-159. The determinism suite — TASK-160. The CLI — TASK-161. Script content and schema — TASK-170. Voice and music muxing — TASK-171. Subtitle easing with `spring`/`interpolate` — TASK-152/155 plus `/motion` (Phase 2). Font tokens and typography — theme and presets (Phase 2/3). A first version needs nothing beyond `main`; every later phase tightens it without changing the script format.

**Assets.** The script and the slide outline are authored and committed. Everything else follows the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md) through the layout in [Assets and provenance](#assets-and-provenance): Noto Sans JP arrives as a committed `.woff2` with `OFL.txt`; the VOICEVOX WAVs are generated against a local engine into `assets.local/voice/`; the 立ち絵 sets are fetched into `assets.local/sprites/`; neither is committed. `assets: 'placeholder'` renders the FFmpeg-generated placeholder sprites and the committed font, silent.

**Acceptance look.** A calm 16:9 deck: warm off-white background, one accent colour, the two characters at the lower corners, a three-line subtitle band at the bottom third in a legible Japanese face (≥72 px at 1080p, no clipped descenders), and a slide that changes every 15–25 seconds with a 0.4-second crossfade that never shows both slides at full opacity. Numbers and charts enter by counting up while the narration reaches them. Nothing in the frame moves while nobody speaks. A person watching it should be able to follow the argument with the sound off (subtitles) and with the picture off (narration).

**CI.** `explainer-ci` at 960×540 for 60 frames selects the disclaimer slide plus one dialogue line plus one crossfade, with the generated placeholder sprites in `assets.local/` and no audio — it exercises the three layers, a `Transition` overlap, `useAsset` for two placeholder images, and Japanese text through the fallback stack. It is the only explainer MP4 in CI; the full-length render is a local QA Check. `explainer-probe` ([CI policy](#ci-policy)) carries the determinism gate: the same three layers at 480×270 for 30 frames, with the media steps of the sprite and slide layers replaced by flat surfaces, because the recorded determinism failure involved an image inside a `Sequence` (see the open finding in [CI policy](#ci-policy)).

### `teaser` — dense springs, Stagger, Theme tokens, determinism under heavy motion

**Composition.** `teaser`: 1920×1080, 30 fps, 450–900 frames (15–30 s). `teaser-ci`: 960×540, 60 frames (the opening word plus the first two transitions).

**Structure.** 8–12 words, one to three on screen at a time, each entering with a spring and leaving with an easing curve; a `Stagger` of 8–20 small elements (dots, rules, letter masks) behind the type; every colour, font size and duration read from a Theme token once Phase 2 lands. Motion is dense on purpose: at least one element is in motion in every frame, and several springs change target mid-flight (the `retarget` case once `/motion` exposes it), which is what makes the determinism test meaningful.

**Dependencies.** The final form needs `/motion` (`Animate`, `Reveal`, `Stagger`, spring and easing) and `/theme` — both Phase 2, and neither has a Backlog task yet; TASK-152 (pure motion) and TASK-155 (closed-form spring) are the parts that exist. Typography and transition presets are Phase 3. The Phase 1 version of the teaser is therefore plain arithmetic on `useTime()` with hard-coded values, and the example task that lands after Phase 2 replaces it; the Composition ids and the acceptance look stay.

**Assets.** No media. An OFL font committed with its `OFL.txt`, or the system stack; the product name and tagline are text ([asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md)).

**Acceptance look.** 15–30 seconds of type that never sits still and never looks busy: high contrast on a dark ground, one accent colour, words that snap in with a spring overshoot of a few percent and settle, letters that stagger by 30–50 ms, and a final frame that holds the product name for the last second. Played twice, every frame is identical; that is the point of the example.

**CI.** `teaser-ci` renders as an MP4 in CI; the determinism gate runs over `teaser-probe` — the opening word plus the first two transitions at 480×270 for 30 frames, at determinism frames `[0, 15, 29]`. Exact PNG bytes, no tolerance: the teaser is the Composition that would expose a wall-clock or history-dependent animation first, and it has no media, so its probe covers the real tree rather than a stand-in.

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

- `series` has no schema default, so the entry's own `data/index-30y.json` is passed as `--props` in the documented command; a reader who omits `--props` gets `composition.props-invalid` with the failing path, which is the schema-first behaviour the example exists to demonstrate. The example README documents both commands, and the still route is a frames render rather than `frame` (see [Running an example](#running-an-example)).
- Each file under `examples/chart/data/` is a complete props object (`{ "title": …, "source": …, "series": […] }`), not a bare array, so `--props "$(cat examples/chart/data/index-30y.json)"` works verbatim and the from/to year range is derived from the points rather than declared twice.
- Rendering is inline `<svg>` written as JSX: axes, gridlines, a polyline per series, a marker per point, and a value label that counts up from 0 to the final value over the last 1.5 s. No chart library, so no dependency and no nondeterminism.
- Number formatting is a small local function, not `Intl.NumberFormat`: ICU data differs between a developer machine and the CI runner, and the determinism suite compares PNG bytes.

**Dependencies.** Schema-first props through the registry (TASK-154) and `--props` through the CLI (TASK-161) exist today; SVG and DOM text are Phase 1 rendering features covered by the existing determinism fixtures (`svg-path`, `dom-text`). `interpolate`/`easing` for the draw-on and count-up curves arrive with `/motion` (TASK-152, Phase 2); until then the curves are `Math.min(1, t / duration)`.

**Assets.** One committed props JSON file per dataset under `examples/chart/data/`, authored for the repository, with the source recorded in its `source` string and in the example README. Which public series may be used, and how it is cited, is an open question for the owner (below); the committed dataset is a synthetic series that behaves like an index (30 yearly closes) so the example is never blocked.

**Acceptance look.** A single large chart on a light ground with the title top-left, the unit on the y-axis, years on the x-axis, and the source line in 24 px grey at the bottom. The line draws on left to right in 3 seconds, points pop in as the draw passes them, and the final value counts up and then holds for 4 seconds. Regenerating with a different dataset changes the shape and the numbers and nothing else about the layout: the y-domain, tick count and label positions are computed from the data, so a 1995–2024 series and a 2005–2024 series both fill the frame correctly.

**CI.** `chart-ci` renders as an MP4 with `--props` pointing at a second, small dataset committed under `examples/chart/data/`, so CI covers the regeneration axis rather than only the default data; the determinism gate runs over `chart-probe`, which renders one small dataset held as a module constant in `probe.tsx` and takes no props. That is deliberate: `DeterminismComposition.props` is a flat `Record<string, string | number | boolean | null>` (`src/render/determinism/suite.ts`), so a nested `series` cannot be passed through the suite at all; keeping the probe's props empty is what keeps the gate inside the shipped types. Widening that record is a `src/render` change (the loading session already accepts nested JSON through `Selection.props`), and it is not this document's.

### `slideshow` — 9:16 vertical, Ken Burns, audio mixing, aspect switching

**Composition.** `slideshow`: 1080×1920, 30 fps, 600–1200 frames (20–40 s), 6–10 slides. `slideshow-landscape`: the same slide components at 1920×1080, proving that the components read `useTimeline().width/height` instead of a hard-coded frame. `slideshow-ci`: 540×960, 60 frames.

**Structure.** One `TransitionSeries` over the slides, 0.5 s crossfades, each slide a Ken Burns move computed from `useSequence().time` and `useSequence().duration` (scale 1.0 → 1.12 and a pan of ±4%, alternating direction per slide). Images load through `useAsset({ kind: 'image', … })` inside a local `<Suspense>`; the slide's alt text or caption is drawn from the same props so a missing image is a visible diagnostic, not a blank frame.

**Dependencies.** `useAsset` image readiness (TASK-158), `Sequence`/`TransitionSeries` (TASK-156/154), MP4 encoding (TASK-159) and the CLI (TASK-161) exist. Background music needs TASK-171. Video clips need a `video` asset kind and a frame-seeking integration — no task exists, and the Phase 0 ADR's R12 leaves the frame-selection mechanism open (priority P3, Phase 2; it assigns no tier), so the first version is images-only and the video-clip axis is deferred ([Open questions](#open-questions)).

**Assets.** Eight photos are FFmpeg `color`/`testsrc` placeholders generated into `assets.local/photos/`; a CC0 photo may be committed with its source URL recorded once a placeholder will not do, and never a Pixabay or Unsplash one. Music is an FFmpeg `sine`/`anoisesrc` tone bed under `assets.local/music/`. Which files may be committed, and with what credit, is the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md)'s ([Assets and provenance](#assets-and-provenance)).

**Acceptance look.** A vertical feed video: full-bleed images, slow Ken Burns with no visible stepper, white captions in the lower third with a subtle shadow, 0.5-second crossfades, and a music bed that ends with the last slide rather than being cut off. The same components at 16:9 must fill the wider frame without letterboxing and without the caption leaving the safe area.

**CI.** `slideshow-ci` at 540×960 renders as an MP4 with placeholder images and no audio; the landscape variant is checked by its descriptor and one still frame in the same test, not by a full render. The determinism gate runs over `slideshow-probe`: the `TransitionSeries` crossfade and the `useTimeline().width/height` aspect switch with flat placeholder surfaces rather than the `useAsset` photos, for the reason in [CI policy](#ci-policy).

### Assets and provenance

The policy is not this document's. Which files may be committed, how the rest are produced, and what credit each example carries are fixed by the [example-asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md), accepted after this document and winning where the two disagree ([Precedence](../guidelines/review/index.md#precedence)). What is decided here is the layout those files land in, which asset each example needs, and who generates the placeholders.

_Amended 2026-10-26 (TASK-168):_ this section used to commit authored SVG placeholders (`assets/sprites/*.svg`, `assets/photos/*.svg`) and to leave the font at "only if the ADR allows". The ADR supersedes that: a committed asset must permit verbatim redistribution under a condition the file itself discharges, so the committed set is the OFL font with its `OFL.txt` plus CC0 media, and the voices, the sprites, the music and the photos are generated or fetched into the ignored directory and never committed. The ADR is not amended; this section is.

- `examples/<name>/assets/` — **committed**: `fonts/NotoSansJP[wght].woff2` with `OFL.txt` beside it, the authored JSON under `chart/data/`, and a CC0 media file only where a generated placeholder will not do, committed with its source URL recorded. No voice, sprite or track, and no third-party photo beyond such a CC0 file.
- `examples/<name>/assets.local/` — **gitignored** (`.gitignore` already carries `assets.local/` from the ADR), filled by the committed `examples/<name>/fetch-assets.ts` (Node, never Python).
- `examples/<name>/assets.manifest.json` — **committed**: every file in both directories with `path`, `kind` (`font`/`image`/`audio`/`video`/`data`), `source` (URL or "authored"), `license` (SPDX id or "authored") and `credit`. Nothing reads it yet — the ADR leaves `scripts/check-licenses.ts` package-only and adds no asset read — so the manifest is reviewed by hand with the example's PR; a check that reads it is a follow-up, not a gate here.

**Who generates placeholders, and when.** `fetch-assets.ts` has two steps, and only the first can run in CI:

| Step                                                                                                       | Writes                                                                                                                | Needs                                                  | Runs                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Placeholder generation: FFmpeg `color`/`testsrc` for images, `sine`/`anoisesrc` for the tone bed           | every placeholder under `assets.local/` — the sprites, the eight photos, the music                                    | FFmpeg, which the render path already requires         | once after a clone, and in CI as the smoke test's own setup, before the render — no network, no engine, no committed bytes |
| Final fetch: the 立ち絵 sets, then `POST /audio_query` + `POST /synthesis` against a local VOICEVOX engine | `assets.local/sprites/`, `assets.local/voice/*.wav`, `assets.local/voice/durations.json` (line id → measured seconds) | network, a manual sprite download, an installed engine | locally only, as the QA Check's setup; never in CI                                                                         |

Both steps read the committed script text, so the placeholder video and the final one carry the same timing. Neither step writes into `assets/`: once the first step has generated the local placeholders, a clone renders the placeholder video, and a render started before setup — the `final` one always, the placeholder one until step 1 runs — fails through the existing `asset.load-failed` diagnostic rather than rendering a silent fallback ([the ADR's consequence](../decisions/20261026-example-asset-licensing.accepted.md#consequences)).

Every example whose look depends on media — `explainer` and `slideshow` — carries one shared switch, so a run without the fetched media is still a complete video:

```ts
const assets = z.enum(['placeholder', 'final']).default('placeholder');
```

`placeholder` renders the generated placeholder files and the committed font, with no audio; `final` renders the fetched voices, sprites and photos. CI and every commit-time render take the default; the local QA render passes `--props '{"assets":"final"}'`. The switch is not a licence mechanism — nothing third-party becomes committed by taking it — it is how a reader without a VOICEVOX engine still renders the explainer. `teaser` (an OFL font or the system stack) and `chart` (its data is `series`, passed as `--props`) need no switch.

| Example     | Asset                                                | Where                                             | Committed                       | Decided by                                                                                     |
| ----------- | ---------------------------------------------------- | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `explainer` | Script and slide outline                             | `script.ts`                                       | Yes, authored                   | TASK-170                                                                                       |
| `explainer` | Japanese font (Noto Sans JP)                         | `assets/fonts/NotoSansJP[wght].woff2` + `OFL.txt` | Yes — OFL-1.1                   | [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md)                         |
| `explainer` | VOICEVOX voices (2 characters)                       | `assets.local/voice/*.wav`                        | No — generated locally          | [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md) (terms), TASK-171 (mux) |
| `explainer` | Character sprites (expressions, rest and open mouth) | `assets.local/sprites/*.png`                      | No — fetched locally            | [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md)                         |
| `explainer` | Placeholder sprites                                  | `assets.local/sprites/` (FFmpeg `color`)          | No — generated                  | this document                                                                                  |
| `explainer` | Slide charts                                         | inline SVG in `slides/`                           | No file                         | this document                                                                                  |
| `teaser`    | Font (Latin)                                         | `assets/fonts/` or the system stack               | Only an OFL font with `OFL.txt` | [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md)                         |
| `chart`     | Series JSON (2 datasets)                             | `data/*.json`                                     | Yes, authored/synthetic         | this document; real source open                                                                |
| `slideshow` | Photos (8)                                           | `assets.local/photos/*.png`                       | No — FFmpeg `color`/`testsrc`   | [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md)                         |
| `slideshow` | Music                                                | `assets.local/music/`                             | No — FFmpeg `sine`/`anoisesrc`  | [asset ADR](../decisions/20261026-example-asset-licensing.accepted.md)                         |
| `slideshow` | Video clips                                          | —                                                 | No                              | Open (no task)                                                                                 |

Nothing third-party is committed under `examples/`: the only committed binaries are the OFL font and, where a generated placeholder cannot do the job, a CC0 media file with its source URL recorded in `assets.manifest.json`. The ADR sets no per-example cap on that file; the coverage decision here is that `chart` and `teaser` commit none and `explainer` and `slideshow` reach for one only if a placeholder will not do.

### CI policy

CI proves three things about the examples: they typecheck and lint, the structure of each axis is traversal-independent at a bounded size, and the CLI can render each `-ci` Composition to a valid MP4. It does not prove the videos look right — that is a human check.

| Gate               | Where                                                                                           | What runs                                                                                                                                                                                                                         | Added cost budget                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Typecheck and lint | `pnpm lint`, `pnpm typecheck` in the existing `check` job                                       | `examples/**` through `tsconfig.json#include`, oxlint, oxfmt, and a hand review of `assets.manifest.json` (no script reads it yet)                                                                                                | < 10 s                                                                         |
| Determinism probe  | `frame-transport` project, no config change: `src/**/*.determinism.test.ts` is already included | `src/render/determinism/examples.determinism.test.ts` runs one `defineDeterminismSuite` per axis over `examples/<name>/probe.tsx` (`<name>-probe`, 480×270, 30 frames) at frames `[0, 15, 29]`. Exact PNG bytes, no tolerance.    | ≤ 25 s per probe (3.9 s local, ~17 s projected on CI), 4 × 25 = ≤ 100 s total  |
| Smoke MP4          | `cli` project: add `examples/**/*.smoke.test.ts` to `include` (`vitest.config.ts`)              | `<name>-ci` → `out/examples/<name>-ci.mp4` through `node dist/cli.js render … --json`, then `ffprobe` asserts 60 frames, 30/1 fps, the CI width/height and a 2.0 s duration. `chart-ci` passes `--props` from the second dataset. | ≤ 20 s per example (2.8 s local, ~12 s projected on CI), 4 × 20 = ≤ 80 s total |
| Not in CI          | —                                                                                               | Full-length renders of `explainer`, `teaser`, `chart`, `slideshow`; the same four Compositions' determinism suites; any audio; any `assets: 'final'` render; the landscape variants' full renders                                 | —                                                                              |

- **The job today, and the room the examples use.** The `check` job has a 15-minute timeout and measured **5 m 01 s, 5 m 45 s and 6 m 36 s** in the last green runs (`40293049766`, `40209557682`, `40298930660`). Both caps are per-gate × four examples (4 × 25 s = 100 s, 4 × 20 s = 80 s) and both are set from CI's own speed, not from this machine's: `frame-transport` takes **20.2 s** here and **88 s** on the runner (job `121491741320`, ~4.3×), so a 3.9 s probe projects to ~17 s and a 2.8 s smoke render to ~12 s there. The examples therefore add **~2 minutes projected** (10 s lint and typecheck + ~66 s of probes + ~48 s of renders) and at most ~3 minutes at the caps; a recent green run (6 m 36 s, `40298930660`) lands near 9 minutes against the 15-minute timeout, so the headroom is about 6 minutes rather than the 7 an unchanged local-to-CI factor would suggest.
- **CI renders are 2 seconds at reduced size.** A 1080p 60-frame encode plus 30 captures costs tens of seconds per example, and a full 20–30 s clip would consume minutes. The `-ci` Compositions are therefore half linear resolution (960×540, and 540×960 for the vertical) and exactly 60 frames, and they must reuse the full example's scene components — never a simplified copy. Measured cost of one such render end to end through the CLI, FFmpeg included: **2.84 s** wall for a 960×540, 60-frame TransitionSeries + Sequence tree (a capture averages about **39 ms** at 1920×1080 — 9.81 s over 251 captures — while at 480×270 the same average is **55 ms** over 71 captures; the small probe's ≈1.7 s of renderer opens is what lifts it, and once that fixed floor is removed both sizes sit near 32 ms, so the marginal per-capture cost barely moves with resolution).
- **No `--frame-range` flag is added.** The only way to render a short window today is a Composition with a short duration, which is what the `-ci` definitions are. If the agent context later adds a frame range to `render`, the `-ci` Compositions are removed and CI renders a window of the real Composition instead.
- **The determinism gate is a probe, not the real Composition, because the suite's cost is set by the frame list's maximum.** `runDeterminismSuite` builds its baseline with `renderFrames({ from: 0, to: focus + 1 })`, `focus = max(frames)`, and the required `reverse` mode re-captures `focus..0` (`src/render/determinism/suite.ts`, `compare.ts`). One suite therefore costs `2 × (focus + 1) + 11` captures for a three-frame list with `sustainedPasses` left unset — the extras are `frames + 8`: `sequential-then-n`, `fresh-realm`, `held-session` and `fresh-renderer` are one capture each, `repeated` is three, and `randomOrder` re-captures the focus frame (four for a three-frame list), so `[0, 15, 29]` is 71 — plus two renderer opens; a longer list pays one more capture per frame, and setting `sustainedPasses` adds `focus + 1` captures per extra pass (`phase1.determinism.test.ts` sets six, so 5 × 30 more on its shape). The Composition's duration does not enter, but the highest frame index in the list does. Measured: 1920×1080 with `[0, 60, 119]` takes **9.81 s** over 251 captures, about **39 ms per capture** (QA measured 10.86 s on the same shape), so a 5400–9000-frame `explainer` with the last frame in its list is **minutes per example** and cannot fit the job. Shortening the list does not help while the last frame stays in it; dropping it is what makes the gate cheap. The probes are 480×270, 30 frames, `[0, 15, 29]`: measured **3.87 s and 3.92 s** per suite on macOS arm64, and 2.12 s for the same Composition at `[0, 1, 2]` — the floor is the two renderer opens, not the captures.
- **A probe is a bounded smoke of the seven modes over one axis's structure, and it says so.** It reuses the example's components (its `TransitionSeries`/`Sequence` timing, the shared `CrossFade`, the chart's SVG component, the Ken Burns arithmetic) at 480×270 for 30 frames, and it declares an empty props schema. It is not certification of a 9000-frame video: the evidence for long compositions is the Phase 1 suite (`docs/contexts/render/knowledge/20261024-phase1-determinism.md`) plus the human QA Check, and a full-Composition suite is a local check for whoever changes a media path, not a CI step.
- **The probe is reached from `src/render/determinism/`, never imported by an example.** `defineDeterminismSuite` has no public export (`/render` exports `createRenderer` and its types; `package.json#exports` is `.`, `./render`, `./agent`), and an example may not import `src/**` by relative path (§"The surface an example may use"). So the suite file lives next to the suite and names the example's registry by path: `composition.modulePath` is a string, `new URL('../../../examples/<name>/probe.tsx', import.meta.url).pathname`, which the loading session imports in its temporary project. That obeys the boundary in both directions and adds no package surface. There is no `examples/**/*.determinism.test.ts` include.
- **Probe props stay flat**, for the reason the `chart` section gives: `DeterminismComposition.props` is a flat `Record<string, string | number | boolean | null>`, so the chart probe renders a module-constant dataset and passes none.
- **A recorded defect, not a certain one: an image `useAsset` inside a `Sequence` failed `reverse` twice and has not reproduced since.** The tree is built only from shipped APIs (`TransitionSeries`/`TransitionScene`/`Transition` + a local `Suspense` + `useAsset({ kind: 'image' })` inside `Sequence from=0.5 duration=1`), and `reverse` reported PNG bytes differing from the sequential capture — once in the first QA round at **frame 44** (1920×1080, 120 frames; `1697` differing bytes, `39832` vs `39830`), once when re-run at **frame 38** (480×270, 60 frames; `3269` differing bytes, `3494` vs `3534`) — while the other six modes passed on both. Twelve further suite runs across four shapes — the 480×270/60 shape six times, the image `Sequence` nested inside the second `TransitionScene`, two images in one `Sequence`, and the 1920×1080/120 shape — passed every time. So this is recorded as an **observed, intermittent race**: 2 reproductions against a number of runs that was never counted, and 0 in 12 deliberate re-runs. Two failures of one mode on one construct are enough to keep the conservative gate exclusion — `explainer-probe` and `slideshow-probe` render flat surfaces instead of the `useAsset` images the real trees use, and the `-ci` Compositions stay out of the gate — and not enough to claim the path is broken. **It is a finding, not a numbered Backlog task**: the record is the two frames, the byte counts and these twelve runs, and the owner decides whether to file it as a `Bug` (`[core]`/`[render]`) or to let the media back into the probes. Either outcome releases this exclusion, which costs coverage and never correctness, so no example waits on it.
- **Audio is manual.** CI runs are silent (no audio declarations), because the voice and music files are generated locally and gitignored. TASK-171's own tests prove muxing and onset alignment; the explainer's QA Check is where the real track is judged.
- **What the QA Check does instead** (`docs/guidelines/quality-assurance/index.md`, human check): render each full example at its real resolution, watch it, compare against the acceptance look in this document, and record the command, the wall time and stills in the example's README or a `knowledge/` note next to the example. A change to what a video looks like is a human check by the [criteria](../guidelines/quality-assurance/human-check-criteria.md).

## Open questions

These need the owner; they do not block the layout, the CI policy or the first silent versions.

1. **The teaser's fictional product.** The signature line needs a name and a tagline. Recommendation: an obviously fictional developer tool ("Zephyr — notes that think"), chosen so no real product is implied; the example ships the words in one `copy.ts` constant, so changing them is a one-line edit.
2. **The chart's data source.** A 30-year series from a named public source (cited on screen and in the README) is more convincing than a synthetic one, but index values carry provider terms the [asset licensing ADR](../decisions/20261026-example-asset-licensing.accepted.md) does not admit — it commits CC0 only. Recommendation: ship the synthetic series as the committed default and, if the owner accepts the source's terms, add one real series as a second dataset; the video never presents it as advice either way.
3. **Video clips in the slideshow.** Frame-accurate clip playback needs a `video` asset kind plus a seeking integration, which no Backlog task covers, and the Phase 0 ADR's R12 leaves the mechanism open (P3, Phase 2). Recommendation: ship the slideshow images-only first (it still proves asset readiness, audio mixing and aspect switching), and schedule a `[render]` video-asset task when Phase 2 opens; the `slideshow` Composition id and its slide components stay unchanged when clips arrive.

## Alternatives

- **A per-example `defineDeterminismSuite` over the full Composition.** It keeps the gate on the real tree, but the suite's first mode renders every frame from 0 to the highest frame in the list and `reverse` renders them all again, so the cost follows the video's length: measured 9.81 s for a 120-frame 1920×1080 Composition (≈39 ms per capture, 251 captures), which extrapolates to minutes for a 5400–9000-frame explainer and to ~15 minutes for four examples — the whole job. It is also not expressible under this document's boundary, because the suite is not a package export. A bounded probe keeps the seven modes and a real Composition at ~4 s.
- **Gating the `-ci` Compositions with the suite as they are.** They are 60 frames, so a suite would cost about 120 sequential captures (seconds), but each `-ci` Composition loads images through `useAsset` inside `Sequence`s, and that construct failed `reverse` twice ([CI policy](#ci-policy)); gating them would red the first example on an intermittent failure. They join the gate when the race is settled in either direction.
- **One showcase video instead of four.** A single 3–5 minute demo stresses everything and isolates nothing: when it breaks, no context owns the failure, and its CI cost would be the whole budget. Four targets give each axis an owner and a cheap gate.
- **`examples/` as its own pnpm workspace package with a `package.json` per example.** It would test the consumer install path more faithfully, but it doubles dependency resolution, hides self-reference bugs (`@kimuson/motion-kit` resolves through the loading session's alias anyway), and adds an install step to CI. The repository root stays the project root; `--props` and the loading session already cover the consumer path.
- **Put the examples under `spikes/`.** Spikes are Phase 0 experiments with their own vitest configs: their tests run only through `pnpm spike:*`, never in `pnpm test` or CI, and they are not shipped. Reference examples are the quality bar and must be typechecked, linted and gated like `src/`.
- **CI renders the full clips and relies on image regression against stored baselines.** There is no baseline store, full-length renders do not fit the 15-minute job, and byte comparison against a stored baseline breaks on every legitimate visual change. Traversal determinism plus an MP4 smoke test catches the failures CI can attribute; the look is a human check.
- **A `--frame-range` flag on `render` to clip CI renders out of the real Composition.** It changes the CLI contract (agent context) to save an `-ci` Composition per example, and the CLI's envelope would have to describe a partial render. A second short Composition is the cheaper decision; the flag can replace it later without changing this document's targets.
