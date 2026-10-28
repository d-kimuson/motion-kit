# CLI

`motion-kit` renders Compositions out of an entry file. It ships two commands today, `render` and
`frame`, and both speak the same output contract: without `--json` they print a one-line human
summary, and with it they print exactly one versioned JSON envelope on stdout.

```text
motion-kit <command> <entry> [options]
```

`<entry>` is an entry file relative to the directory you run the command in: a `.tsx`/`.ts` module
that exports `compositions` (see [authoring](authoring.md#the-registry)).

## Commands

```bash
# Whole Composition: an .mp4 target is encoded video, any other target is a PNG directory.
motion-kit render <entry> [--composition <id>] --out <file.mp4 | dir> \
  [--props <json>] [--concurrency <n>] [--json]

# One frame as a PNG.
motion-kit frame <entry> [--composition <id>] --frame <n> --out <png> [--json]
```

`motion-kit` is the bin the package installs (`bin.motion-kit` → `dist/cli.js`), so with pnpm a
command is `pnpm exec motion-kit …`, with npm `npx motion-kit …`, and with yarn `yarn motion-kit …`.
Both that form and `node dist/cli.js …` appear below: the second is the same CLI run out of a
checkout of this repository, after `pnpm build`, which is how the
[`examples/`](../../examples/README.md) commands are written.

## `render`

| Option               | Meaning                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--composition <id>` | Which Composition to render. Required when the registry holds more than one; otherwise optional.              |
| `--out <path>`       | Where to write. `.mp4` encodes H.264 video; any other path is a PNG frame directory. Required.                |
| `--props <json>`     | Props object as a JSON string, validated by the Composition's Zod schema before the first frame.              |
| `--concurrency <n>`  | How many renderers capture frames at once; each is its own browser. Positive integer, default half the cores. |
| `--json`             | Print the one-line summary as a JSON envelope instead.                                                        |

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
- `--out out/frames` — every frame as `frame-00000.png`, `frame-00001.png`, … plus a `manifest.json`
  (`format`, `composition`, width, height, fps, frame count and the file list). Needs no FFmpeg.

`render` creates the directories its output needs.

A frame's bytes do not depend on which renderer captured it, so `--concurrency` changes speed, not
output. It defaults to half the machine's cores; raise it for a long video, lower it when memory or
GPU contention is the limit.

### `--props`

```bash
node dist/cli.js render examples/chart/entry.tsx --composition chart \
  --props "$(cat examples/chart/data/index-20y.json)" --out out/chart.mp4 --json
```

The value must be a JSON object string. It is parsed, then validated and normalized by the
Composition's schema — defaults apply to fields you omit — and the resulting values are the
component's props. A non-object string is `cli.invalid-arguments` (exit 2); valid JSON that fails the
schema is `composition.props-invalid` (exit 1), with `details.issues` carrying the Zod issues and
their paths, and nothing is rendered. `frame` has no `--props`.

### Audio has no flag

The `.mp4` route muxes whatever the Composition declares in `audio`, resolving each `src` against the
directory you run the command in. There is no `--audio`, `--mute` or gain option:
[audio is Composition data](authoring.md#audio). A declared file that is missing, is not a regular
file, or cannot be opened for reading is `asset.load-failed`, reported before any frame is encoded
and with no output written.

## `frame`

| Option               | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `--composition <id>` | Which Composition to capture. Required when the registry holds more than one. |
| `--frame <n>`        | Global frame index to capture. Nonnegative integer, below the frame count.    |
| `--out <png>`        | File to write. Required.                                                      |
| `--json`             | Print the envelope instead of the one-line summary.                           |

```bash
motion-kit frame entry.tsx --frame 60 --out out/still.png
# captured frame 60 to /Users/kaito/hello-video/out/still.png (1920x1080) in 962.6ms
```

`frame` opens one renderer, captures one frame and writes one PNG. It has no `--props`, needs no
FFmpeg, and creates no directory — a missing parent is `internal.unexpected` (exit 3), so
`mkdir -p out` first. A frame index outside the Composition is `composition.props-invalid` (exit 1,
`location.frame` naming the request) — the Time Module's own rejection of an unproducible frame.

## The JSON envelope

`--json` writes exactly one JSON document to stdout, for successes and failures alike, and moves
human-facing logs to stderr. Every document has these fields:

| Field           | Type             | Meaning                                                                                              |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `schemaVersion` | `1`              | Bumped only for a breaking change to this contract.                                                  |
| `command`       | string, nullable | `render`, `frame`, the reserved `inspect`/`validate`, or `null` when argv named no known subcommand. |
| `ok`            | boolean          | True if and only if no Diagnostic has severity `error`.                                              |
| `data`          | object, nullable | Command-specific result; `null` when the command produced nothing usable.                            |
| `diagnostics`   | array            | Zero or more Diagnostics, including warnings and infos on success.                                   |
| `durationMs`    | number           | Wall time of the command in milliseconds.                                                            |

`render`'s `data` is a union on `format`:

```json
{
  "output": "/abs/out/teaser.mp4",
  "format": "mp4",
  "width": 1920,
  "height": 1080,
  "fps": { "numerator": 30, "denominator": 1 },
  "frameCount": 720,
  "durationSeconds": 24
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
  "frameCount": 720,
  "durationSeconds": 24
}
```

`frame`'s `data` is flat:

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

FPS is always a rational, including integer rates. `durationSeconds` is the Time Module's
`frameCount / fps`, not a separately declared number. A successful render is `ok: true` and may still
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

| Namespace     | Codes                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `cli`         | `cli.invalid-arguments`, `cli.entry-not-found`, `cli.composition-not-found`                             |
| `composition` | `composition.props-invalid`, `composition.duration-invalid`                                             |
| `asset`       | `asset.load-failed`, `asset.not-ready`                                                                  |
| `render`      | `render.browser-launch-failed`, `render.frame-timeout`, `render.page-error`                             |
| `encode`      | `encode.ffmpeg-not-found`, `encode.ffmpeg-unsupported`, `encode.ffmpeg-failed`, `encode.output-invalid` |
| `seek`        | `seek.uncontrolled` (a warning, emitted by an integration with uncontrolled time)                       |
| `internal`    | `internal.unexpected`                                                                                   |

`layout.*` (`layout.overflow`, `layout.out-of-frame`, `layout.unexpected-scroll`,
`layout.font-not-loaded`) is reserved for the later `inspect`/`validate` work and no command emits it
in 0.0.1. Adding a code is a compatible change; consumers must tolerate codes they do not know.

## Exit codes

| Code  | Meaning                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| `0`   | Success; warnings and infos allowed.                                                                         |
| `1`   | Domain failure: invalid props, an asset or page failure, a render or encode failure.                         |
| `2`   | Invocation error: unknown flag, missing argument, entry not found, unknown Composition, no known subcommand. |
| `3`   | Internal failure: a bug or an unconverted exception. The stack goes to stderr, never into JSON.              |
| `130` | Cancelled by `SIGINT`.                                                                                       |
| `143` | Cancelled by `SIGTERM`.                                                                                      |
| `129` | Cancelled by `SIGHUP`.                                                                                       |

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
frames already written stay and no manifest claims the sequence is complete. A second `Ctrl-C` ends
the process immediately with the same guarantees.

## Related

- [Getting started](getting-started.md) — install, a first entry, a first render.
- [Authoring](authoring.md) — what an entry exports and how the timeline works.
- [Troubleshooting](troubleshooting.md) — what to do for each `code` above.
- [The CLI output contract](../contexts/agent/adr/20261024-cli-output-contract.accepted.md) — the
  normative envelope, Diagnostic and exit-code decisions.
