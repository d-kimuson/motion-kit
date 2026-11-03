# CLI

`motion-kit` renders Compositions out of an entry file. It ships six commands today, `render`,
`frame`, `contact-sheet`, `check`, `preview` and `docs`, and all speak the same output contract:
without `--json` they print their
result as text, and with it exactly one versioned JSON envelope on stdout.

```text
motion-kit <command> [args]
```

For `render`, `frame`, `contact-sheet`, `check` and `preview`, the first argument is an entry file relative to the project root
(the directory you run the command in by default): a `.tsx`/`.ts` module that exports `compositions`
(see [authoring](authoring.md#the-registry)).

## Commands

```bash
# Whole Composition: an .mp4 target is encoded video, a .wav target the mixed audio alone, and any
# other target is a PNG directory.
motion-kit render <entry> [--composition <id>] --out <file.mp4 | file.wav | dir> \
  [--props <json>] [--concurrency <n>] [--verbose | --quiet] [--json]

# One frame as a PNG, or several stills in a directory.
motion-kit frame <entry> [--composition <id>] --frame <n[,n...]> --out <png | dir> \
  [--props <json>] [--verbose | --quiet] [--json]

# One PNG holding a grid of representative frames, each labelled with its frame and time.
motion-kit contact-sheet <entry> [--composition <id>] (--every <n> | --frame <n[,n...]>) \
  --out <file.png> [--columns <n>] [--tile-width <px>] [--from <bound>] [--to <bound>] \
  [--props <json>] [--verbose | --quiet] [--json]

# Sample frames after different capture histories and compare them.
motion-kit check <entry> [--composition <id>] --frame <n[,n...]> \
  [--predecessor <n[,n...]>] [--history <name[,name...]>] [--exact] \
  [--channel-tolerance <0-255>] [--changed-ratio <0..1>] [--props <json>] [--verbose | --quiet] [--json]

# A browser page to scrub, step and play a Composition with its audio; runs until stopped.
motion-kit preview <entry> [--composition <id>] [--props <json>] [--preview-fps <n>] [--port <n>] [--json]

# The guide, or one topic, printed verbatim.
motion-kit docs [topic] [--list] [--json]
```

`motion-kit docs` reads the guides that ship in the package, so an installed copy works without the
repository or a network. With no topic it prints `docs/index.md`; with a topic it prints that file
verbatim, without a pager, colour or reformatting. `--list` prints one topic per line, id and
summary. The topics and their order are `index`, `getting-started`, `cli`, `authoring`,
`three`, `determinism`, `examples`, `troubleshooting`; an unknown topic, or `--list` with a topic, is
`cli.invalid-arguments` (exit 2) with the topics in the hint.

`motion-kit` is the bin the package installs (`bin.motion-kit` → `dist/cli.js`), so with pnpm a
command is `pnpm exec motion-kit …`, with npm `npx motion-kit …`, and with yarn `yarn motion-kit …`.
Both that form and `node dist/cli.js …` appear below: the second is the same CLI run out of a
checkout of this repository, after `pnpm build`, which is how the commands in the `examples/`
directory of the repository are written.

## Renderer configuration

`render`, `frame`, `contact-sheet` and `check` accept these options. `preview` accepts only `--project-root` and `--vite-config` of them (see [`preview`](#preview)).

| Flag                   | Environment override         | Meaning                                                                                           |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `--project-root <dir>` | `MOTION_KIT_PROJECT_ROOT`    | Project root for entry loading and relative MP4 audio sources; defaults to the working directory. |
| `--vite-config <path>` | `MOTION_KIT_VITE_CONFIG`     | Explicit Vite config file; otherwise Vite discovers a config in the project root.                 |
| `--software-webgl`     | `MOTION_KIT_SOFTWARE_WEBGL`  | Opt into software WebGL; default off.                                                             |
| `--disable-sandbox`    | `MOTION_KIT_DISABLE_SANDBOX` | Explicitly disable the Chromium sandbox; default off.                                             |

Flags override environment values, which override defaults. Boolean environment values accept `1` or `true`, and `0`, `false` or empty; other values are `cli.invalid-arguments`. Relative configuration paths resolve against the working directory; the project root must exist as a directory and the Vite config as a file. The sandbox is never disabled automatically, including in containers.

```bash
MOTION_KIT_PROJECT_ROOT=./video MOTION_KIT_VITE_CONFIG=./ci/vite.config.ts \
  MOTION_KIT_SOFTWARE_WEBGL=1 MOTION_KIT_DISABLE_SANDBOX=1 \
  motion-kit render entry.tsx --out out.mp4 --json
```

Only disable the sandbox when the CI environment requires that explicit security trade-off.

## Progress and logs

`render`, `frame`, `contact-sheet` and `check` run a Composition in a browser, and everything those
processes print is
stderr's business — stdout carries only your result. A run therefore reports three separate things
there: its Diagnostics, the progress of a long `render`, and — only when something goes wrong — the
last lines the page and the loading service said. (The Progress column is `render`'s alone: the
sheet's captures are few enough to need no count.)

| Flag        | While the command runs                | After a failure                         | Progress |
| ----------- | ------------------------------------- | --------------------------------------- | -------- |
| _(default)_ | nothing of the page or service output | the last 20 lines, under `renderer log` | shown    |
| `--verbose` | every line, as it arrives             | nothing further (already shown)         | shown    |
| `--quiet`   | nothing                               | nothing                                 | hidden   |

`--verbose` and `--quiet` together are `cli.invalid-arguments` (exit 2). Environment notices —
Chromium's WebGL and driver lines, the development server's handshake, react-dom's hint, the bin's
own Node warning — are never part of the failure block, because they say nothing about the
Composition that failed. Everything else the page logged is, in arrival order:

```text
renderer log (1 line; --verbose streams it as it arrives):
  Error: props.text is missing
```

`preview` keeps printing the page's console: the person watching a page is the one who wants it.

### Render progress

`render` reports completed frames out of the artifact's total on stderr, with an estimate of the
remainder:

```text
rendering 120/300 frames (40%) ETA 12s
```

The total is `data.frameCount` — the range's length for `--from`/`--to`, and with `--fps` the
encoder's output frame count — and the completed count is the sum over the `--concurrency`
renderers. On a terminal the line is rewritten in place, at most every 100 ms, erasing the rest of
the row so a shorter line leaves nothing behind; when stderr is not a terminal (a pipe, a
background job, an agent's capture) one whole line is written per 10% of the total, so a captured
log stays readable. The estimate divides the remaining frames by the rate of the last three
seconds, so a burst of pooled captures does not set the pace; it appears once there is enough of a
window to compute it, and it is `--quiet`'s to hide.

```bash
motion-kit render entry.tsx --out out/teaser.mp4 --json 2> render.log
```

## `render`

| Option               | Meaning                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--composition <id>` | Which Composition to render. Required when the registry holds more than one; otherwise optional.                                     |
| `--out <path>`       | Where to write. `.mp4` encodes H.264 video, `.wav` exports the mixed audio alone; any other path is a PNG frame directory. Required. |
| `--props <json>`     | Props object as a JSON string, validated by the Composition's Zod schema before the first frame.                                     |
| `--concurrency <n>`  | How many renderers capture frames at once; each is its own browser. Positive integer, default half the cores.                        |
| `--from <bound>`     | Where to start: a Global Frame (`3600`), `mm:ss[.fff]` (`4:20`) or seconds (`260s`). Defaults to the start.                          |
| `--to <bound>`       | Exclusive end of the range, in the same notations. Defaults to the Composition end.                                                  |
| `--verbose`          | Stream the Composition's page console and the loading service's output as it arrives.                                                |
| `--quiet`            | Print neither the progress lines nor the renderer log.                                                                               |
| `--json`             | Print the one-line summary as a JSON envelope instead.                                                                               |

```bash
node dist/cli.js render examples/teaser/entry.tsx --composition teaser --out out/teaser.mp4 --json
```

### `--out` selects the format

There is no `--format` flag: the target's extension decides, and the envelope reports which happened.

- `--out out.mp4` — H.264 in MP4. The frames are captured as JPEG (quality 95) because the encode is
  lossy anyway, and the video is written to a temporary sibling that is renamed onto `out.mp4` only
  after a successful encode, so a failed or cancelled run leaves no partial file. Needs FFmpeg 6.0+
  with `libx264`, probed once per invocation before the first frame; a Composition that declares
  audio also needs `ffprobe` from the same install.
- `--out out.wav` — the Composition's declared audio mixed alone, as 48 kHz stereo 16-bit PCM. No
  frame is captured: one FFmpeg child runs the same filter graph the MP4's audio uses, so the file
  holds exactly the mix the video would carry and can be measured for loudness or fed to whisper.
  It still mounts the Composition once (that is where the resolved length and the declared clips
  live), so it takes seconds instead of a full render. Needs FFmpeg 6.0+ and `ffprobe`; `libx264`
  is not required, because no video is encoded. See [exporting the audio alone](#exporting-the-audio-alone).
- `--out out/frames` — every frame as `frame-00000.png`, `frame-00001.png`, … plus a `manifest.json`
  (`format`, `composition`, width, height, fps, frame count, the original timeline `range` and the
  file list). Needs no FFmpeg.

`render` creates the directories its output needs, and a path that refuses a write reports
`render.output-unwritable` (exit 1) rather than an internal failure.

A frame's bytes do not depend on which renderer captured it, so `--concurrency` changes speed, not
output. It defaults to half the machine's cores; raise it for a long video, lower it when memory or
GPU contention is the limit.

### Rendering part of a Composition

`--from` and `--to` write only that interval, so checking a fix near 4:20 does not re-encode the
whole video. Both bounds are optional — an omitted `--from` starts at 0 and an omitted `--to` runs
to the Composition end — and the notation says which unit it is:

| Written          | Meaning                           |
| ---------------- | --------------------------------- |
| `260`            | Global Frame 260                  |
| `260s`, `4.5s`   | seconds                           |
| `4:20`, `4:20.5` | minutes and seconds, seconds 0–59 |

A decimal without a unit (`4.5`) is rejected rather than guessed. The range is half-open and
rounded up at both ends: the output holds exactly the frames whose presentation time lies in
`[from, to)`, so no frame before `--from` and none at or after `--to`. The artifact is a new
zero-based video — its frame 0 is the range's first frame — and both routes accept the range: an
MP4 is encoded from those frames, and the frames route writes the same interval as
`frame-00000.png`, `frame-00001.png`, … plus a manifest whose `frameCount` and `range` describe it.
File n of either route is Composition frame `startFrame + n`, which `data.range` and the manifest's
`range` name on the original timeline.

```bash
motion-kit render entry.tsx --out out/fix.mp4 --from 4:20 --to 4:35 --json
```

Audio comes with the range and needs no flag: a clip already playing resumes where the range enters
it, a declared clip end is clipped to the range, and a clip outside it is not an input. A
Composition that declares audio keeps one audio stream in the artifact — silence where no declared
clip plays, including a range that overlaps none of them — so its stream layout matches the whole
render. Every declared `src` is still checked: one that cannot be read is `asset.load-failed` even
when the range drops its clip.

`--fps` counts the range, not the Composition: the output frame count is the ceiling of the range's
duration times the output rate, and `--scale`, `--video-crf` and `--video-bitrate` apply unchanged.
`data.frameCount` and `data.durationSeconds` describe the artifact, and `data.range` reports the
original timeline interval (below).

An unreadable bound is `cli.invalid-arguments` (exit 2) before a browser opens, and so is an empty
or reversed range whose two bounds are both frames or both times. The cases that need the
Composition — a mixed-unit empty range, or one outside it — are the same code and exit as soon as
the Composition's frame count is known, before any frame is captured or output written.

### MP4 size, quality and frame rate

These options apply only to `.mp4` output; using them with a frames directory is `cli.invalid-arguments` (exit 2).

- `--video-crf <n>` selects constant quality, an integer from 0 to 51, default 28. Lower values generally mean higher quality and larger files.
- `--video-bitrate <kbps>` requests a positive integer video bitrate in kilobits per second, instead of CRF. It cannot be combined with `--video-crf`.
- `--scale <factor|WxH>` resizes the encoded image, defaulting to the Composition dimensions. A factor such as `0.5` multiplies each viewport dimension and rounds it to the nearest integer; explicit dimensions use e.g. `1280x720`. Both resulting dimensions must be positive even integers. Lanczos scaling does not re-layout the Composition.
- `--fps <decimal|numerator/denominator>` selects a positive output rate no greater than the Composition rate, defaulting to that rate. For example, use `24`, `29.97`, or `30000/1001`.

Invalid values or combinations are `cli.invalid-arguments` (exit 2). For a reduced rate, each output frame samples the source frame containing its presentation time, rounded down. The output frame count is the ceiling of source duration times output rate; the last frame interval may cross the Composition's end. MP4 uses faststart for playback before the whole file is downloaded.

CRF controls quality, not target size; there is no hard target-size mode. To estimate size, multiply video bitrate by duration, add 192 kbps for audio when present, and allow for container overhead. Single-pass bitrate and overhead vary, so leave margin and check the resulting file.

For example, suppose a 60-second, 1920×1080 Composition with audio needs a roughly 10 MB Slack-sized deliverable (10,000,000 bytes). The total budget is `10,000,000 × 8 / 60 / 1000 ≈ 1,333 kbps`. Subtract `192 kbps` audio to get about `1,141 kbps` for video and overhead; choose `900 kbps` for margin. Scale to 720p:

```bash
motion-kit render entry.tsx --out video.mp4 --scale 1280x720 --video-bitrate 900
```

The estimate is `(900 + 192) × 1000 × 60 / 8 = 8,190,000 bytes`, plus container overhead. It is not a size guarantee; check the file against the recipient's actual limit.

### `--props`

```bash
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-20y.json)" --out out/chart.mp4 --json
```

The value must be a JSON object string. It is parsed, then validated and normalized by the
Composition's schema — defaults apply to fields you omit — and the resulting values are the
component's props. A non-object string is `cli.invalid-arguments` (exit 2); valid JSON that fails the
schema is `composition.props-invalid` (exit 1), with `details.issues` carrying the Zod issues and
their paths, and nothing is rendered. `frame` accepts the same `--props` object.

The same props also decide the metadata a Composition derives from them: a definition that declares
`resolveMetadata` reads the length, resolution or frame rate from the props
([metadata from props](authoring.md#metadata-from-props)), so a generated script can drive the whole
render through `--props` without writing anything into the entry. The resolved length is what the
commands use: `render` renders exactly that many frames, `frame` rejects a `--frame` at or past it
with `composition.props-invalid`, and `check` rejects the same sample the same way. A resolver that
fails is the command's failure before any output exists.

### Audio has no flag

The `.mp4` route muxes whatever the Composition declares in `audio`, resolving each `src` against the
project root. There is no `--audio`, `--mute` or gain option:
[audio is Composition data](authoring.md#audio). A declared file that is missing, is not a regular
file, or cannot be opened for reading is `asset.load-failed`, reported before any frame is encoded
and with no output written.

### Exporting the audio alone

An `--out` ending in `.wav` writes the Composition's mixed audio and nothing else, so a loudness
(RMS), balance or speech-recognition check does not pay for a full render:

```bash
motion-kit render entry.tsx --out out/mix.wav --json
motion-kit render entry.tsx --out out/fix.wav --from 4:20 --to 4:35 --json
```

The file is 48 kHz stereo signed 16-bit PCM, the same rate and channel count as the MP4's audio, so
the two are directly comparable. It is the encoder's own mix: the same filter graph, the same gains,
the same channel handling and the same frame-derived placement, with `--from`/`--to` clipping the
declared clips exactly as the video's audio clips them. A comparison between the WAV and the MP4's
decoded audio is therefore by level and waveform, not by bytes: the video's stream is 192 kbit/s
AAC, which is lossy. Because it captures no frame, a successful export reports no per-frame warnings
and its `diagnostics` is empty.

`--concurrency` does not apply (one realm is mounted and nothing is captured), and neither do
`--video-crf`, `--video-bitrate`, `--scale` or `--fps`; all five are `cli.invalid-arguments`
(exit 2) for a `.wav` target, decided before a browser opens. A Composition that declares no audio
is `render.no-audio` (exit 1) rather than a silent file, and a range that contains none of the
declared clips writes silence with `trackCount: 0` — the same thing the MP4's audio holds for that
range. Every declared `src` is still validated, so a missing file is `asset.load-failed` with no
output written.

## `frame`

| Option               | Meaning                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `--composition <id>` | Which Composition to capture. Required when the registry holds more than one.                   |
| `--frame <n>`        | Global frame indices, repeatable or comma-separated. Required.                                  |
| `--out <path>`       | A `.png` file for one frame; any other path is a directory for `frame-<n>.png` files. Required. |
| `--props <json>`     | JSON object validated by the Composition's schema.                                              |
| `--verbose`          | Stream the Composition's page console and the loading service's output as it arrives.           |
| `--quiet`            | Print no renderer log, including the one a failure would show.                                  |
| `--json`             | Print the envelope instead of the one-line summary.                                             |

```bash
motion-kit frame entry.tsx --frame 60 --out out/still.png
# captured frame 60 to /Users/kaito/hello-video/out/still.png (1920x1080) in 962.6ms
```

`frame` needs no FFmpeg and creates output directories as needed. `--out` is read from the path, not
from the number of frames: a target ending in `.png` is one PNG file, and every other target is a
directory, so `--frame 300,0 --frame 120 --out out/stills` writes `frame-00000.png`,
`frame-00120.png`, and `frame-00300.png` there, and a single `--frame 3 --out out/stills` writes
`frame-00003.png` into the same directory and reports that file as `data.output`. A `.png` target with
several frames, a `.png` target that is an existing directory, and a directory target that is an
existing file are `cli.invalid-arguments` (exit 2), decided before a browser opens. Duplicate,
negative, or non-integer indices are `cli.invalid-arguments` (exit 2). A frame index outside the
Composition is `composition.props-invalid` (exit 1, `location.frame` naming the request). Capture
stops at the first failure; PNGs already written remain.

## `contact-sheet`

`contact-sheet` writes one PNG holding a grid of representative frames, each labelled with its frame
number and presentation time. It is the middle of the three ways to look at a Composition: one
`frame` proves a single still, the sheet shows the whole flow — pacing, and how the layout changes
from scene to scene — in one image, and an MP4 costs the full render.

| Option               | Meaning                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--every <n>`        | One tile every `n` frames, from the region's first frame, always ending on its last frame. Positive integer.      |
| `--frame <n>`        | Explicit tile frames, repeatable or comma-separated; taken as written. Use this or `--every`, not both.           |
| `--out <file.png>`   | The PNG file to write. Required, and must end in `.png`: a sheet is one image, never a directory.                 |
| `--columns <n>`      | Tiles per row. Positive integer, default `4`, capped at the number of tiles.                                      |
| `--tile-width <px>`  | One tile's width in sheet pixels. Positive integer, default `320`; the tile keeps the Composition's aspect ratio. |
| `--from <bound>`     | First frame the sheet draws from, in the notation below. Defaults to the Composition start.                       |
| `--to <bound>`       | Exclusive end of the frames the sheet draws from. Defaults to the Composition end.                                |
| `--composition <id>` | Which Composition to sample. Required when the registry holds more than one.                                      |
| `--props <json>`     | JSON object validated by the Composition's schema, exactly as `frame` takes it.                                   |
| `--verbose`          | Stream the Composition's page console and the loading service's output as it arrives.                             |
| `--quiet`            | Print no renderer log, including the one a failure would show.                                                    |
| `--json`             | Print the envelope instead of the one-line summary.                                                               |

```bash
motion-kit contact-sheet entry.tsx --composition teaser --every 150 --out out/sheet.png
# wrote 6 frames to /abs/out/sheet.png (1320x432) in 4299.7ms
```

`--every` walks the region from its first frame in steps of `n` and always ends on the region's last
frame, so the sheet shows where the Composition starts and where it finishes; the last frame is not
drawn twice when the walk already landed on it. `--from`/`--to` take the same notations and mean the
same half-open interval as they do for `render`, so a section can be reviewed on its own:
`--from 4:20 --to 4:35 --every 30`.

One sheet holds at most 64 tiles, at most 16384 pixels on a side and at most 32 million pixels in
total — a resource bound on one screenshot, not a resolution the browser is asked to exceed. Every
limit is `cli.invalid-arguments` (exit 2) with a hint naming the option that fixes it, decided once
the Composition's length is known and before a frame is captured. Neither `--every` nor `--frame`, both of them, a step or column count that is not a
positive integer, an `--out` that is not a `.png` path, and an empty or reversed `--from`/`--to` are
the same code and exit before a browser opens. A `--frame` outside the Composition is
`composition.props-invalid` (exit 1, `location.frame`), as it is for `frame` and `check`; one inside
the Composition but outside the written `--from`/`--to` region is `cli.invalid-arguments`.

The image is written once, at the end: a failed or cancelled run leaves no partial sheet, and an
output path that refuses the write is `render.output-unwritable` (exit 1), like every other PNG the
CLI writes. The tiles are captured in ascending frame order through one renderer, so a sheet is a
pure function of the Composition, the frames it selected, the grid options and the Chromium build:
run it twice and the two files are byte-identical ([the contact-sheet ADR](../contexts/agent/adr/20261104-contact-sheet.accepted.md)
records how the grid is composited and why).

`data` is a strict `format: "contact-sheet"` object: the Composition id, the absolute `output` path,
the sheet's `width` and `height`, the grid (`columns`, `rows`), one tile's image area outside its
label strip (`tileWidth`, `tileHeight`), and `frames` — the tile list, ascending, each with its
`frame`, `timeSeconds` and 0-based `column`/`row`:

```json
{
  "schemaVersion": 1,
  "command": "contact-sheet",
  "ok": true,
  "data": {
    "format": "contact-sheet",
    "composition": "teaser",
    "output": "/abs/out/sheet.png",
    "width": 1320,
    "height": 432,
    "columns": 4,
    "rows": 2,
    "tileWidth": 320,
    "tileHeight": 180,
    "frames": [
      { "frame": 0, "timeSeconds": 0, "column": 0, "row": 0 },
      { "frame": 150, "timeSeconds": 5, "column": 1, "row": 0 },
      { "frame": 300, "timeSeconds": 10, "column": 2, "row": 0 },
      { "frame": 450, "timeSeconds": 15, "column": 3, "row": 0 },
      { "frame": 600, "timeSeconds": 20, "column": 0, "row": 1 },
      { "frame": 719, "timeSeconds": 23.96666666666667, "column": 1, "row": 1 }
    ]
  },
  "diagnostics": [],
  "durationMs": 5680.8
}
```

A capture warning (`seek.uncontrolled`, `layout.*`) is forwarded in `diagnostics` for the frame that
emitted it, exactly as `frame` reports it.

## `check`

`check` captures sampled frames after different capture histories and compares each warm capture
against a cold reference. It writes no artifact: the evidence is the envelope, and a passing run
exits `0` only when no capture differs. It uses the same entry loading, readiness barrier, props and
renderer configuration as `render` and `frame`.

| Option                        | Meaning                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `--frame <n>`                 | Global sample frame indices, repeatable or comma-separated. Required.                                                                           |
| `--predecessor <n>`           | Predecessor frames, repeatable or comma-separated. Replaces the default `f - 1`/`f + 1` list for every sample.                                  |
| `--history <name>`            | Capture histories: `cold`, `after-earlier`, `after-later`, `pool`, repeatable or comma-separated. Defaults to every history the inputs support. |
| `--exact`                     | Compare PNG bytes instead of decoded pixels. Conflicts with `--channel-tolerance` and `--changed-ratio`.                                        |
| `--channel-tolerance <0-255>` | Per-channel tolerance in pixels mode; a channel changed only when its absolute difference is greater. Default `32`.                             |
| `--changed-ratio <0..1>`      | Maximum changed-pixel ratio still within tolerance, inclusive. Default `0.002`.                                                                 |
| `--composition <id>`          | Which Composition to check. Required when the registry holds more than one.                                                                     |
| `--props <json>`              | JSON object validated by the Composition's schema.                                                                                              |
| `--verbose`                   | Stream the Composition's page console and the loading service's output as it arrives.                                                           |
| `--quiet`                     | Print no renderer log, including the one a failure would show.                                                                                  |
| `--json`                      | Print the envelope instead of the one-line summary.                                                                                             |

`cold` opens a fresh Renderer and captures the sample as its first frame; it is the reference every
other history is compared against. `after-earlier` and `after-later` each open a dedicated Renderer,
capture their predecessor, then the sample. `pool` captures the ascending window around the sample
through the run's single two-Renderer pool; its reported `predecessor` is the frame that pool
Renderer actually captured immediately before the sample (`null` when the sample was its first
capture), not necessarily the requested one. The default predecessors are `f - 1` and `f + 1`, kept
only when inside `[0, durationInFrames)`. A sample at frame `0` or at the last frame therefore has no
history on one side; requesting that history explicitly is `check.history-not-run` (exit `1`), not a
silent pass. Out-of-range sample or predecessor frames are reported once the frame count is known as
`composition.props-invalid` (exit `1`, `location.frame` naming the request).

The [determinism guide](determinism.md#check-your-own-composition) explains why these histories are
different evidence from two identical renders, and gives a long-video sampling recipe.

```bash
motion-kit check entry.tsx --composition traversal-fixed --frame 2,6
# checked 2 of 12 frames (2, 6) across 4 histories: passed in 8968.6ms
```

A failure writes the diagnostics and the summary to stderr. The same sampling of the dependent
fixture prints:

```text
error: check.frame-differs: A warm capture of frame 2 differs from its cold reference. — Make the frame a pure function of its time; a warm realm must not carry state into later frames.
error: check.frame-differs: A warm capture of frame 6 differs from its cold reference. — Make the frame a pure function of its time; a warm realm must not carry state into later frames.
checked 2 of 12 frames (2, 6) across 4 histories: frame 2 differs in after-earlier (8.3% of pixels) in 8780.8ms
```

`check`'s `data` is a strict `format: "check"` object. It carries the Composition id and descriptor,
the `comparison` actually used, and `samples` containing each sampled frame, its cold reference
dimensions and one entry per history (predecessor, dimensions, status and difference):

```json
{
  "schemaVersion": 1,
  "command": "check",
  "ok": true,
  "data": {
    "format": "check",
    "composition": "traversal-fixed",
    "width": 160,
    "height": 90,
    "fps": { "numerator": 30, "denominator": 1 },
    "frameCount": 12,
    "comparison": {
      "mode": "pixels",
      "channelTolerance": 32,
      "maxChangedRatio": 0.002,
      "alpha": "ignore"
    },
    "samples": [
      {
        "frame": 2,
        "width": 160,
        "height": 90,
        "histories": [
          {
            "history": "cold",
            "predecessor": null,
            "width": 160,
            "height": 90,
            "status": "reference",
            "difference": null
          },
          {
            "history": "after-earlier",
            "predecessor": 1,
            "width": 160,
            "height": 90,
            "status": "identical",
            "difference": {
              "mode": "pixels",
              "totalPixels": 14400,
              "changedPixels": 0,
              "changedRatio": 0,
              "maxChannelDelta": 0
            }
          }
        ]
      }
    ]
  },
  "diagnostics": [],
  "durationMs": 9183.8
}
```

A history's `status` is `reference` for `cold`, or `identical`, `within-tolerance` or `differs` for a
warm capture. In pixels mode `identical` means no compared pixel exceeded `channelTolerance`,
`within-tolerance` means some pixel did but `changedRatio` stayed within `maxChangedRatio`, and
`differs` means the tolerance was exceeded; a pixel-mode `identical` is therefore not byte identity.
In exact mode `identical` means the PNG bytes are equal. A history's `difference` is `null` only for
the reference; otherwise it is a union on `mode`:
`exact` (`differentBytes`, `referenceBytes`, `actualBytes`), `pixels` (`totalPixels`, `changedPixels`,
`changedRatio`, `maxChannelDelta`) or `dimensions`. Exact byte equality and tolerance-based equality
are different claims, and `comparison.mode` names the one that was used. There is no `passed` field:
a check passes iff the envelope is `ok: true`, and a failing check retains `data` so the caller can
read which sample and histories differed. `--exact` reports compressed-byte differences, not
perceptual ones; the default pixel comparison decodes both PNGs first.

The run costs one Renderer per cold sample, one per warm predecessor pair and two for the pool.
Sample a handful of frames rather than a whole video.

The three diagnostics `check` adds are errors:

| Code                      | Meaning                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `check.frame-differs`     | A warm capture differs from its cold reference. `location.frame` and `details.histories` name the sample, histories and difference. |
| `check.history-not-run`   | A requested history could not run, or the sample had no comparable capture. `details` carries `frame`, `history` and `reason`.      |
| `check.uncontrolled-time` | A capture emitted `seek.uncontrolled`, so the check refuses to certify it; the forwarded warning stays in `diagnostics`.            |

## `preview`

`preview` serves a browser page where you scrub, step and play a Composition with its declared audio and
a timeline of its named Sequences and audio clips. It renders nothing to disk, launches no browser (open
the printed URL in your own) and needs no FFmpeg. It runs until you stop it.

| Option                 | Meaning                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--composition <id>`   | Which Composition to open. Without it, a registry of one opens directly and a larger one shows a chooser in the page.                                            |
| `--props <json>`       | Props object as a JSON string. The CLI requires a JSON object; the page validates it against the Composition's schema and shows a failure there as a Diagnostic. |
| `--preview-fps <n>`    | Frames sampled per second while playing, an integer from 1 to 60, default 12. Scrubbing and stepping always show that frame.                                     |
| `--port <n>`           | Loopback port to listen on, 0 to 65535; default an ephemeral one. A port that is taken is `render.page-error`.                                                   |
| `--project-root <dir>` | As in [renderer configuration](#renderer-configuration); `--software-webgl` and `--disable-sandbox` do not apply.                                                |
| `--vite-config <path>` | As in [renderer configuration](#renderer-configuration).                                                                                                         |
| `--json`               | Print the readiness envelope instead of the line below.                                                                                                          |

```bash
motion-kit preview entry.tsx --composition teaser --preview-fps 15
# serving http://127.0.0.1:53124/__motion-kit/preview/?composition=teaser&fps=15 (Ctrl-C to stop); ready
```

The page controls: Space plays and pauses, the arrow keys step one frame (Shift: ten), the scrubber and a
click on the timeline seek. The keys work wherever the focus is on the page, including the scrubber; a focused button keeps Space for itself, a focused side panel tab keeps the arrow keys too, and a key with Alt, Ctrl or Cmd stays with the browser. The timecode shows `mm:ss.cc` and the frame number; when the picture is behind
the playhead (while paused, or by more than half a second while playing), `showing <n>` names the frame actually on screen. The playback controls stay in view
under the picture however long the timeline grows. Under the named Sequences, the timeline shows the audio clips. The line above the controls drags the bottom panel taller or shorter (the arrow keys move it once it is focused), and its height is kept for the next visit. The gear button at the end of the controls opens the settings, where the language select shows the page in English or Japanese (the select takes the arrow keys and Space while it is focused, and Escape closes the settings); the page starts in your browser's preferred language when it is one of them, and remembers the choice in `localStorage` for every project served on the same port (storage belongs to the page's origin). Copied review Markdown and error messages stay English, since they are meant for a coding agent. The side panel next to the picture is resized by dragging the line between them (or by the arrow keys once that line is focused), and its share of the window is kept for the next visit. It has five tabs: Info, with the Composition's size, frame rate and
duration; the named Sequences seen so far, where choosing one jumps to its start; Assets, with the fonts and images the frame on screen loads with `useAsset` (a failed or loading one is marked) and the audio sources; Elements, the DOM tree of the paused frame, where hovering an element outlines it on the picture and its button comments on it; and the review comments. Each declared audio source in Assets has a
speaker toggle, pressed while it is audible; releasing it mutes the source. The choice is remembered per project root in the browser's `localStorage`. Storage belongs to the page's origin, which includes the port, so the choice survives reloads but a restart on another port starts unmuted; pass the same `--port` to keep it. A source that cannot be
fetched or decoded is marked in the page and skipped.

To leave a note for a coding agent, press Comment (or C): playback pauses and the pointer outlines the visible element under it, text before the picture behind it and film-look overlays last; scroll the wheel to outline the other elements under the pointer, and click one to comment on it, or press Esc (or C again) to leave comment mode. "Comment on this frame" in the Comments tab comments on the whole frame instead. Seek before saving to make the comment cover a range of frames. Ctrl/Cmd+Enter saves the comment and Esc drops it. Each comment is marked on the timeline, and choosing its time seeks to it. Copy Markdown puts every comment on the Composition on the clipboard, each with its time, the named Sequences showing, the element (with the file and line of its JSX in your project) and a `motion-kit frame` command that renders the frame it is about (both ends of a range). A comment keeps the props the page was opened with, so its command renders the frame commented on even after a restart with other `--props`. Comments are kept in the browser's `localStorage` per project root and entry, so like the mute choice they stay with the port.

Saving a source file, or replacing an audio file the page plays, reloads the Composition in the page and keeps the playhead; there is no HMR, so
component state restarts. A change to the Vite config or its dependencies ends the preview with
`render.page-error` ("The Vite config vite.config.ts changed, so the preview stopped."). The timeline lists every top-level named Sequence from the start, and a nested one once
the playhead has been inside its parent, because the runtime reports a Sequence only while it is mounted.

The preview is for authoring, not for sign-off: it samples frames at a low rate, mixes audio with Web
Audio rather than FFmpeg, and may differ from the `.mp4` (WebGL implementation, mix). Check the render.

### Readiness is the result

`preview` is the one command that runs until it is stopped, so its result is the moment it is ready:

```json
{
  "schemaVersion": 1,
  "command": "preview",
  "ok": true,
  "data": {
    "format": "preview",
    "url": "http://127.0.0.1:53124/__motion-kit/preview/?composition=teaser"
  },
  "diagnostics": [],
  "durationMs": 1432.7
}
```

With `--json` that envelope is the whole of stdout, written once the page is being served; without it,
the line `serving <url> (Ctrl-C to stop); ready` is. Then the process serves until a stop signal:

- A stop after readiness (`Ctrl-C`, `SIGTERM`, `SIGHUP`) is the normal end: exit `0`, nothing more on
  stdout.
- A failure before readiness is the usual failure envelope: exit `1` for a Vite config or plugin failure
  or a taken `--port`, and `2` for an invocation error, which includes an entry that is not found.
- A stop before readiness is a cancellation as for every command: no envelope, the stderr line
  `preview aborted; nothing is being served`, exit `128` plus the signal number.
- A failure after readiness, such as a Vite config change, writes one line to stderr,
  `severity: code: message — hint`, and exits `1`. The envelope was already written, so there is no
  second document.

## The JSON envelope

`--json` writes exactly one JSON document to stdout, for successes and failures alike, and moves
human-facing logs to stderr. Every document has these fields:

| Field           | Type             | Meaning                                                                                                                                           |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `1`              | Bumped only for a breaking change to this contract.                                                                                               |
| `command`       | string, nullable | `render`, `frame`, `contact-sheet`, `check`, `preview`, `docs`, the reserved `inspect`/`validate`, or `null` when argv named no known subcommand. |
| `ok`            | boolean          | True if and only if no Diagnostic has severity `error`.                                                                                           |
| `data`          | object, nullable | Command-specific result; `null` when the command produced nothing usable.                                                                         |
| `diagnostics`   | array            | Zero or more Diagnostics, including warnings and infos on success.                                                                                |
| `durationMs`    | number           | Wall time of the command in milliseconds.                                                                                                         |

`render`'s `data` is a union on `format`:

```json
{
  "output": "/abs/out/teaser.mp4",
  "format": "mp4",
  "width": 1920,
  "height": 1080,
  "fps": { "numerator": 30, "denominator": 1 },
  "frameCount": 720,
  "durationSeconds": 24,
  "range": {
    "startFrame": 0,
    "endFrame": 720,
    "startSeconds": 0,
    "endSeconds": 24,
    "frameCount": 720
  }
}
```

```json
{
  "output": "/abs/out/teaser-frames",
  "format": "frames",
  "manifest": "/abs/out/teaser-frames/manifest.json",
  "width": 1920,
  "height": 1080,
  "fps": { "numerator": 30, "denominator": 1 },
  "frameCount": 450,
  "durationSeconds": 15,
  "range": {
    "startFrame": 7800,
    "endFrame": 8250,
    "startSeconds": 260,
    "endSeconds": 275,
    "frameCount": 450
  }
}
```

The `.wav` route reports the audio alone: no `width`, `height`, `fps` or `frameCount`, because the
artifact has no frames. `trackCount` is how many declared clips the range kept and mixed (zero means
the file is silence), and `range` is the same interval object:

```json
{
  "output": "/abs/out/mix.wav",
  "format": "wav",
  "sampleRate": 48000,
  "channels": 2,
  "bitDepth": 16,
  "durationSeconds": 15,
  "trackCount": 2,
  "range": {
    "startFrame": 7800,
    "endFrame": 8250,
    "startSeconds": 260,
    "endSeconds": 275,
    "frameCount": 450
  }
}
```

`frame`'s single-frame `data` is flat:

```json
{
  "output": "/abs/out/still.png",
  "format": "png",
  "frame": 60,
  "timeSeconds": 2,
  "width": 1920,
  "height": 1080
}
```

For multiple frames, `frame` reports `format: "png-sequence"`, an absolute directory `output`,
and `frames` containing the same per-frame fields except `format`, in ascending order.

`data` follows the frame count, not the `--out` target: one frame written into a directory still
reports `format: "png"`, with `output` naming the file it wrote inside that directory
(`/abs/out/stills/frame-00060.png`).

`docs`'s `data` is a union on `format`. A topic carries the file's text verbatim:

```json
{
  "format": "markdown",
  "topic": "cli",
  "content": "# CLI\n\n`motion-kit` renders…"
}
```

`--list` carries every topic in the documented order:

```json
{
  "format": "list",
  "topics": [
    { "id": "index", "summary": "Overview, requirements, quickstart, and the guide map." },
    { "id": "getting-started", "summary": "Install, write a first entry, and render it." }
  ]
}
```

FPS is always a rational, including integer rates. `range` is the Global Frame interval on the
Composition's timeline that the artifact covers: `startFrame` inclusive, `endFrame` exclusive,
`startSeconds`/`endSeconds` the Time Module's seconds for them, and `frameCount` the number of
Composition frames. It is always present — the whole Composition when neither `--from` nor `--to`
was given. `durationSeconds` is the artifact's duration from the Time Module, and `frameCount` is
the artifact's own count (the range's, or the ceiling of the range's duration times the output FPS
at a reduced rate, so `frameCount / fps` can be longer). A successful render is `ok: true` and may still
carry warnings; `ok: true` with warnings is a success, so branch on `ok`, not on an empty
`diagnostics`.

### Diagnostics

A failure is always represented as Diagnostics, never as free text:

```json
{
  "schemaVersion": 1,
  "command": "render",
  "ok": false,
  "data": null,
  "diagnostics": [
    {
      "code": "encode.ffmpeg-not-found",
      "severity": "error",
      "message": "The FFmpeg binary \"ffmpeg\" could not be run.",
      "hint": "Install FFmpeg with `brew install ffmpeg` and re-run.",
      "details": { "binary": "ffmpeg" }
    }
  ],
  "durationMs": 2159.3
}
```

Each Diagnostic has `code`, `severity` (`error`, `warning` or `info`), `message` (one sentence), a
`hint` (a corrective action; required for errors and warnings), and optional `location`
(`compositionId`, `file`, `line`, `frame`, `timeSeconds`, …) and `details`. The codes a run can
report today:

| Namespace     | Codes                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cli`         | `cli.invalid-arguments`, `cli.entry-not-found`, `cli.composition-not-found`                                                |
| `composition` | `composition.props-invalid`, `composition.duration-invalid`                                                                |
| `asset`       | `asset.load-failed`, `asset.not-ready`                                                                                     |
| `render`      | `render.browser-launch-failed`, `render.frame-timeout`, `render.page-error`, `render.output-unwritable`, `render.no-audio` |
| `encode`      | `encode.ffmpeg-not-found`, `encode.ffmpeg-unsupported`, `encode.ffmpeg-failed`, `encode.output-invalid`                    |
| `seek`        | `seek.uncontrolled` (a warning, emitted by an integration with uncontrolled time)                                          |
| `check`       | `check.frame-differs`, `check.history-not-run`, `check.uncontrolled-time`                                                  |
| `internal`    | `internal.unexpected`                                                                                                      |

`layout.*` (`layout.overflow`, `layout.out-of-frame`, `layout.unexpected-scroll`,
`layout.font-not-loaded`) is reserved for the later `inspect`/`validate` work and no command emits it
in 0.0.1. Adding a code is a compatible change; consumers must tolerate codes they do not know.

`render.output-unwritable` is the one domain code about your disk rather than your Composition: a PNG
frame, the frames `manifest`, the previous run's manifest, a contact sheet, or an output directory
could not be accessed. `location.file` and `details.output` name the path and `details.code` carries the errno
(`EISDIR`, `EACCES`, `ENOSPC`, …). It is exit `1`, not `3`: the output path is yours to fix.

`render.no-audio` is what `--out out.wav` reports for a Composition that declares no `audio`: there
is nothing to mix, so nothing is written — not the file and not the directory it would need — and
`location.compositionId` names the Composition. Declare the clips
([audio](authoring.md#audio)), or render an `.mp4` if the silence is intended.

## Exit codes

| Code  | Meaning                                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`   | Success; warnings and infos allowed. For `preview`, also a stop after it was ready.                                                                |
| `1`   | Domain failure: invalid props, an asset or page failure, a render or encode failure, a differing check, a `preview` that fails after it was ready. |
| `2`   | Invocation error: unknown flag, missing argument, entry not found, unknown Composition, no known subcommand.                                       |
| `3`   | Internal failure: a bug or an unconverted exception. The stack goes to stderr, never into JSON.                                                    |
| `130` | Cancelled by `SIGINT`.                                                                                                                             |
| `143` | Cancelled by `SIGTERM`.                                                                                                                            |
| `129` | Cancelled by `SIGHUP`.                                                                                                                             |

The exit code is not a field of the envelope; it follows from `ok` and from the codes present.

## Help and unusable invocations

`motion-kit --help`, `motion-kit -h`, `motion-kit help` and `motion-kit <command> --help` print usage
text on stdout and exit `0` — with or without `--json`, because they ask for documentation, not for a
result, and emit no envelope. Any other unusable argv still gets its one document under `--json`:

```bash
motion-kit --json
# {"schemaVersion":1,"command":null,"ok":false,"data":null,"diagnostics":[…],"durationMs":0.17}
# exit 2

motion-kit inspect entry.tsx --json
# command: "inspect"; message: "The inspect subcommand is not implemented yet."; exit 2
```

`command` is the first positional argument of argv, past any flag and that flag's value, so
`motion-kit --out out/a.mp4 render entry.tsx --json` reports `command: "render"` with a hint that the
subcommand goes first. `inspect` and `validate` are known names the CLI does not ship yet; they
report that, not "unknown command".

## Cancellation

`Ctrl-C` (or `SIGTERM`, or a closed terminal's `SIGHUP`) is a cancellation, not a failure: the run
emits **no envelope** — `--json` prints nothing at all — writes one line to stderr, and exits `128`
plus the signal number (`130`, `143`, `129`). The `.mp4` route kills its FFmpeg child and removes the
temporary file, leaving no target; the frames route stops before writing `manifest.json`, so any PNG
frames already written stay and no manifest claims the sequence is complete; `contact-sheet` writes
its image once, at the end, so a cancelled sheet leaves no partial file. A second `Ctrl-C` ends
the process immediately with the same guarantees. `preview` is the exception after it was ready: a stop
then is its normal end (exit `0`); see [readiness is the result](#readiness-is-the-result).

## Related

- [Getting started](getting-started.md) — install, a first entry, a first render.
- [Authoring](authoring.md) — what an entry exports and how the timeline works.
- [Troubleshooting](troubleshooting.md) — what to do for each `code` above.

The envelope, the Diagnostic shape and the exit codes above are a contract, not a convenience:
`schemaVersion` is `1` and changes only for a breaking change to them.
