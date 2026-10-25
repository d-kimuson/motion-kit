# Fix the version 1 CLI output contract before implementing the CLI

## Context

Coding agents need one machine-readable result from every CLI command before the CLI MVP exists. TASK-164 fixes the envelope, Diagnostic, initial codes, and exit codes; implementations must not redesign them. The contract follows design.md §2.4, §5.2, and §10.1–10.3. design.md §10.1 spells the executable `motionkit`; the command name is `motion-kit`.

## Decision

### Output and exit codes

JSON output requires an explicit `--json` flag for the MVP. A non-TTY stdout does not imply it. In JSON mode stdout contains exactly one JSON document and nothing else; human-readable logs go to stderr. Without the flag, the same diagnostics are printed for humans, with no fixed presentation format.

Every JSON document has these required fields:

| Field           | Contract                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Integer literal `1`; bump only for a breaking change.                                                                                    |
| `command`       | `render`, `frame`, `inspect`, or `validate`.                                                                                             |
| `ok`            | True if and only if no Diagnostic has severity `error`.                                                                                  |
| `data`          | Command-specific object; null on failure when nothing usable was produced. A failure may retain usable data, but success must have data. |
| `diagnostics`   | Diagnostic array, including warnings and infos on success.                                                                               |
| `durationMs`    | Finite, nonnegative wall time of the command in milliseconds; fractional milliseconds are allowed.                                       |

| Exit code | Meaning                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | `ok: true`; warnings and infos are allowed.                                                                                                                |
| 1         | `ok: false` from domain diagnostics: invalid composition, asset failure, render or encode failure.                                                         |
| 2         | Invocation error: unknown flag, missing argument, entry file not found. Emit the envelope with a `cli.*` Diagnostic when `--json` was parseable from argv. |
| 3         | Internal failure: a bug or unconverted exception. Emit `internal.unexpected`; send the stack trace only to stderr, never JSON.                             |

There is no exit-code field in the envelope. Exit selection and stdout/stderr routing are obligations of the future CLI, not schema validation.

_Amended 2026-10-25 (TASK-159):_ the table above stays closed for envelopes that are **emitted**, and a cancelled run emits none. `SIGINT`/`SIGTERM`/`SIGHUP` (or a programmatic abort) is aborted control flow: no JSON document on stdout, one line on stderr, and exit code **`128` plus the signal number** (`130` for `SIGINT`, `143` for `SIGTERM`, `129` for `SIGHUP`) — the code a shell itself reports for an interrupted process, which keeps a cancelled run distinguishable from a domain failure (1), an invocation error (2) and an internal bug (3). A second signal does not wait for that run's asynchronous cleanup: it performs the same synchronous cleanup an exit performs, then leaves at once with `128` plus the second signal's number, so a second `Ctrl-C` is never held up — and still leaves no envelope, no temporary file and no child. The aborted line is owed only while the run can still be stopped before it commits: the route releases it once its outcome is final and before it tears the renderer down, so a stop inside a finished run's teardown leaves the committed output in place and says nothing to deny it (still no envelope). No cancellation Diagnostic is invented, because the [time control and frame capture decision](../../decisions/20261024-time-control-and-frame-capture.accepted.md) reserves a CLI cancellation envelope for its own contract decision and `ok` follows "true iff no error Diagnostic" and "success must have data"; an aborted run has neither. See [agent CONTEXT](../CONTEXT.md#cancellation).

### Diagnostic

A Diagnostic contains `code`, `severity`, and a nonempty `message`: one sentence explaining what is wrong, never a stack trace. `hint` says what to do next; a nonempty hint is required for errors and warnings and optional for infos. Sentence quality and excluding stack traces from free text are producer obligations, not language-dependent heuristics in the schema.

| Severity  | Meaning                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `error`   | The command's result is missing or must not be trusted.                                                |
| `warning` | A result was produced but is likely wrong for the user, such as layout overflow or Tier C seekability. |
| `info`    | A fact worth surfacing, such as an integration present but unused.                                     |

