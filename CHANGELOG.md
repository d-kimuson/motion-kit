# Changelog

All notable changes to `@kimuson/motion-kit` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) from `1.0.0`.

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
