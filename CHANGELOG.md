# Changelog

All notable changes to `@kimuson/motion-kit` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from `1.0.0`.

## Unreleased

### Added

- **See a whole Composition in one image.** `motion-kit contact-sheet <entry> --every 150
  --out sheet.png` writes one PNG holding a grid of representative frames, each labelled with its
  frame number and presentation time, so a coding agent judges the pacing and the per-scene layout
  from a single image instead of reading one frame at a time. `--every <n>` walks the region from its
  first frame and always ends on its last, `--frame <n>[,<n>...]` names the tiles instead (one or the
  other, never both), and `--from`/`--to` reuse the range `render` already accepts, so a section can
  be reviewed on its own. `--columns` and `--tile-width` shape the grid and the labels scale with it;
  one sheet holds at most 64 tiles and at most 16384 pixels a side. The frames are captured in
  ascending order through one renderer and composited in a static Chromium page, so the same input
  writes byte-identical PNGs twice; `--out` must be a `.png` path and a refused write is
  `render.output-unwritable`. `--json` reports `data.format: "contact-sheet"` with the output path,
  the grid dimensions and every tile's frame, time and cell. Invalid arguments (no selection, both,
  a malformed step or grid, a non-`.png` target, a frame the written range leaves out) are
  `cli.invalid-arguments` (exit 2) before a browser opens, a frame outside the Composition stays
  `composition.props-invalid`, and no Diagnostic code is added, so `schemaVersion` stays `1`. The
  [contact-sheet ADR](docs/contexts/agent/adr/20261104-contact-sheet.accepted.md) records the
  compositing method and the determinism argument.
- **`render` reports progress, and the CLI has one stderr policy.** `render` writes
  `rendering <done>/<total> frames (<percent>%) ETA <duration>` to stderr for both routes, the total
  being the artifact's frame count and the count summed over the `--concurrency` renderers; a
  terminal gets one line rewritten in place, a pipe one line per 10%, and the ETA is the rate over
  the last three seconds. `render`, `frame` and `check` also take `--verbose` and `--quiet`: the
  default keeps the Composition's page console and the loading service's output out of stderr (a
  failed run prints the last 20 lines under `renderer log` instead), `--verbose` streams them as
  they arrive, and `--quiet` hides them and the progress. Chromium's
  `Automatic fallback to software WebGL has been deprecated` warning and the other notices every
  render emits are no longer printed; `--verbose` shows them, and the bin's own Node
  `ExperimentalWarning` is dropped unless `--verbose` is passed. The envelope gains no field and
  `schemaVersion` stays `1`. The
  [stderr policy ADR](docs/contexts/agent/adr/20261103-cli-stderr.accepted.md) records the levels,
  the progress format and the failure block.
- **Export the mixed audio alone.** `render` takes an `--out` ending in `.wav` and writes the
  Composition's declared `audio` mixed into 48 kHz stereo 16-bit PCM, without capturing a single
  frame: a loudness (RMS), balance or whisper check that used to cost a full 2.6–6 minute MP4 render
  now takes seconds. The file is the encoder's own mix — the same filter graph, gains, channel
  handling and frame-derived placement — so the WAV and the MP4's decoded audio are directly
  comparable, and `--from`/`--to` clip the declared clips against the range exactly as the video's
  audio is clipped. The export mounts one Renderer and never captures, because the resolved length
  and the declared clips live only in the page realm; `--concurrency`, `--video-crf`,
  `--video-bitrate`, `--scale` and `--fps` are `cli.invalid-arguments` (exit 2) for a `.wav` target,
  and the FFmpeg probe only checks the version, because no video is encoded. `--json` reports
  `data.format: "wav"` with `sampleRate`, `channels`, `bitDepth`, `durationSeconds`, `trackCount`
  and the same `range`; a Composition that declares no audio is the new `render.no-audio` (exit 1)
  instead of a silent file, while a range that keeps no clip writes silence with `trackCount: 0`.
  A missing clip stays `asset.load-failed` and a refused target keeps the `encode.*` codes. The
  [audio export ADR](docs/contexts/render/adr/20261103-audio-only-wav-export.accepted.md) records the
  surface, the format and why a realm is still opened.

- **Render part of a Composition.** `render` takes `--from` and `--to`, each a Global Frame (`3600`),
  `mm:ss[.fff]` (`4:20`) or seconds with an `s` suffix (`260s`), and writes only that half-open
  interval as a new zero-based artifact — audio included, with the declared clips trimmed and placed
  against the range's start. The frames route writes the same interval as `frame-00000.png`, … so a
  ranged sequence is standalone too. `--json` adds `data.range` (the original timeline frames and
  seconds) and reports `frameCount`/`durationSeconds` for the artifact; the frames `manifest` carries
  the same `range`. A Composition that declares audio keeps one audio stream (silence where no clip
  plays) and every declared `src` is validated, on ranged and whole renders alike. A bound that cannot
  be read, an empty or inverted range of one notation, and a range outside the Composition are
  `cli.invalid-arguments` (exit 2); the first two are decided before a browser opens. The
  [render frame range ADR](docs/contexts/agent/adr/20261103-render-frame-range.accepted.md) records
  the notation, the rounding and how the range combines with `--fps`, `--scale` and `--concurrency`.
