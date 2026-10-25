# agent

What a coding agent operates. agent provides the CLI and diagnostics: render, frame, inspect, validate first, with JSON output so an agent can act on the result without a GUI.

## Ubiquitous Language

| Term              | Code                   | Definition                                                                                                                                                                 |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI               | `motion-kit <command>` | The command-line entry; every command supports JSON output.                                                                                                                |
| Diagnostic        | `Diagnostic`           | A structured finding defined by [`DiagnosticSchema`](../../../src/lib/diagnostic.ts) and the [accepted CLI output contract](adr/20261024-cli-output-contract.accepted.md). |
| Inspect           | `inspect`              | Reporting a Composition's structure, time ranges, assets, seekability tiers, and diagnostics without rendering video.                                                      |
| Validate          | `validate`             | Checking a Composition against schemas and rules and returning diagnostics.                                                                                                |
| Layout Diagnostic | `LayoutDiagnostic`     | A problem found by DOM measurement: overflow, out-of-frame placement, unexpected scroll, unloaded font, missing asset.                                                     |
| Contact Sheet     | `contact-sheet`        | A grid of representative frames for visual review.                                                                                                                         |

## Invariants

- Every failure the CLI reports is a Diagnostic; stack traces are never included in JSON; an internal-failure stack goes to stderr only.
- Include known location information in each Diagnostic according to the accepted CLI output contract.
- The [accepted CLI output contract](adr/20261024-cli-output-contract.accepted.md) fixes the JSON envelope, severity semantics, exit codes, and versioning policy.

## Cancellation

`motion-kit` binds `SIGINT` and `SIGTERM` to one `AbortController` per invocation (`watchSignals` in `src/cli/cli.ts`, installed by `src/cli/main.js`) and passes its signal to `createRenderer`, `renderFrame`, `renderFrames` and `renderVideo`. A cancelled run is aborted control flow, not a result: **no envelope is emitted** — the schema cannot express "stopped", and fabricating a Diagnostic (or `internal.unexpected`) would call the caller's own intent a domain failure or a bug — nothing is written to stdout, one line goes to stderr, and the exit code is `128` plus the signal number: `130` for `SIGINT`, `143` for `SIGTERM`, the same code a shell reports for a process it interrupted. Both `render` routes behave identically: the `.mp4` route kills the FFmpeg child (`SIGTERM`, then `SIGKILL`), removes the temporary sibling and leaves no target, and the frames route stops before writing `manifest.json`, so a partial sequence is never claimed complete (the PNGs already written stay). A second signal is left to the default handler, so a second `Ctrl-C` ends the process immediately instead of waiting for cleanup.

That contract is the CLI's, so nothing else in the process may end a run early. Playwright installs its own `SIGINT` handler when it launches a browser (`addProcessHandlerIfNeeded` in `playwright-core`) and that handler exits `130` as soon as its browsers close — inside the same signal dispatch, ahead of the asynchronous cleanup that has to kill the encoder, remove its temporary sibling and write the line. The launcher therefore disables it (`handleSIGINT`, `handleSIGTERM`, `handleSIGHUP` are `false` in `chromiumOptions`, `src/render/browser/launch.ts`); Playwright's `exit` handler still kills the processes it tracks. Because no guarantee may depend on which listeners another library happens to install, the work a cancelled run promises is _also_ registered as a synchronous guard on `process.on('exit')` (`coverOnExit` in `src/lib/exit.ts`): the FFmpeg child is killed, its temporary sibling removed, the loading service's process group killed and the one line written, so a process ended by something else leaves exactly the state a cancellation leaves.

## render output format

`render --out <path>` selects the format from the target's extension: an `.mp4` file is encoded H.264 video and reports `data.format: "mp4"`, and any other target is a PNG frame sequence in that directory reporting `data.format: "frames"` with a `manifest`. There is no `--format` flag; the format is envelope data fixed by the CLI output contract, not an argument, so the target path is the only place it can come from. The `.mp4` route needs a working FFmpeg 6.0+ with `libx264` on `PATH` ([system FFmpeg ADR](../render/adr/20261025-system-ffmpeg-encoder.accepted.md)), probed once per invocation before the first frame: a missing or unsupported binary is `encode.ffmpeg-not-found` or `encode.ffmpeg-unsupported`, a failure the agent resolves by installing FFmpeg rather than by changing the Composition. Both routes report the warnings capture emitted per frame — `seek.uncontrolled` for a detected Tier C Composition, `layout.*` for measured layout problems — in the envelope's `diagnostics`, so a successful render is `ok: true` with warnings, never `ok: true` with an empty array.
