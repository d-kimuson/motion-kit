# Getting started

motion-kit turns a React component tree into a video file. The tree is an ordinary React/TSX
component; the timeline is a frame count, and every frame is captured from Chromium at the moment
the Composition says it is. A CLI renders the result to an MP4 (or to a directory of PNG frames) and
reports what happened as one JSON document when you pass `--json`.

This page takes you from an empty directory to a rendered file, then to a still and to a props
override. It assumes no other motion-kit context: every command below is complete.

## Requirements

| Requirement              | Why                                                                                      | Check                                   |
| ------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| Node.js                  | Runs the CLI and the renderer's Node side. ESM only; the repository develops on Node 26. | `node --version`                        |
| React 19, ReactDOM 19    | Peer dependencies of the package; the Composition is your React tree.                    | `npm ls react`                          |
| Zod                      | Composition props are validated by a Zod schema that lives in your project.              | covered by the install below            |
| FFmpeg 6.0+ with libx264 | Encodes MP4 and provides `ffprobe`, which a Composition that declares audio also needs.  | `ffmpeg -version`                       |
| Chromium for Playwright  | Captures the frames.                                                                     | `pnpm exec playwright install chromium` |

FFmpeg is the one prerequisite motion-kit does not install for you: it ships and downloads no binary.
The PNG frame route and `frame` need no FFmpeg at all, so you can start without it and install it
when you want an `.mp4`.

```bash
ffmpeg -version | head -1                 # needs 6.0 or newer
ffmpeg -hide_banner -encoders | grep libx264
which ffprobe                             # ships with the same FFmpeg install
```

Install FFmpeg with the package manager of your OS — `brew install ffmpeg` (macOS),
`sudo apt install ffmpeg` (Debian/Ubuntu), `sudo dnf install ffmpeg` (Fedora, RPM Fusion),
`sudo pacman -S ffmpeg` (Arch), `winget install --id Gyan.FFmpeg` (Windows) — or from
<https://ffmpeg.org/download.html>.

## Install

```bash
mkdir hello-video && cd hello-video
pnpm init
pnpm add @kimuson/motion-kit react react-dom zod
pnpm exec playwright install chromium      # once per machine; downloads the Chromium build
```

The same three packages with npm or yarn:

```bash
npm install @kimuson/motion-kit react react-dom zod
npx playwright install chromium

yarn add @kimuson/motion-kit react react-dom zod
yarn playwright install chromium
```

`@kimuson/motion-kit` is ESM only. The Chromium download is per machine rather than per project, so
the `playwright install` step is a one-time setup, not part of every install.

## Write an entry file

An **entry file** exports a `compositions` registry. Every Composition in it is a React component
plus the metadata the renderer needs: an id, a size, a frame rate and a duration in frames.

```tsx
// entry.tsx
import { defineComposition, defineCompositions, useFrame } from '@kimuson/motion-kit';
import { z } from 'zod';

const props = z.object({
  title: z.string().default('Hello from motion-kit'),
});

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

Three things about this file are not optional:

- `fps` is a rational object, not a number: `{ numerator: 30, denominator: 1 }` for 30 fps, or
  `{ numerator: 30000, denominator: 1001 }` for 29.97.
- The duration is `durationInFrames`, never a `duration` in seconds. A Composition that declares
  `duration` fails to load with `render.page-error`.
- `defineComposition` returns a `Result`, so the array you hand to `defineCompositions` holds
  results rather than definitions. A declaration error (a duplicate id, an invalid `fps`, an
  invalid audio declaration) therefore surfaces when the registry loads, not later.

## Render an MP4

```bash
pnpm exec motion-kit render entry.tsx --out out.mp4
```

```text
encoded 150 frames to /Users/kaito/hello-video/out.mp4 (1920x1080) in 6212.9ms
```

`--out` picks the format: a path ending in `.mp4` is encoded H.264 video, and any other path is a
directory of PNG frames. There is no `--format` flag. The path in the summary is absolute, which is
the path to open.

Two Compositions in one entry and no `--composition` is an error — the CLI cannot guess which one to
render — so pass `--composition hello` as soon as the registry holds more than one.

## Capture a still

```bash
pnpm exec motion-kit frame entry.tsx --frame 60 --out still.png
```

```text
captured frame 60 to /Users/kaito/hello-video/still.png (1920x1080) in 962.6ms
```

`frame` captures exactly one frame and needs neither FFmpeg nor a video target. It writes only the
file, so the directory must already exist (`mkdir -p out` before `--out out/still.png`); `render`
creates the directories its output needs.

## Read the result as JSON

Add `--json` to any command and stdout carries one versioned envelope and nothing else:

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

The envelope is the same for a failure — `ok: false`, `data: null`, and at least one Diagnostic with
a stable `code` — so a script branches on `ok` and on `code`, never on human text. A cancelled run is
the one case without an envelope: it exits `130`, `143` or `129` and writes one line to stderr. The
[CLI reference](cli.md) has the full field table, the codes and the exit codes.

## Change props without editing the entry

Props are ordinary Zod-validated values, and `render` takes a JSON object to override them:

```bash
pnpm exec motion-kit render entry.tsx --props '{"title":"Ship it"}' --out out.mp4 --json
```

The value must be a JSON **object** string — `--props '{"title":"Ship it"}'`, not `--props 'ship'` —
and it is validated by the Composition's schema before the first frame, so a wrong shape fails with
`composition.props-invalid`, the failing path in `details.issues`, and no output file. `frame` accepts
the same `--props` flag; without it, a still draws the schema's defaults.

## Write frames instead of video

```bash
pnpm exec motion-kit render entry.tsx --out out/frames --json
```

```bash
ls out/frames | head -3
# frame-00000.png
# frame-00001.png
# frame-00002.png
```

That route writes `frame-00000.png`, `frame-00001.png`, … plus a `manifest.json` describing the
sequence, and reports `"format": "frames"` with the manifest's absolute path in `data`. It needs no
FFmpeg, which makes it the route to use while you are still installing or debugging the encoder.

## Where paths resolve

The CLI's project root is the directory you run it in (`process.cwd()`):

- the entry path is resolved against it, so run the command from the project root;
- `--out` is resolved against it, and the printed path is absolute;
- a Composition's `audio[].src` is resolved against it, and an absolute path is used as given;
- `useAsset({ kind: 'font' | 'image', source })` takes a **root-relative URL** such as
  `/assets/logo.png`, resolved by the page against the same project root — never a JavaScript import
  of the file.

## Next steps

- [CLI reference](cli.md) — `render`, `frame` and `docs`, every flag, the envelope and the exit codes.
- [Authoring](authoring.md) — Composition, Sequence, TransitionSeries, hooks, `useAsset`, audio.
- [Determinism](determinism.md) — what "every frame is a pure function of time" guarantees, and
  what it does not.
- [Examples](examples.md) — four complete videos in the repository, with the commands that render
  them.
- [Troubleshooting](troubleshooting.md) — FFmpeg, Chromium, assets and the diagnostics each failure
  reports.