`location` is optional and all its fields are optional: `compositionId`, `sceneId`, `elementId`, `file`, `line`, `column`, `frame`, and `timeSeconds`. Include whatever is known. Line and column are one-based positive integers. `frame` is an integer Global Frame, and `timeSeconds` is its finite numeric Presentation Time, not a serialized rational. Diagnostic locations allow negative frame/time values so a finding can identify an invalid requested position; produced frame data is nonnegative.

`details` is an optional JSON object with code-specific contents. For `composition.props-invalid`, use `{ "issues": [...] }`, the JSON-serialized Zod issues (including `code`, `path`, `message`, and issue-specific properties). For `asset.load-failed` and `asset.not-ready`, use `{ "assets": [{ "kind": "image", "source": "/assets/checker.svg", "phase": "decode" }] }`: each entry identifies the asset kind, source URL/path and failing or pending phase. An entry may include `relatedSources`, an array of associated URLs/paths such as a texture's upload gate; for textures, `source` identifies the actual source image. For `asset.not-ready`, `assets` lists every pending registration and `timeoutMs` records the finite, nonnegative readiness deadline duration in milliseconds. Redact credentials and other secrets from source identities. Known scene/frame information belongs in `location`; raw exceptions and internal spike identifiers do not belong in `message`, which remains a one-sentence human statement, and `hint` gives a corrective action. The remaining initial codes do not yet define a details payload; do not invent one without documenting it here. A dated amendment below may define the payload of a code this sentence still lists as undefined, and for that code the amendment governs. The common schema checks JSON representability, not the contents of each code's details. Do not put exceptions, stacks, or secrets in details.

_Amended 2026-10-25:_ the `encode` namespace's payloads, fixed by the [system FFmpeg ADR](../../render/adr/20261025-system-ffmpeg-encoder.accepted.md#encoder-diagnostics), are documented here before implementation, as this section requires. This amendment supersedes the sentence above for these four codes: their payloads are defined here even where that sentence lists them as undefined. `encode.ffmpeg-not-found` uses `{ "binary": "ffmpeg" }`, the binary name or `ffmpegPath` the probe attempted. `encode.ffmpeg-unsupported` uses `{ "found": "4.4.2", "required": "6.0", "missing": ["libx264"] }`: `found` is the version the probe parsed, `required` the supported floor, and `missing` the probed capabilities that are absent, empty when the version alone is too old. `encode.ffmpeg-failed` uses `{ "exitCode": 1, "signal": null, "stderrTail": "…" }`: `exitCode` is null when a signal ended the child, `signal` is that signal's name or null, and `stderrTail` is a bounded, credential-redacted tail, never a full log. `encode.output-invalid` uses `{ "output": "/abs/out.mp4", "reason": "no-frames" }`: `output` is the final target, while `reason` describes the temporary sibling the encoder actually inspected — `"no-frames"` (no frame reached the encoder), `"unwritable"` (the temporary sibling could not be created, typically `EACCES` or `ENOSPC`) or `"empty"` (a successful exit that left it zero bytes). There is no `"missing"` value: the encoder creates the sibling before the child starts and runs the child with overwrite enabled, so a successful exit leaves that file present and either written or zero bytes. There is no `"truncated"` value either, because Phase 1 defers MP4 completeness to a later `ffprobe` inspection. Two of those codes are reserved, not shipped: the encoding ADR removes the ambiguity left by "exit 0 but no usable file" — a zero-frame encode reports `encode.output-invalid`, never `encode.ffmpeg-failed` — and `encode.ffmpeg-unsupported` and `encode.output-invalid` join the `encode` row of the namespace table below with the encoder in TASK-159. This amendment adds no code and changes no schema.

TASK-153's accepted [page protocol](../../render/adr/20261024-page-runtime-protocol.accepted.md) clarifies `render.page-error`: besides page exceptions, producers use it for configuration/module/registry initialization failures and loading expiry, including the 30-second timeout restarted for every defaults or supplied-props parse in later mounts. It has no new details payload; loading failure is not `render.frame-timeout`. The separate 30-second caller/queue timeout covers transport/queue/grant handshake and expires as an abort without a Diagnostic. Invalid duration uses `composition.duration-invalid`; invalid width, height or FPS uses `render.page-error`; `composition.props-invalid` is reserved for props-schema validation. TASK-154 converts `createFrameRate` failures at the metadata boundary instead of forwarding `composition.props-invalid`, and TASK-157 preserves that mapping.

