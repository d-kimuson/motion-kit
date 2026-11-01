# Troubleshooting

Every failure the CLI reports is a Diagnostic with a stable `code`, a one-sentence `message` and a
`hint` that says what to do next. This page groups the codes you are likely to hit by what you were
trying to do, and gives the check that confirms the cause. If you only remember one command, remember
this one — it turns a failure into a JSON document you can read:

```bash
motion-kit render entry.tsx --out out.mp4 --json
```

## FFmpeg

FFmpeg is the one prerequisite motion-kit does not install. It is needed only for an `.mp4` target;
`frame` and a frames render (`--out <dir>`) never touch it.

### `encode.ffmpeg-not-found`

```json
{
  "code": "encode.ffmpeg-not-found",
  "message": "The FFmpeg binary \"ffmpeg\" could not be run.",
  "hint": "Install FFmpeg with `brew install ffmpeg` and re-run.",
  "details": { "binary": "ffmpeg" }
}
```

The binary is not on `PATH` or cannot be executed. `details.binary` is the name the probe tried, so
`"ffprobe"` in that field means FFmpeg is installed but its companion is not — a Composition that
declares audio needs both, because the channel count comes from `ffprobe`.

```bash
which ffmpeg ffprobe
ffmpeg -version | head -1
```

Install with your OS's package manager — `brew install ffmpeg` (macOS),
`sudo apt install ffmpeg` (Debian/Ubuntu), `sudo dnf install ffmpeg` (Fedora, RPM Fusion),
`sudo pacman -S ffmpeg` (Arch), `winget install --id Gyan.FFmpeg` (Windows) — or from
<https://ffmpeg.org/download.html>. The probe runs once per invocation, before the first frame, so the
failure arrives in about a second and no output file is created.

### `encode.ffmpeg-unsupported`

```json
{
  "code": "encode.ffmpeg-unsupported",
  "details": { "found": "4.4.2", "required": "6.0", "missing": ["libx264"] }
}
```

The binary runs but is older than 6.0, or was built without `libx264`. Check both conditions the probe
checks:

```bash
ffmpeg -version | head -1                                  # needs 6.0 or newer
ffmpeg -hide_banner -encoders | grep libx264
```

Upgrade the package; a build without `libx264` cannot encode H.264 in motion-kit's route, and there is
no flag to choose another encoder.

### `encode.ffmpeg-failed`

FFmpeg started, encoded at least one frame, and exited non-zero. `details.stderrTail` is a bounded,
credential-redacted tail of its log:

```json
{ "code": "encode.ffmpeg-failed", "details": { "exitCode": 1, "signal": null, "stderrTail": "…" } }
```

Read the reported FFmpeg error and fix the composition, target path, or environment; retry if the
error indicates a transient failure. The usual causes are a declared audio file FFmpeg cannot
decode, or an unsupported codec inside a clip; check the clip on its own with `ffprobe <file>`.

### `encode.output-invalid`

The encode produced no usable file. `details.reason` says which observation failed:

| `reason`       | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `"no-frames"`  | The Composition has `durationInFrames: 0`, so nothing was ever handed to FFmpeg.             |
| `"unwritable"` | The destination directory refused the temporary file (`EACCES`, `ENOSPC`); no child started. |
| `"empty"`      | FFmpeg exited 0 and left zero bytes.                                                         |

Check write access and free disk space in the destination directory
(`df -h .`), or give `--out` a path you own. A zero-frame Composition produces no video by
definition; `frame` and the frames route can still be used to smoke-test the tree.

### You do not need FFmpeg yet

While FFmpeg is the blocker, render pictures instead of video — the frames route and `frame` produce
the same captured pixels:

```bash
motion-kit render entry.tsx --out out/frames --json
motion-kit frame entry.tsx --frame 60 --out out/still.png
```

## Chromium

### `render.browser-launch-failed`

```json
{
  "code": "render.browser-launch-failed",
  "message": "Chromium could not be launched.",
  "hint": "Install the matching browser with pnpm exec playwright install chromium; check sandbox support and the explicit launch options."
}
```

The Playwright browser is missing or cannot start. Install it once per machine:

```bash
pnpm exec playwright install chromium      # or: npx playwright install chromium
```

If the browser is installed and still will not launch:

- **Linux containers and CI runners** restrict unprivileged user namespaces. Chromium's sandbox needs
  them; turning the sandbox off with `--disable-sandbox` or `createRenderer({ disableSandbox: true })`
  is a last resort rather than the default.
- **No GPU** is handled by Chromium's software rasteriser; the WebGL-forcing option
  (`--software-webgl` or `softwareWebGL: true` on `createRenderer`) is likewise an explicit choice,
  not something a render needs for ordinary DOM/SVG/Canvas work.
