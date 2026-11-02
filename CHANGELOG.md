# Changelog

All notable changes to `@kimuson/motion-kit` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from `1.0.0`.

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