The code pattern is `^[a-z]+(\.[a-z0-9-]+)+$`. The namespace is the segment before the first dot. `DiagnosticCodeSchema`, a Zod enum, is the single source of truth for allowed codes; its closed membership enforces the pattern and reserved namespaces. Even features not yet implemented reserve their codes:

| Namespace     | Initial codes                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `cli`         | `cli.invalid-arguments`, `cli.entry-not-found`, `cli.composition-not-found`                                       |
| `composition` | `composition.props-invalid`, `composition.duration-invalid`                                                       |
| `asset`       | `asset.load-failed`, `asset.not-ready` (readiness barrier timed out)                                              |
| `render`      | `render.browser-launch-failed`, `render.frame-timeout`, `render.page-error` (page or composition-loading failure) |
| `encode`      | `encode.ffmpeg-not-found`, `encode.ffmpeg-unsupported`, `encode.ffmpeg-failed`, `encode.output-invalid`           |
| `seek`        | `seek.uncontrolled` (Tier C detected; emit as warning)                                                            |
| `layout`      | `layout.overflow`, `layout.out-of-frame`, `layout.unexpected-scroll`, `layout.font-not-loaded`                    |
| `motion`      | `motion.invalid-input`, `motion.non-finite-result`                                                                |
| `internal`    | `internal.unexpected`                                                                                             |

TASK-152 adds `motion.invalid-input` for invalid Pure Motion inputs (including non-finite numbers, non-increasing stops, mismatched ranges and invalid Bézier controls), and `motion.non-finite-result` for evaluation overflow or a non-finite easing result. Both are errors with actionable hints and no details payload; see the [Pure Motion contract](../../motion/adr/20261024-pure-motion-contract.accepted.md).

### Command data