- **A Linux machine without Chromium's system libraries** needs the dependency step instead:
  `pnpm exec playwright install --with-deps chromium` (it installs packages, so it needs `sudo`).
  The launch error names the missing library.

### Automatic fallback to software WebGL has been deprecated

This Chromium page-console message, forwarded to stderr, indicates a SwiftShader-backed WebGL
context, but does not identify which canvas created it. Inspect each relevant context: get
`gl.getExtension('WEBGL_debug_renderer_info')` and, if available, read
`gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)`. Software rendering can materially affect throughput.
Adding `--enable-unsafe-swiftshader` to Chromium opts trusted content into lower security guarantees
and suppresses the warning; it does not select a GPU. This release has no GPU-selection option. See
the [investigation](../contexts/agent/knowledge/20261029-swiftshader-warning.md).

### The render hangs, then reports a timeout

`render.frame-timeout` means the page never reached the readiness barrier inside the 30-second frame
budget; `asset.not-ready` means it did respond and listed assets still pending, with `timeoutMs` in
`details`. The most common authoring cause is a `useAsset` consumer **outside** a local `<Suspense>`
([authoring](authoring.md#useasset)): its throw suspends the whole tree, so the Composition never
acknowledges its content and the barrier waits until the deadline. The second cause is an asset that
never decodes — the pending list in `asset.not-ready` names each one with its source and phase.

## Assets

### `asset.load-failed`

A font, image or declared audio file could not be loaded. `location.file` (and `details.assets[].source`)
name the source as it was written, redacted:

| Symptom                                              | Cause and fix                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A font or image that exists in the project fails     | `source` must be a **root-relative URL** (`/assets/logo.png`), not a filesystem path and not a JavaScript import.                                                                                                                                                                 |
| Nothing found under `examples/<name>/assets.local`   | The example's placeholders were never generated: run `node examples/slideshow/fetch-assets.ts` or `node examples/explainer/fetch-assets.ts --placeholders`.                                                                                                                       |
| An audio clip fails before the first frame           | `audio[].src` is resolved against the project root (the working directory by default); a missing, non-file or unreadable path is reported with no output written.                                                                                                                 |
| `--props '{"assets":"final"}'` fails on the examples | `final` reads media a clone does not have: `slideshow` reads `assets/` (nothing is committed there yet) and `explainer` reads `assets.local/portraits/` and `assets.local/voice/`, which only step 2 of its `fetch-assets.ts` writes. Render the default (`placeholder`) instead. |

## `render.page-error`

The Composition declaration or the loaded registry is invalid, or — for a Three.js Composition — a canvas could not draw the frame. The message names the case; the common declaration ones:

| Cause                                                                                                           | Fix                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The Composition declares `duration` in seconds                                                                  | Use `durationInFrames`; the timeline is frames.                                    |
| The component has non-empty `defaultProps` (own or inherited)                                                   | Declare defaults in the Zod schema, not on the component.                          |
| `fps` is a number, or has non-integer components                                                                | Pass `{ numerator, denominator }`, e.g. `{ numerator: 30000, denominator: 1001 }`. |
| An audio declaration is invalid (`endInFrames <= startInFrames`, a negative frame, a non-finite gain)           | Fix the declaration; it is validated at `defineComposition` time.                  |
| `TransitionScene` or `Transition` used outside `TransitionSeries`, or two `Transition`s between adjacent scenes | Make the tree match the [authoring](authoring.md#transitionseries) rules.          |
| Two Compositions share an id, or the registry is empty                                                          | Give every Composition a unique id.                                                |

A module-level exception in the entry (a throw while the entry is imported) surfaces the same way.

A Three.js canvas reports this code when it could not draw the frame either: a shader program that
does not compile or link (`"A shader program failed to compile or link while settling the frame."`, and
every following frame with it), or a lost WebGL context (`"The WebGL context was lost while settling
the frame."`). Neither case publishes the frame it failed: the shader failure keeps every later frame
failed with it, and a lost context leaves the frames after it unqualified. Fix the material, or
restart the render. The
[Three.js guide](three.md) says what a canvas supports.

When the frame transport or page throws during capture, the message is `"The frame transport or
page failed."` and, when the exception yields a usable message or name, `details.cause` preserves
its sanitized `message`, plus its `name` and `code` when present. Use that evidence to investigate page, transport/CDP and browser
failures; the diagnostic does not classify which one failed. The cause drops stack frames, redacts
URL credentials and machine-specific paths, and is bounded to 500 characters. Human-readable output
keeps only the deterministic message and hint, so re-run with `--json` to inspect `details.cause` when present.

## `composition.props-invalid`

Props did not validate, or a requested frame is outside the Composition:

- `details.issues` carries the Zod issues with their paths, so `path: ["series"]` means the `series`
  prop is missing or wrong. Pass `--props` with a JSON object, or add a schema default.
- A top-level `key`, `ref`, `__self`, `__source` or `__proto__` is reserved by React and is rejected
  with a message naming the field.
- A prop value that is not JSON (a `Date`, a class instance, a function) is rejected — the values
  cross into the page as data.
- From `frame`, `location.frame` with `"Output frame is outside the composition frame range."` means
  `--frame` asked for a frame at or beyond `durationInFrames`. Pass an index below the frame count.

## `cli.*` — the command line itself

| Code                        | Usual cause                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.entry-not-found`       | The `<entry>` path does not exist relative to the directory you ran the command in.                                                                                                                                                                                           |
| `cli.composition-not-found` | `--composition` names an id the registry does not export; ids are case-sensitive.                                                                                                                                                                                             |
| `cli.invalid-arguments`     | A missing required flag (`--out`, `--frame`), an unknown flag, `--props` that is not a JSON object string, `--concurrency` that is not a positive integer, the subcommand written after a flag, or a reserved subcommand (`inspect`, `validate`) that is not implemented yet. |

The hint says which of those applies. Without `--json` the same text goes to stderr; the exit code is
`2` either way.

## `internal.unexpected`

A bug or an unconverted exception; exit code `3` and the stack trace on stderr. Two cases are known
and avoidable rather than real bugs:

- `--out` naming an existing directory for an `.mp4` target: the encoder cannot rename its temporary
  file onto a directory. Point `--out` at a file path.

Anything else: keep the envelope and the stack, and report it.

## `preview` problems

- **`render.page-error`: "Port N on 127.0.0.1 is already in use."** Another process listens on the
  `--port` you passed. Stop it, pick another port, or omit `--port` to get a free one.
- **The preview ended with `render.page-error`: "The Vite config vite.config.ts changed, so the preview stopped.".** The
  Vite config or something it imports changed, which a reload cannot pick up. Run `preview` again. The
  line is on stderr and the exit code is `1`; the earlier readiness envelope is the only stdout output.
- **A Composition or props error appears in the page, not in the terminal.** `preview` does not load the
  entry in the CLI: an unknown `--composition`, props the schema rejects and registry errors are shown in the page as Diagnostics (a `--props` that is not a JSON object is still `cli.invalid-arguments`),
  and the page recovers on the next save. Use `check` or `frame` to get them as an envelope.
- **A source is marked unplayable, or there is no sound.** The audio file could not be fetched or
  decoded by the browser, or it lies outside what Vite's `server.fs.allow` serves (an absolute `src`
  elsewhere renders but does not play in the preview: add its directory to `server.fs.allow`); the
  source is skipped and the rest plays. Browsers also start audio only after a click, so press Play. Check that
  the source's checkbox is ticked; a cleared one mutes it.
- **The page shows `render.page-error`: "The composition page loaded, but the entry did not start."**
  The entry failed to import or run in the browser, for example a syntax error or a module that throws
  at import. The browser console and the terminal running `preview` name the error; save a fix and the
  page reloads.
- **The timeline lacks a named Sequence.** A nested one appears once the playhead has been inside its
  parent; scrub through the Composition once.
- **Ctrl-C printed nothing, or `preview aborted; nothing is being served`.** After the preview was
  ready, a stop is its normal end and exits `0`. The aborted line means the stop came before it was
  ready, and the exit code is `128` plus the signal number.

## A cancelled run

`Ctrl-C` is not a failure and produces no envelope. The run prints one line to stderr and exits `130`
(`SIGINT`), `143` (`SIGTERM`) or `129` (`SIGHUP`):

- the `.mp4` route kills its FFmpeg child and removes the temporary file, so no partial video is left;
- the frames route stops before writing `manifest.json`, so the PNGs already written stay but nothing
  claims the sequence is complete.

Re-run the command to get a complete output.

## Renders are slow

- Raise `--concurrency` (default: half the machine's cores). Each renderer is its own browser, so a
  long video on a many-core machine speeds up roughly linearly until memory or GPU contention wins.
- Lower it when the machine starts swapping; a renderer that cannot get memory shows up as slow
  frames rather than an error.
- For a quick loop, render a short Composition of the same tree instead of the full video — the
  [examples](examples.md#the-short-compositions) all ship one.

## Related

- [CLI](cli.md) — the full envelope, the code table and the exit codes.
- [Authoring](authoring.md) — the rules whose violation produces `render.page-error` and
  `composition.props-invalid`.
- [Examples](examples.md) — the asset setup each example needs before its first render.
