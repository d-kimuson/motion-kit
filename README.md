# motion-kit

An agent-first framework for programmatic video. Scenes are React/TSX components on a
deterministic timeline, every frame is a pure function of time, and the render pipeline
captures frames in Chromium through Playwright and encodes them with FFmpeg. A CLI and
structured diagnostics let a coding agent render a Composition and read any failure without a
GUI. motion-kit is an MIT alternative to Remotion, named `@kimuson/motion-kit`.

## Status

Phase 0 spikes and the Phase 1 renderer, CLI and MP4 encoder exist on `main`, and a Composition
may declare audio tracks that the `.mp4` route muxes onto the same timeline. There is no
release yet, so the package is not on a registry and the commands below run from a checkout of
this repository.

Pending: reference examples, in-browser preview audio, audio-reactive visuals and Linux
qualification. The planned contexts and their subpath exports are in [the context
map](docs/CONTEXT-MAP.md); the Phase 0 browser experiments stay separate from the framework,
each with its own README and `pnpm spike:*` script under `spikes/<name>/`.

## Getting started

A project's entry file exports a `compositions` registry; every import below ships from the
package root today:

```tsx
// entry.tsx
import { defineComposition, defineCompositions, useFrame } from '@kimuson/motion-kit';
import { z } from 'zod';

const Scene = () => <div style={{ fontSize: 96 }}>frame {useFrame()}</div>;

export const compositions = defineCompositions([
  defineComposition({
    id: 'hello',
    component: Scene,
    schema: z.object({}),
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 150,
  }),
]);
```

`durationInFrames` and a rational `fps` fix the timeline; props come from the `zod` schema, so
the project installs `zod` for itself.

Audio is the Composition's own data, declared next to the frames as an optional `audio` array
of clips. Times are frame counts, not seconds, so the render places each clip through the same
timeline the frames use:

```tsx
defineComposition({
  // …id, component, schema, width, height, fps, durationInFrames
  audio: [
    { src: 'audio/voice.wav', startInFrames: 30 },
    { src: 'audio/music.mp3', endInFrames: 150, volume: 0.25 },
  ],
});
```

`src` resolves against the directory the CLI runs in (an absolute path is used as given),
`startInFrames` is where the clip begins on the timeline (default `0`), `endInFrames` stops it
later, `offsetInFrames` trims its head, and `volume` is a linear gain (default `1`). All clips
are mixed into one 48 kHz stereo AAC stream inside the same FFmpeg invocation that encodes the
frames, and the stream ends with the Composition rather than with the longest clip
([audio muxing decision](docs/contexts/render/adr/20261026-audio-track-muxing.accepted.md)).
Audio plays in the rendered file only: preview has no sound yet.

In a checkout of this repository, build once and render that entry to an MP4:

```bash
pnpm install
pnpm build
node dist/cli.js render entry.tsx --out out.mp4
```

Rendering needs a Chromium that Playwright can launch
(`pnpm exec playwright install chromium`), and an `.mp4` target also needs FFmpeg on `PATH`
(see [CLI](#cli)).

## CLI

The `motion-kit` bin renders Compositions from a registry entry file. Both commands accept
`--json`, which writes exactly one
[versioned envelope](docs/contexts/agent/adr/20261024-cli-output-contract.accepted.md) to
stdout; without it, the same data is printed as a short human summary. `node dist/cli.js` in
[Getting started](#getting-started) is this bin, run from a checkout.

```bash
# Capture one frame as a PNG.
motion-kit frame <entry> [--composition <id>] --frame <n> --out <png> [--json]

# Render a whole Composition: an .mp4 target is encoded video, any other target is PNG frames.
motion-kit render <entry> [--composition <id>] --out <file.mp4 | dir> [--props <json>] [--json]
```

`--composition` may be omitted only when the registry exports exactly one Composition;
otherwise the command fails with `cli.invalid-arguments` naming the available ids. End to end,
`motion-kit render entry.tsx --out out.mp4` renders the registry in `entry.tsx` and writes the
encoded video to `out.mp4`.

`--out` selects the format: an `.mp4` file is encoded H.264, and any other target is a
directory of PNG frames plus a `manifest.json`, reported as `"format": "frames"` in `data`.
There is no `--format` flag. Encoding needs an FFmpeg 6.0+ with `libx264` on `PATH`: motion-kit
ships and downloads no binary, so this is a prerequisite you install yourself
([encoding decision](docs/contexts/render/adr/20261025-system-ffmpeg-encoder.accepted.md)). A
missing or unsupported FFmpeg is `encode.ffmpeg-not-found` or `encode.ffmpeg-unsupported`
before the first frame; `frame` and an `--out` directory need no FFmpeg at all.

Audio has no flag either: the `.mp4` route muxes whatever the Composition declares in `audio`,
resolving each `src` against the directory the command runs in. A declared file that is not
readable is `asset.load-failed` with the file in `location`, reported before FFmpeg starts and
with no output written, and a Composition that declares no audio renders exactly as it did
before audio existed.

Exit codes: `0` success, `1` domain failure (e.g. invalid props), `2` invocation error (e.g.
missing entry or unknown id), `3` unexpected internal error. Failures are always Diagnostics in
the envelope. Under `--json` stdout carries one JSON document even for an unusable invocation;
`command` is the subcommand argv named, or `null` when it named none. A run you cancel emits no
envelope: it writes one line to stderr and exits `130` (`SIGINT`), `143` (`SIGTERM`) or `129`
(`SIGHUP`).

## Package surface

Each context gets its own subpath, with `core` as the package root, and the browser bootstrap
gets `/browser`; only the three below are exported today:

- `@kimuson/motion-kit` — the authoring surface: `defineComposition`, `defineCompositions`, the
  timeline hooks (`useFrame`, `useTime`), `Sequence`, `TransitionSeries`, `useAsset`.
- `@kimuson/motion-kit/render` — `createRenderer` and its types; Node only.
- `@kimuson/motion-kit/agent` — the CLI output envelope schemas.

`/browser`, `/motion`, `/theme`, `/presets` and `/three` are planned and do not exist yet; [the
context map](docs/CONTEXT-MAP.md) says what each will hold.

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

CI runs `pnpm lint`, `pnpm typecheck`, `lake build` and `pnpm test`. The render tests need a
Chromium (`pnpm exec playwright install chromium`), and the encoding and CLI tests also need
FFmpeg and `ffprobe` on `PATH`.

## License

MIT
