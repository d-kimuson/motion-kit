# motion-kit

motion-kit renders React/TSX components into video files. A **Composition** is an ordinary React
tree plus the metadata that fixes its timeline — a size, a frame rate and a duration in frames —
and each frame is captured from Chromium at the moment the timeline says it is. The `motion-kit`
CLI renders a Composition to an H.264 MP4 or to a directory of PNG frames, and reports what
happened as one JSON document, so a script or a coding agent can read a failure without a GUI.

The package is `@kimuson/motion-kit`: ESM only, MIT licensed, installable with any Node package
manager. A frame is a pure function of its index, which is what makes `--concurrency` change speed
rather than output.

This page is the entry point to the seven guides beside it in `docs/guide/`. It ships in the npm
package too, so an installed copy reads the same from
`node_modules/@kimuson/motion-kit/docs/index.md`.

## Requirements

- **Node.js** — runs the CLI and the renderer's Node side; the package is ESM only
  (`node --version`).
- **React 19 and ReactDOM 19** — peer dependencies; the Composition is your React tree
  (`npm ls react`).
- **three and @react-three/fiber** — optional peer dependencies, only for a Composition that imports
  `@kimuson/motion-kit/three` ([Three.js](guide/three.md)).
- **Zod** — Composition props are validated by a schema in your project, so you install it
  explicitly.
- **Chromium for Playwright** — captures the frames; `pnpm exec playwright install chromium`
  installs it once per machine.
- **FFmpeg 6.0+ with libx264** — encodes MP4 and provides `ffprobe` for a Composition that
  declares audio (`ffmpeg -version`).

FFmpeg is only needed for an `.mp4` target: `frame` and a frames render (`--out <dir>`) capture the
same pixels without it, so you can start before installing it. It is also the one thing motion-kit
does not install for you — it ships and downloads no binary. Install it with your OS's package
manager (`brew install ffmpeg`, `sudo apt install ffmpeg`, `sudo dnf install ffmpeg`,
`sudo pacman -S ffmpeg`, `winget install --id Gyan.FFmpeg`) or from
<https://ffmpeg.org/download.html>, and check it with:

```bash
ffmpeg -version | head -1                     # needs 6.0 or newer
ffmpeg -hide_banner -encoders | grep libx264
```

## Five-minute quickstart

```bash
mkdir hello-video && cd hello-video
pnpm init
pnpm add @kimuson/motion-kit react react-dom zod
pnpm exec playwright install chromium        # once per machine
```

The same three packages with npm or yarn, and the browser download that is a one-time setup per
machine rather than part of every install:

```bash
npm install @kimuson/motion-kit react react-dom zod && npx playwright install chromium
yarn add @kimuson/motion-kit react react-dom zod && yarn playwright install chromium
```

Write an entry file that exports a `compositions` registry — a React component plus an id, a size,
a frame rate and a duration in frames:

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
# encoded 150 frames to /Users/you/hello-video/out.mp4 (1920x1080) in 6212.9ms
```

Capture one still instead — `frame` writes only the file, so the directory must exist:

```bash
mkdir -p out
pnpm exec motion-kit frame entry.tsx --frame 60 --out out/still.png
# captured frame 60 to /Users/you/hello-video/out/still.png (1920x1080) in 962.6ms
```

Add `--json` to any command to get one versioned envelope on stdout instead of its text output:

```bash
pnpm exec motion-kit render entry.tsx --out out.mp4 --json
```

```json
{
  "schemaVersion": 1,
  "command": "render",
  "ok": true,
  "data": {
    "output": "/Users/you/hello-video/out.mp4",
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

Four things are worth knowing before the guides:

- `--out` picks the format. A path ending in `.mp4` is encoded video; any other path is a directory
  of `frame-00000.png`, `frame-00001.png`, … plus a `manifest.json`. There is no `--format` flag.
- `fps` is a rational object (`{ numerator: 30000, denominator: 1001 }` for 29.97), and the
  duration is `durationInFrames`, never a duration in seconds.
- `--composition <id>` is required as soon as the registry holds more than one Composition.
- A failure is a Diagnostic with a stable `code`, a `message` and a `hint`, never a stack trace.
  Exit codes are `0` success, `1` domain failure, `2` invocation error, `3` internal error; a
  cancelled run exits `130`/`143`/`129` and emits no envelope.

A Composition's `audio[].src`, its `--out` path and `useAsset({ source })` URLs all resolve against
the directory you run the command in, and `render` creates the directories its output needs.

`motion-kit docs` prints the guide that ships with the package; `motion-kit docs <topic>` prints one topic (`--list` names them).

## The guides

- [Getting started](guide/getting-started.md) — requirements, install, a first entry and render,
  props overrides, and the frames output.
- [CLI](guide/cli.md) — `render`, `frame`, `check` and `docs`, every flag, the `--json` envelope,
  diagnostic codes, exit codes and cancellation.
- [Authoring](guide/authoring.md) — Composition fields, props, the time hooks, `Sequence`,
  `TransitionSeries`, `useAsset` and audio.
- [Three.js](guide/three.md) — `ThreeCanvas` and `CameraRig`, the peer dependencies, software WebGL
  and what makes a canvas uncontrolled.
- [Determinism](guide/determinism.md) — what "a frame is a pure function of time" guarantees, what
  breaks it, and how to check your own Composition.
- [Examples](guide/examples.md) — the four reference videos, their commands, their placeholders and
  the asset policy.
- [Troubleshooting](guide/troubleshooting.md) — FFmpeg, Chromium, assets, `render.page-error` and
  cancellation, one section per code.

Where to start: read [getting started](guide/getting-started.md) once end to end, keep
[troubleshooting](guide/troubleshooting.md) open while you build, and read
[determinism](guide/determinism.md) before you trust a frame comparison.

## Package surface

Only four subpaths are exported in 0.0.1:

- `@kimuson/motion-kit` — the authoring surface: `defineComposition`, `defineCompositions`, the
  timeline hooks (`useFrame`, `useTime`, `useSequence`, `useTimeline`), `Sequence`,
  `TransitionSeries`/`TransitionScene`/`Transition`/`useTransitionProgress`, `useAsset`, the Time
  Module functions and the Diagnostic types.
- `@kimuson/motion-kit/render` — `createRenderer`, `createRendererPool`, `checkComposition` and their
  types; Node only.
- `@kimuson/motion-kit/agent` — the CLI output envelope schemas.
- `@kimuson/motion-kit/three` — `ThreeCanvas`, `CameraRig` and their types; `three` and
  `@react-three/fiber` are optional peer dependencies you install.

Not in 0.0.1: the preview UI, preview audio, audio-reactive visuals, video assets, the `/motion`,
`/theme` and `/presets` subpaths, and the `inspect`/`validate` commands. Motion is plain
arithmetic on `useTime()` and `useSequence()` until `/motion` lands, which is what the reference
examples do.

## License

MIT. The package also ships `THIRD_PARTY_LICENSES.md`, which reproduces the license texts and
attribution notices of its runtime dependencies.
