# agent

What a coding agent operates. agent provides the CLI and diagnostics: render, frame, inspect, validate first, with JSON output so an agent can act on the result without a GUI.

## Ubiquitous Language

| Term              | Code                   | Definition                                                                                                                        |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CLI               | `motion-kit <command>` | The command-line entry; every command supports JSON output.                                                                       |
| Diagnostic        | `Diagnostic`           | A structured finding with `code`, `severity`, `message`, and `hint` (required for errors and warnings), plus location when known. |
| Inspect           | `inspect`              | Reporting a Composition's structure, time ranges, assets, seekability tiers, and diagnostics without rendering video.             |
| Validate          | `validate`             | Checking a Composition against schemas and rules and returning diagnostics.                                                       |
| Layout Diagnostic | `LayoutDiagnostic`     | A problem found by DOM measurement: overflow, out-of-frame placement, unexpected scroll, unloaded font, missing asset.            |
| Contact Sheet     | `contact-sheet`        | A grid of representative frames for visual review.                                                                                |

## Invariants

- Every failure the CLI reports is a Diagnostic; stack traces are never included in JSON; an internal-failure stack goes to stderr only.
- A Diagnostic names the scene, element, and time whenever they are known.
- The [accepted CLI output contract](adr/20261024-cli-output-contract.accepted.md) fixes the JSON envelope, severity semantics, exit codes, and versioning policy.
