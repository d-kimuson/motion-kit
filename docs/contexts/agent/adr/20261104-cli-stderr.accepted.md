# Keep stdout to the result and give the renderer's own output, progress and failure evidence one stderr policy

## Context

`render`, `frame` and `check` mount a Composition in Chromium, and every process they start writes to the CLI's stderr as it goes: the page console (forwarded by the loading session), the loading service's own child process (Vite's handshake, the dependency optimizer, its Node warnings). A healthy render therefore prints notices about the machine — Chromium's `Automatic fallback to software WebGL has been deprecated` whenever a Composition opens a WebGL context ([knowledge](../knowledge/20261029-swiftshader-warning.md)), GL driver messages, Vite's `[vite] connecting...`, react-dom's development hint — next to the Diagnostics the CLI owes its caller. A script or an agent reads stderr as evidence about the run, so that noise competes with the information it needs.

The [CLI output contract](20261024-cli-output-contract.accepted.md) fixes stdout: with `--json` it carries exactly one envelope and nothing else, and without it the human summary. Everything else — the renderer's logs, the progress of a long render, the evidence a failure needs — can only go to stderr.

A render also has no sign of life until it ends: `renderVideo` already reports `EncodeProgress { encodedFrames, frameCount }` to its caller, and the frames route can count the frames it writes, but the CLI used neither.

The GPU question is separate: `--enable-gpu` and new headless mode are TASK-242's, and this decision changes neither the launch options nor which renderer a run uses.

## Decision

### Three log levels

`render`, `frame` and `check` accept `--verbose` and `--quiet`; passing both is `cli.invalid-arguments` (exit `2`). A level decides what the CLI does with every line the renderer's processes emit — the Composition's page console (`browser`) and the loading service's child (`service`):

| Level     | Flag        | While the command runs       | After a failure                    | Progress |
| --------- | ----------- | ---------------------------- | ---------------------------------- | -------- |
| `normal`  | _(default)_ | nothing of it reaches stderr | the last kept lines, on stderr     | shown    |
| `verbose` | `--verbose` | every line, as it arrives    | nothing further (already streamed) | shown    |
| `quiet`   | `--quiet`   | nothing of it reaches stderr | nothing                            | hidden   |

A line is kept for the failure report until the run has 20 of them, oldest dropped first; one line is cut at 500 characters. At `normal` a **known environmental notice** is not kept at all, because it says nothing about the Composition that failed: Chromium's software-WebGL fallback warning and its `GL Driver Message` lines, the Vite client's handshake and optimizer notices, react-dom's DevTools hint, and the loading child's `ExperimentalWarning`. The list is `isKnownRendererNoise` in `src/render/noise.ts`, matched by substring because a page console message carries its arguments in front of its text (`[]Automatic fallback …`). It is knowledge about the environment, so it lives in `render`, not in the CLI.

Nothing else changes: Chromium is still launched without `--enable-unsafe-swiftshader` unless `--software-webgl` asks for it, so the warning is emitted and hidden rather than prevented, and `--verbose` shows it.

### Progress

Every `render` (the MP4 and the frames route) reports completed frames out of the artifact's total on stderr:

```text
rendering 120/300 frames (40%) ETA 12s
```

- `total` is the artifact's frame count, the one the envelope's `data.frameCount` reports: the range's length for `--from`/`--to`, and with `--fps` the encoder's output frame count rather than the Composition's. Completed frames are counted per artifact frame, summed across every renderer `--concurrency` opened.
- On a terminal the line is rewritten in place (`\r`) at most every 100 ms, and always for the last frame; the run ends it with a newline before anything else is written. When stderr is not a terminal — a pipe, a background job, an agent's capture — one whole line is written per 10% of the total, plus the last frame, so a captured log has eleven lines at most instead of one per frame.
- `ETA` is the remaining frames divided by the rate over the last 3 seconds of completions, so a burst from a pool does not set the pace; it is omitted until the window spans at least 250 ms. `--quiet` suppresses every progress line.

The formatting, the thinning and the estimate are pure functions of a state and an injected monotonic clock (`src/cli/progress.ts`), so the determinism rules apply to them like any other value: no `Date`, no `performance.now`, the clock passed in.

### Failure evidence

A failed run — `ok: false` with Diagnostics, not a cancellation — writes the kept renderer lines to stderr, in both the human and the `--json` form:

```text
renderer log (2 lines; --verbose streams them as they arrive):
  drawing the scene
  Error: props.text is missing
```

They stay out of the envelope on purpose: its fields are versioned and its text is the CLI's own, and page output is machine-specific free text. A success says nothing extra, and `--verbose` already showed these lines live.

### Where it lives

- `src/lib/log.ts` — `LogLevel`, `LogRecord`, the pure `logDecision`, and the process-wide channel (`logChannel`, `setLogChannel`) with its bounded buffer. Beside `Result` and `Diagnostic`, because `render` produces and the CLI decides.
- `src/cli/log.ts` — the two flags as a Zod schema (`logFlagsSchema`) and the failure block's text.
- `src/cli/progress.ts` — the progress contract and its reporter.
- `src/render/noise.ts` — the known-notice list.
- `src/render/loading/session.ts`, `service.ts` — the producers that write records instead of `process.stderr`.

The channel's own default is `verbose`, so a library consumer that calls `renderVideo` or `openLoadingSession` directly, and the `preview` command (a person watching a page wants its console), keep the behaviour they had. Only `render`, `frame` and `check` install a level from their flags.

No Diagnostic code, envelope field or `schemaVersion` changes.

## Consequences

- A default `render`/`frame`/`check` prints the envelope, its Diagnostics and its progress, and nothing else; its stderr no longer needs to be filtered by the caller. `--verbose` is the way to see what the page said, and the troubleshooting guide points there for the SwiftShader warning.
- A Composition's own `console.log`/`console.warn`/`console.error` no longer appears during a successful run unless `--verbose` is passed; on failure the last 20 lines are printed, which is when they are needed.
- Progress is one more line-oriented format on stderr, so its wording is a human interface, not a contract: nothing parses it, and `--json` stays the machine interface.
- The frames route now knows how many frames it has written, which the progress report uses; nothing else about the artifact changes.
- Vite's own output is now held back with the page's. A failing run still shows its last lines, and `--verbose` shows everything.

## Alternatives

- **Progress on stdout**: rejected — stdout is the envelope under `--json`, and the contract allows one document there.
- **Forward the page console but filter only Chromium's warning**: rejected because Vite's handshake, the optimizer, react-dom's development hint and the loading child's Node warning fill the same channel and say just as little about the Composition.
- **Put the kept renderer lines into `render.page-error.details`**: rejected for now. The envelope's `details` payloads are versioned and defined per code, and page text carries machine-specific paths and free-form output; the stderr block is the alternative the task allows, and it keeps the envelope stable at `schemaVersion: 1`.
- **Emit progress for every frame to a pipe**: rejected — a captured log becomes one line per frame and unreadable, and a writer that is slower than the render applies backpressure to it.
- **Estimate the remainder from the whole run's average rate**: rejected because a slow start (dependency optimization, browser warm-up) then dominates the estimate for the rest of the run; a 3-second window follows the run.
- **Infer the level from `stderr.isTTY`**: rejected — a terminal is not a statement about how much output the caller wants, and `--json` users are exactly the callers most likely to pipe.
