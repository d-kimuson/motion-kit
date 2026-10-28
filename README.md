# motion-kit

An agent-first framework for programmatic video. Scenes are React/TSX components on a deterministic
timeline, every frame is a pure function of time, and the render pipeline captures frames in Chromium
through Playwright and encodes them with FFmpeg. A CLI and structured diagnostics let a coding agent
render a Composition and read any failure without a GUI. motion-kit is an MIT alternative to Remotion,
named `@kimuson/motion-kit`.

## Status

**0.0.1 is the first public release.** It ships the renderer, the CLI, H.264 MP4 encoding, AAC audio
muxing, and the determinism suite that keeps frame bytes independent of capture order. `CHANGELOG.md`
in the repository lists what is in it and what is known to be limited.

Not in 0.0.1: the preview UI, in-browser preview audio, audio-reactive visuals, video assets, the
`/motion`, `/theme`, `/presets` and `/three` subpaths, and the `inspect`/`validate` commands. The
[package surface](#package-surface) says what is exported today; each later context gets its own
subpath when it lands.

## Install

```bash
pnpm add @kimuson/motion-kit react react-dom zod
pnpm exec playwright install chromium         # once per machine
```

```bash
npm install @kimuson/motion-kit react react-dom zod && npx playwright install chromium
yarn add @kimuson/motion-kit react react-dom zod && yarn playwright install chromium
```

React 19 and ReactDOM 19 are peer dependencies of the package; Zod validates your Composition props in
your own project, so you install it explicitly. The Chromium download is a one-time setup per machine,
not part of every install.

**Prerequisites.** Node.js runs the CLI (the package is ESM only) and, for video output, an
**FFmpeg 6.0 or newer built with `libx264`** on `PATH`; a Composition that declares audio also needs
its companion `ffprobe`. motion-kit ships and downloads no binary, so FFmpeg is the one thing you
install yourself:

```bash
ffmpeg -version | head -1                     # needs 6.0 or newer
ffmpeg -hide_banner -encoders | grep libx264
```

`frame` and a frames render need no FFmpeg at all, so you can start before installing it. See
[troubleshooting](docs/guide/troubleshooting.md#ffmpeg) for per-OS installs and the codes a missing or
outdated binary produces.

## Five-minute quickstart

Write an entry file that exports a `compositions` registry:

```tsx
// entry.tsx
import { defineComposition, defineCompositions, useFrame } from '@kimuson/motion-kit';
import { z } from 'zod';

const props = z.object({ title: z.string().default('Hello from motion-kit') });

const Scene = ({ title }: z.infer<typeof props>) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'grid',
      placeItems: 'center',
      background: '#07080c',
      color: '#f8f8f8',
      fontFamily: 'system-ui, sans-serif',
      fontSize: 96,
    }}
  >
    <p style={{ margin: 0 }}>
      {title} · frame {useFrame()}
    </p>
  </div>
);

export const compositions = defineCompositions([
  defineComposition({
    id: 'hello',
    component: Scene,
    schema: props,
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 150,
  }),
]);
```

Render it to an MP4:

```bash
pnpm exec motion-kit render entry.tsx --out out.mp4
# encoded 150 frames to /Users/kaito/hello-video/out.mp4 (1920x1080) in 6212.9ms
```

Capture one still instead:

```bash
pnpm exec motion-kit frame entry.tsx --frame 60 --out still.png
# captured frame 60 to /Users/kaito/hello-video/still.png (1920x1080) in 962.6ms
```

Read the same run as one machine-readable envelope:

```bash
pnpm exec motion-kit render entry.tsx --out out.mp4 --json
```

```json
{
  "schemaVersion": 1,
  "command": "render",
  "ok": true,
  "data": {
    "output": "/Users/kaito/hello-video/out.mp4",
    "format": "mp4",
    "width": 1920,
    "height": 1080,
    "fps": { "numerator": 30, "denominator": 1 },
    "frameCount": 150,
    "durationSeconds": 5
  },
  "diagnostics": [],
  "durationMs": 6212.9
}
```

`--out` picks the format — an `.mp4` target is encoded video, any other target is a directory of PNG
frames plus a `manifest.json` — and there is no `--format` flag. A bad declaration or a failed render
is reported as a Diagnostic with a stable `code`, never as a stack trace. The full walkthrough,
including props overrides and where paths resolve, is [getting started](docs/guide/getting-started.md).

## Documentation

The guides ship inside the package as well as in the repository, so an installed copy reads them
without a network: start at `node_modules/@kimuson/motion-kit/docs/index.md`, and the guides it links
are the files under `node_modules/@kimuson/motion-kit/docs/guide/`.

| Document                                         | What it covers                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [Documentation index](docs/index.md)             | What motion-kit is, a five-minute quickstart, and the table of contents.                 |
| [Getting started](docs/guide/getting-started.md) | Requirements, install, a first entry, a first render, props, frames output.              |
| [CLI](docs/guide/cli.md)                         | Both commands, every flag, the `--json` envelope, diagnostics, exit codes, cancellation. |
| [Authoring](docs/guide/authoring.md)             | Composition, props, time hooks, `Sequence`, `TransitionSeries`, `useAsset`, audio.       |
| [Determinism](docs/guide/determinism.md)         | What a pure function of time guarantees, what breaks it, how to check your own video.    |
| [Examples](docs/guide/examples.md)               | The four reference videos, their commands, placeholders and asset policy.                |
| [Troubleshooting](docs/guide/troubleshooting.md) | FFmpeg, Chromium, assets, `render.page-error` and cancellation.                          |

## CLI

The `motion-kit` bin renders Compositions from a registry entry file. Both commands accept `--json`,
which writes exactly one versioned envelope (`schemaVersion: 1`) to stdout; without it, the same data
is printed as a short human summary.

```bash
# Capture one frame as a PNG.
motion-kit frame <entry> [--composition <id>] --frame <n> --out <png> [--json]

# Render a whole Composition: an .mp4 target is encoded video, any other target is PNG frames.
motion-kit render <entry> [--composition <id>] --out <file.mp4 | dir> [--props <json>] [--concurrency <n>] [--json]
```

`--composition` may be omitted only when the registry exports exactly one Composition; otherwise the
command fails with `cli.invalid-arguments` naming the available ids. `--props` is a JSON object string
validated by the Composition's Zod schema before the first frame, and `frame` has no `--props`.

`--out` selects the format: an `.mp4` file is encoded H.264, and any other target is a directory of
PNG frames plus a `manifest.json`, reported as `"format": "frames"` in `data`. There is no `--format`
flag.

`--concurrency` sets how many renderers capture frames at once, each a browser of its own; it defaults
to half the machine's cores and must be a positive integer. A frame's bytes do not depend on which
renderer captured it. The `.mp4` route captures JPEG (quality 95) rather than PNG, since the H.264
encode is lossy anyway; the directory route writes PNG.

Encoding needs an FFmpeg 6.0+ with `libx264` on `PATH` — and, for a Composition that declares audio,
its companion `ffprobe`, which the same install provides: motion-kit ships and downloads no binary, so
this is a prerequisite you install yourself. A missing or unsupported FFmpeg is
`encode.ffmpeg-not-found` or `encode.ffmpeg-unsupported` before the first frame; `frame` and an `--out`
directory need no FFmpeg at all.

Audio has no flag either: the `.mp4` route muxes whatever the Composition declares in `audio`,
resolving each `src` against the directory the command runs in. `volume: 1` is the file's own level,
mono and stereo alike. A declared file that is missing, is not a regular file, or cannot be opened for
reading is `asset.load-failed` with the file in `location`, reported before any frame is encoded and
with no output written, and a Composition that declares no audio renders exactly as it did before
audio existed. The declaration fields and the mixing rules are in
[authoring](docs/guide/authoring.md#audio).

Exit codes: `0` success, `1` domain failure (e.g. invalid props), `2` invocation error (e.g. missing
entry or unknown id), `3` unexpected internal error. Failures are always Diagnostics in the envelope.
Under `--json` stdout carries one JSON document even for an unusable invocation; `command` is the
subcommand argv named, or `null` when it named none. A run you cancel emits no envelope: it writes one
line to stderr and exits `130` (`SIGINT`), `143` (`SIGTERM`) or `129` (`SIGHUP`). The
[CLI reference](docs/guide/cli.md) has the full tables.

## Package surface

Each context gets its own subpath, with `core` as the package root; only the three below are exported
today:

- `@kimuson/motion-kit` — the authoring surface: `defineComposition`, `defineCompositions`, the
  timeline hooks (`useFrame`, `useTime`, `useSequence`, `useTimeline`), `Sequence`,
  `TransitionSeries`/`TransitionScene`/`Transition`/`useTransitionProgress`, `useAsset`, the Time
  Module functions and the Diagnostic types.
- `@kimuson/motion-kit/render` — `createRenderer`, `createRendererPool` and their types; Node only.
- `@kimuson/motion-kit/agent` — the CLI output envelope schemas.

`/browser`, `/motion`, `/theme`, `/presets` and `/three` are planned and do not exist yet; each gets
its own subpath when it lands.

## Determinism

A frame is a pure function of its index, and the renderer treats it that way: it seeks, waits for the
readiness barrier — never a timer — then captures. The repository's determinism suite compares exact
PNG bytes across eight traversal modes (sequential, random, reverse, repeated, fresh realm, held
session, fresh renderer, concurrent) in a fixed environment, and its `concurrent` mode is what lets
`render --concurrency` be safe. What that does not promise — byte equality across GPUs and platforms,
or trees broken by wall clocks, randomness, CSS animation or antialiased edges — is laid out in
[determinism](docs/guide/determinism.md).

## Examples

Four complete videos live under `examples/` in the repository: a 24-second teaser (dense motion), a
222-second explainer (long duration, subtitles against audio), a 20-second chart (schema-first props)
and a 30-second vertical slideshow (assets and aspect switching). They are consumers of the published
package and ship in the repository, not in the npm tarball; [the examples
guide](docs/guide/examples.md) has their commands and says which parts are placeholders.

## Development

```bash
pnpm install
pnpm fix        # oxlint --fix and oxfmt
pnpm lint       # oxlint, oxfmt --check, package checks, license allowlist, tsconfig, Lean specs
pnpm typecheck
pnpm test
pnpm build      # tsdown: dist/ for the published package and the CLI
lake build      # Lean specs under src/core (Lean version from lean-toolchain, via elan)
nix develop     # devShell from flake.nix: Node 26, pnpm, gitleaks, elan
```

CI runs `pnpm lint`, `pnpm typecheck`, `lake build` and `pnpm test`. The render tests need a Chromium
(`pnpm exec playwright install chromium`), and the encoding and CLI tests also need FFmpeg and
`ffprobe` on `PATH`. The Phase 0 browser experiments stay separate from the framework, each with its
own README and `pnpm spike:*` script under `spikes/<name>/`.

## License

MIT