- **Metadata from props.** `defineComposition` accepts `resolveMetadata`, a callback that derives a
  Composition's `durationInFrames` (and optionally `width`, `height` and `fps`) from its validated
  props, with the types `CompositionMetadataInput`, `CompositionMetadataOverride` and
  `MetadataResolver`. It runs once per mount in the page, may be asynchronous and has a fresh
  loading timeout of its own, so `render`, `frame`, `check` and `preview` read the same metadata for
  the same props: a generated script now renders with `--props` alone instead of being imported
  statically. The resolver reads a frozen copy of the props, so it cannot change what the component
  renders, and a renderer pool stops at mount when two realms resolve different metadata instead of
  mixing two Compositions. A missing field keeps the declaration's value, `listCompositions()` keeps
  reporting the declaration, and invalid, thrown or timed-out resolutions stay Diagnostics
  (`composition.duration-invalid`, `render.page-error`) with no new code. The
  [authoring guide](docs/guide/authoring.md#metadata-from-props) shows the usage and the
  [decision](docs/contexts/core/adr/20261103-props-driven-metadata.accepted.md) records the
  resolution point.

- **`@kimuson/motion-kit/motion`.** The Pure Motion functions are importable from the package for the
  first time: `interpolate`, `keyframes`, `easing` (the cubic, exponential and Back families plus
  `cubicBezier`) and the stateless spring (`spring`, `springState`, `springSettleTime`, `retarget`),
  with the types `Easing`, `InterpolateOptions`, `Keyframe`, `Spring`, `SpringState` and
  `RetargetOptions`. Each function takes its time as an argument, holds nothing between calls and
  returns the shared `Result`, so an invalid range or a non-finite evaluation is a `Diagnostic`, not a
  throw. A built-artifact test imports the published subpath from `dist` and calls every function, and
  the [authoring guide](docs/guide/authoring.md#motion-values) shows the usage. The root entry does not
  re-export it, and `Animate`, `Reveal` and `Stagger` are separate work: `/motion` ships values only.
- **Fonts that CSS declares.** `useAsset({ kind: 'font-family', family, weight?, style?, text })`
  waits for the faces a stylesheet's `@font-face` rules provide for the text a frame renders, so a
  fontsource family split by `unicode-range` into dozens of subsets is captured only after the
  subsets that text needs are loaded, instead of drawing the system fallback. It returns the loaded
  `FontFace` objects and reports a family that no stylesheet declares for the text as
  `asset.load-failed`, naming the family. The subset URLs stay in the stylesheet.

## 0.2.1 — 2026-11-02

### Added

- **Browser preview.** `motion-kit preview <entry>` serves a page on loopback where you play, scrub
  and step a Composition in your own browser, with its declared audio (a per-source checkbox, ticked while audible and cleared to mute,
  remembered per project root for as long as the page's origin, and so its port, stays the same) and a timeline of its named Sequences and audio clips. Options:
  `--composition`, `--props`, `--preview-fps` (1 to 60, default 12), `--port`, `--project-root` and
  `--vite-config`. Readiness is the result: one envelope (`data: { format: 'preview', url }`) or the
  line `serving <url> (Ctrl-C to stop); ready`, then it runs until stopped, and a stop after readiness
  exits `0`. A source change reloads the Composition at the same frame (there is no HMR), and a Vite
  config change ends the preview with `render.page-error`. `PreviewDataSchema` and the `preview`
  command join the CLI output contract. The preview samples frames at a low rate and mixes audio in the
  browser, so it can differ from the `.mp4`.
- **The preview page.** The page has a side panel (dragged to resize, its width remembered) with
  tabs for the Composition, its named Sequences, Assets (the fonts and images the frame on screen
  loads with `useAsset`, with their status, above the audio sources), Elements (the DOM tree of
  the paused frame) and review comments, and a bottom panel with the transport and the timeline,
  resized by its handle. The page's own text is in English or Japanese, chosen in a settings
  popover and remembered, and otherwise taken from the browser's languages.
- **Review comments in the preview.** Comment mode (Comment or C) pauses playback and outlines the
  visible element under the pointer: the text whose glyphs are under it first, then what draws there,
  film-look overlays (blended or full-frame) and layout boxes last. Scrolling the wheel outlines the
  other elements under the pointer, and a click drafts a comment on the outlined one; a comment can
  also cover the whole frame or a range of frames. Copy Markdown puts every comment on the
  clipboard with its time, the named Sequences showing, the element with the `file:line:col` of its
  JSX in your project (`data-source`, added only in preview mode) and a `motion-kit frame` command
  that renders the frame. Comments are kept in `localStorage` per project root and entry.
- **Named Sequences.** `Sequence` and `TransitionScene` accept an optional `name`. Named ancestors
  form a path, and the runtime reports each mounted named Sequence as the frames it is visible in,
  so a host such as the preview can show and anchor on shots instead of bare frame numbers.
  Rendering is unchanged.
- **Three.js canvas.** `@kimuson/motion-kit/three` exports `ThreeCanvas` and `CameraRig`. A canvas
  opens R3F with `frameloop="never"`, a stopped clock, DPR 1 and a preserved drawing buffer, and is
  advanced once per settled frame from motion-kit time; the frame is captured only after the scene has
  committed that frame's generation and the GPU has finished. `CameraRig` writes an absolute camera
  pose from `useTime()` on every frame, so seeking backwards reproduces a fresh pose instead of
  carrying history. `three` and `@react-three/fiber` are optional peer dependencies the user installs,
  and the package root never loads them. A canvas with any `useFrame` subscriber is Tier C: it renders
  but reports `seek.uncontrolled`, and the determinism suite refuses to certify it.
- **`Seekability` is reportable lazily.** `IntegrationRegistration['seekability']` accepts
  `'A' | 'B' | 'C'` or a getter, evaluated when a host asks for warnings, so an integration can report
  a capability it discovers after mounting without re-registering. The type is exported as
  `Seekability`.
- **The determinism suite can opt into software WebGL.** A `DeterminismComposition` accepts
  `softwareWebGL: true`, which the suite forwards to its renderers. The suite lives in the repository
  (`pnpm test --project frame-transport`) and is not a package export, so both the option and
  `DeterminismComposition` are repository-only.
- **[Three.js guide](docs/guide/three.md)** documents the subpath, the peer dependencies, software
  WebGL (`--software-webgl`) and what makes a canvas uncontrolled. A `three-dom` Vitest project covers
  the canvas in Chromium with SwiftShader, and CI runs it as its own step.

### Changed

- **`Composition` accepts `frameChange`.** `'live'` (the default, what the renderer uses) commits
  each frame as soon as it is published; `'held'` keeps the committed frame on screen until the next
  one can commit, so a host that shows the live page does not flash a Suspense fallback while assets
  load. The type is exported as `FrameChange`.
- **A Three.js frame fails when its shader cannot compile.** `ThreeCanvas` hooks
  `renderer.debug.onShaderError`, so a `shaderMaterial` that does not compile or link fails the frame
  with `render.page-error` — and every later frame of that canvas — instead of publishing a scene the
  material was missing from. The page console then carries a reprint of the program and shader info
  logs without the material name, so a Composition with several shader materials has to identify the
  failing one itself. That is a behaviour change for a Composition with a broken shader: it
  used to render with a console log and no material. Which advanced three behaviour is qualified, and
  which stays excluded (damped controls, physics, temporal feedback, WebGPU, XR, context recovery), is
  recorded in the [three qualification
  ADR](docs/contexts/three/adr/20261031-three-advanced-qualification.accepted.md); the [Three.js
  guide](docs/guide/three.md) lists what to use instead of each excluded item.

### Fixed

- **A cancelled render into a reused directory no longer leaves a stale frames manifest.** The
  previous `frames.json` written by motion-kit is removed before the first new PNG, so partial
  frames never sit beside a completion receipt; a JSON file of your own is left untouched.
- **`encode.ffmpeg-failed` gives a truthful hint.** It names the Composition, target path and
  environment causes, and suggests a retry only when the failure looks transient (such as
  `Cannot allocate memory` while muxing).
- **A frame's registered assets no longer include Sequences it stopped rendering.** Asset readiness
  leaves out the owners of renders cut off before they committed, and `useAsset` releases its
  assets as the owner unmounts.

## 0.2.0 — 2026-10-29

### Added

- **Composition determinism checker.** `motion-kit check <entry> --frame <n>` captures sampled
  frames after a fresh (`cold`) capture and after warm `after-earlier`, `after-later` and `pool`
  histories, then compares every warm capture against the cold reference. `--predecessor` and
  `--history` select the histories explicitly, `--exact` compares PNG bytes, and the default compares
  decoded pixels within `--channel-tolerance` 32 and `--changed-ratio` 0.002. Failures are
  `check.frame-differs`, `check.history-not-run` and `check.uncontrolled-time`, with a `check`
  envelope that names every sample, history and difference. The command writes no artifact, and a
  pass is evidence only for the sampled frames, settings and environment. `checkComposition` exports
  the same engine from `@kimuson/motion-kit/render`. The [determinism guide](docs/guide/determinism.md#check-your-own-composition)
  documents the workflow, the layout-measurement failure it detects, and its limits.
- **Renderer configuration from the CLI.** `render`, `frame` and `check` accept `--project-root`,
  `--vite-config`, `--software-webgl` and `--disable-sandbox` (or the `MOTION_KIT_*` environment
  variables), so a project can be rendered without relying on the working directory.
- **Several stills in one invocation.** `frame --frame 1,30,60 --out out/stills` writes one PNG per
  frame and reports a `png-sequence` payload instead of a single `png` one.
- **MP4 size controls.** `render --out out.mp4` accepts `--scale <factor-or-WxH>` and
  `--fps <rational-or-decimal>` to downscale or resample the encoded output, alongside
  `--video-crf` and `--video-bitrate`.

## 0.1.0 — 2026-10-29

### Added

- **`motion-kit docs`.** The CLI prints the guide that ships in the package: `docs [topic]` prints
  `docs/index.md` or `docs/guide/<topic>.md` verbatim, `--list` names the seven topics, and `--json`
  returns the same content as a `command: "docs"` envelope. `--help` now lists the three commands
  with examples and points at `motion-kit docs`.

## 0.0.2 — 2026-10-29

A patch release with no API or behaviour change.

### Fixed

- **`bin` target.** The manifest names the CLI as `dist/cli.js` instead of `./dist/cli.js`. npm
  normalises the leading `./` at publish time and reports the result as
  `"bin[motion-kit]" script name dist/cli.js was invalid and removed`, which reads like the bin was
  dropped; the published entry point is the same either way.

## 0.0.1 — 2026-10-29

The first public release. Everything below is new: no earlier release exists, so nothing here
has a predecessor it must stay compatible with.

### Added

- **Renderer.** `createRenderer` and `createRendererPool` from `@kimuson/motion-kit/render` load a
  Composition registry into Chromium through Playwright, wait for a readiness barrier rather than a
  timer, and capture frames as PNG or JPEG. A pool opens `concurrency` renderers and deals frames
  round-robin while returning them in frame order.
- **CLI.** `motion-kit render` and `motion-kit frame` (`dist/cli.js`, bin name `motion-kit`) run a
  Composition out of an entry file. `render --out out.mp4` encodes video, any other `--out` writes a
  PNG frame sequence plus `manifest.json`, and `frame --frame <n> --out still.png` captures one still.
  `--json` prints one versioned envelope with stable diagnostic codes; exit codes separate success
  (`0`), domain failure (`1`), invocation error (`2`) and internal failure (`3`), and a cancelled run
  exits `130`/`143`/`129` without an envelope.
- **MP4 + AAC.** The `.mp4` route encodes H.264 in MP4 with the system FFmpeg 6.0+ (`libx264`), and
  muxes the audio a Composition declares as data: frame-positioned clips mixed to one 48 kHz stereo
  AAC stream that ends with the Composition.
- **Determinism suite.** Eight traversal modes (sequential, random, reverse, repeated, fresh realm,
  held session, fresh renderer, concurrent) compare exact PNG bytes against a sequential baseline.
  The suite lives in the repository (`pnpm test --project frame-transport`) and is not a package
  export in this release.
- **Reference examples.** `examples/teaser`, `examples/explainer`, `examples/chart` and
  `examples/slideshow` are four complete videos with CI gates, documented in
  [the examples guide](docs/guide/examples.md). They ship in the repository: the package carries
  `dist/`, the user documentation, `README.md`, `LICENSE` and `THIRD_PARTY_LICENSES.md`.
- **Attested release.** `0.0.1` is published from the `v0.0.1` tag by
  `.github/workflows/release.yml` with npm Trusted Publishing, so the tarball carries a provenance
  attestation that binds it to this repository and that workflow run
  (`npm view @kimuson/motion-kit@0.0.1 dist.attestations`). No npm token exists for the project; the
  earlier `0.0.0` was published by hand and has no attestation.

### Known limitations

- **Placeholder examples.** The reference examples render generated placeholders by default: the
  slideshow's photos are FFmpeg `gradients`/`noise` stills, the explainer draws badge characters
  unless the local media exist, and the chart's datasets are synthetic series shaped like an index.
  Each example's README states what is a placeholder and what is not.
- **Local-only narration.** The explainer's VOICEVOX voice clips and portraits, and the music bed,
  are generated into a gitignored `assets.local/` by a script that needs a locally installed engine.
  Nothing in the package fetches, bundles or ships them, and no hosted voice service is used.
- **Not in this release.** The preview UI, the `/motion`, `/theme`, `/presets` and `/three` subpaths,
  `inspect` and `validate`, video assets, and audio in preview are later phases. The
  [package surface](README.md#package-surface) lists what is exported today.
