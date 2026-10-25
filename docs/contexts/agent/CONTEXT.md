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

## render output format

`render --out <path>` selects the format from the target's extension: an `.mp4` file is encoded H.264 video and reports `data.format: "mp4"`, and any other target is a PNG frame sequence in that directory reporting `data.format: "frames"` with a `manifest`. There is no `--format` flag; the format is envelope data fixed by the CLI output contract, not an argument, so the target path is the only place it can come from. The `.mp4` route needs a working FFmpeg 6.0+ with `libx264` on `PATH` ([system FFmpeg ADR](../render/adr/20261025-system-ffmpeg-encoder.accepted.md)), probed once per invocation before the first frame: a missing or unsupported binary is `encode.ffmpeg-not-found` or `encode.ffmpeg-unsupported`, a failure the agent resolves by installing FFmpeg rather than by changing the Composition.