- `render`: `data` is a discriminated union on `format`. Both variants share `output` (an absolute file path), `width` and `height` (positive integers), `fps` (`{ numerator, denominator }` with positive integer components), `frameCount` (a nonnegative integer), and `durationSeconds` (finite and nonnegative). Always serialize FPS as a rational, including integer rates such as `{ "numerator": 30, "denominator": 1 }`. The variants are:
  - `format: "frames"`: `output` names the directory the PNG frame sequence was written into, and `manifest` is the absolute path of the JSON file in that directory describing the sequence (`format`, `composition`, `width`, `height`, `fps`, `frameCount`, and the frame file `files`). The CLI produces this variant for an `--out` that is not an `.mp4` file.
  - `format: "mp4"`: produced when `--out` names an `.mp4` file, which the CLI encodes instead of writing a PNG sequence. Its payloads are the same shared fields, its Diagnostics and their `details` are fixed by the [system FFmpeg ADR](../../render/adr/20261025-system-ffmpeg-encoder.accepted.md#encoder-diagnostics), and `output` names the encoded file.

  _Amended 2026-10-24:_ the original text said `format` was the literal `mp4`. The amendment reflects that encoding does not exist yet and the CLI must not claim video output it cannot produce, so the `frames` variant and its `manifest` field were added to `RenderDataSchema` and the committed JSON Schema without bumping `schemaVersion` (an added union value is compatible).

  _Amended 2026-10-25:_ the `mp4` bullet now says where its payloads and Diagnostics come from: the same shared fields, with the Diagnostics and their `details` fixed by the [system FFmpeg ADR](../../render/adr/20261025-system-ffmpeg-encoder.accepted.md#encoder-diagnostics). Its `TASK-150/TASK-159` also became `TASK-159`, since TASK-150 records the decision and implements no encoder. The variant stays reserved and no producer emits it; no field, schema or `schemaVersion` change.

  _Amended 2026-10-25 (TASK-159):_ the encoder ships, so the reservations above end. `encode.ffmpeg-unsupported` and `encode.output-invalid` are no longer "reserved, not shipped" but implemented, and the `encode` row of the namespace table lists all four codes. The `render` command emits `format: "mp4"`, so the `mp4` bullet says which `--out` produces it and the `frames` bullet no longer claims to be the only variant. The variant is selected by the target's extension — an `--out` ending in `.mp4` is encoded, every other `--out` stays a PNG directory — and no `--format` flag was added, because the format is envelope data rather than a parser switch; that choice is recorded in [agent CONTEXT](../CONTEXT.md#render-output-format). No field, schema or `schemaVersion` change: the value was already in the union and the two codes were already in `DiagnosticCodeSchema`.

- `frame`: `output` is an absolute PNG file path, `format` is `png`, `frame` is a nonnegative integer Global Frame, `timeSeconds` is its finite nonnegative Presentation Time, and `width` and `height` are positive integers. Image bytes never go to stdout.
- `inspect` and `validate`: reserve a JSON object for usable data. Their tasks define the contents later without changing the envelope or Diagnostic. This placeholder is not a claim that an empty object is a complete implementation of either command.

Schemas accept POSIX, Windows drive-rooted, and Windows UNC absolute output paths without importing Node.js. Numeric integer fields use JavaScript safe integers. Objects with fixed fields reject unknown keys; `details` and deferred command data allow JSON keys. Frame/time and frame-count/duration consistency remain the Time Module's responsibility; the contract schemas do not perform time arithmetic.

### Module placement and generation

- `src/lib/diagnostic.ts`: `DiagnosticCodeSchema`, `LocationSchema`, `DiagnosticSchema`, and inferred types, exported through the package root. This is the smallest shared protocol module beside the planned `Result` utility: any context can import it without depending on agent or Node.js. It contains no diagnostic-producing domain behavior. agent owns the vocabulary, but the plain boundary data must be available to core as well.
- `src/agent/cli-output.ts`: `EnvelopeSchema`, `RenderDataSchema`, `FrameDataSchema`, and inferred types, exposed through the `/agent` package subpath. CLI-specific data does not become a core dependency. There is no duplicate handwritten TypeScript contract.
- `src/agent/cli-output-json-schema.ts`: converts the Zod envelope to draft 2020-12 JSON Schema. Because Zod cannot translate `superRefine`, the generator expresses the `ok`/error and successful-data predicates as JSON Schema conditionals. Both validators are tested against the same valid, invalid, and property-generated envelopes. The hint rule is a discriminated union and translates directly.
- `docs/contexts/agent/schema/cli-output.v1.schema.json`: committed generated schema. Regenerate with `pnpm schema:cli-output`, then `pnpm fix`. The sync test compares the parsed artifact to fresh generation, ignoring formatting only.

Zod is a production dependency (MIT, on the license allowlist); it is needed by every boundary accepting Diagnostics, not an optional rendering integration. Ajv is a development-only JSON Schema validator for parity tests.

### Compatibility

Adding a Diagnostic code is a normal compatible change: update the enum, this code reference, and the generated schema. Consumers must tolerate newly added codes within a supported schema version. Renaming or removing a code is breaking and requires a `schemaVersion` bump and amendment of this ADR. Breaking field, severity, or envelope changes follow the same versioning rule. Do not bump `schemaVersion` for an additive code or ordinary implementation work.

### Open invocation case

When argv contains `--json` but no subcommand can be identified, the envelope's `command` has no truthful value. The CLI (TASK-161) must not invent one; this needs a product-owner decision. The closed four-command enum remains unchanged here.

## Consequences

Every CLI failure remains a Diagnostic. Callers can branch on `ok`, inspect stable codes, and act on hints without parsing human text. All future commands use this contract unchanged; the CLI must enforce transport, exit codes, semantic messages, and safe exception conversion in addition to schema validation.

The committed JSON Schema is usable without TypeScript or Zod. Changes to custom refinements must update their JSON Schema conditionals and parity tests; the sync test prevents a stale artifact, not an incorrect translation by itself. Details remain extensible, while code-specific payload enforcement belongs to each producer until its payload schema is defined.

## Alternatives

- Put Diagnostic under `src/agent`: rejected because core and the other contexts cannot depend on agent.
- Put the entire envelope in `src/lib`: rejected because render/frame CLI result shapes have an agent-specific meaning and need not be shared by every context.
- Infer JSON mode from non-TTY stdout: rejected for the MVP; explicit `--json` keeps behavior predictable for pipes and agents.
- Hand-maintain TypeScript interfaces or JSON Schema: rejected because Zod is the source of truth and drift must fail a test.
