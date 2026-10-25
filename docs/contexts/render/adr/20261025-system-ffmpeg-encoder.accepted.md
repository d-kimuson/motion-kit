# Encode with the user's system FFmpeg behind an Encoder port

## Context

Status: **accepted**. TASK-150 records the user's decision of 2026-10-23: Phase 1 encodes H.264 into an MP4 file with an FFmpeg binary that the user installed, behind an `Encoder` interface in `src/render/encoding`. This ADR is the write-up; TASK-159 implements the encoder and the CLI route, TASK-150 changes no code.

Forces:

- Frames already arrive as PNG bytes. `renderer.renderFrames({ from, to })` yields one `FrameCaptureResult` per frame in the half-open range: a `RenderedFrame` (`frame`, `width`, `height`, `png`, `diagnostics`) when that frame captured, or the failed frame's Diagnostics as the element, and the stream returns immediately after the first failure or cancellation ([`renderFrames`](../../../../src/render/renderer.ts), [render contract](../CONTEXT.md#renderer-api), [loading design](../design-doc/20261024-composition-loading.md)). The encoder therefore receives a frame stream, not a file layout; the frame-input format is fixed by that transport and is not reopened here.
- The encoder runs on the user's machine, in Node, after capture. The author's design (`docs/tmp/design.md` §9.6) makes H.264/MP4 the initial target and FFmpeg the initial candidate, deferring Mediabunny/WebCodecs to a later evaluation. §14.2 makes motion-kit itself MIT, requires the license of every dependency to be checked in CI, and names FFmpeg's LGPL/GPL configuration as a hazard.
- §14.1 sets the portability goals the decision has to be measured against: "Chromium 等の必要環境を自動準備" (prepare the required environment automatically), "ゼロ手動セットアップに近い体験" (near-zero manual setup), and "完全なゼロダウンロードは要求しない" (no complete zero-download requirement). Requiring the user to install an encoder by hand gives up the first of those, so the departure is recorded under Decision and Consequences rather than left implicit.
- Failures are values. External exceptions (Playwright, FFmpeg, the file system) are converted to a `Result` with a `Diagnostic` at the Node boundary, and only the CLI throws ([coding](../../../guidelines/coding/index.md#failures-and-exceptions), [CLI output contract](../../agent/adr/20261024-cli-output-contract.accepted.md)).
- The production license allowlist admits MIT-compatible licenses only ([`scripts/check-licenses.ts`](../../../../scripts/check-licenses.ts)); an FFmpeg binary is not a package dependency, so its license stays the user's concern rather than motion-kit's distribution.

## Decision

Phase 1 encodes H.264 in MP4 by spawning **`ffmpeg` from the user's `PATH`**, behind an `Encoder` port in `src/render/encoding`. motion-kit bundles and downloads no binary and adds no encoder package dependency; a working FFmpeg is a documented prerequisite, and its absence is an actionable Diagnostic, not an install attempt. That is a deliberate departure from §14.1's automatic environment preparation — the owner accepted it on 2026-10-23, and only for the encoder — while §14.1's "no complete zero-download requirement" and its local-first, no-cloud goals are kept.

- The binary is `ffmpeg` from `PATH`, or an explicit `ffmpegPath`. Nothing is downloaded, extracted, or vendored. `src/render/encoding` owns the whole subprocess boundary; nothing above it sees a child process or a raw exception.
- The port is probed once per CLI invocation, before the first frame is rendered: `ffmpeg -version` for a parseable version on the first line, then `ffmpeg -hide_banner -encoders` for `libx264`. The minimum is **FFmpeg 6.0** (2023-02-27) with `libx264`; a named constant in `src/render/encoding` owns the floor, so raising it is a deliberate, tested change. A binary that is too old, unparseable, or lacks `libx264` fails the same probe step instead of failing mid-render.
- Frames are consumed as the stream `renderFrames` already yields and piped to FFmpeg's stdin as an `image2pipe` PNG sequence. Phase 1 writes no intermediate frame files and does not convert to raw RGBA; the PNG transport is the input contract.
- FPS crosses as the Composition's rational (`{ numerator, denominator }`) and is passed to FFmpeg as `numerator/denominator`, never as a float. The total crosses as the descriptor's `durationInFrames` (`src/core/composition/registry.ts`), because the frame stream itself is an unbounded `AsyncIterable` and a caller cannot count its length in advance. Duration comes from the Time Module, not from a second division.
- The target is written to a temporary sibling file in the destination directory and renamed onto `output` only after a successful exit; a failed, aborted, or interrupted encode leaves no partial file at the target. The sibling is created before the child starts — under a unique name, with an exclusive create, so an existing file is never reused — which is what lets a destination directory that cannot take it (`EACCES`, `ENOSPC`) fail the encode before FFmpeg runs instead of surfacing as an FFmpeg exit. The child is then invoked with **`-y`**: because stdin is the frame pipe, FFmpeg cannot ask whether to overwrite, and its default is to refuse — on FFmpeg 9.0.1 that refusal prints `File '…' already exists. Exiting.`, exits **0**, and leaves the zero-byte sibling untouched — so without overwrite no run would ever produce an MP4. Enabling overwrite is safe precisely because the only file it truncates is the sibling motion-kit created a moment earlier; `output` is never passed to the child and is written only by the rename. FFmpeg's stderr is captured (bounded tail, credential-redacted) into the Diagnostic `details`; it never inherits motion-kit's stdout, which stays reserved for the single CLI JSON envelope.
- Cancellation kills the child (bounded `SIGTERM`, then `SIGKILL`), removes the temporary file, and returns aborted control flow with no Diagnostic, matching the renderer's cancellation contract. A caller `AbortSignal` is the only cancellation source the encoder acts on; it invents no timer of its own.
- Progress is reported through an optional callback as the count of frames handed to FFmpeg so far, measured against the request's total, so the CLI can emit progress without parsing FFmpeg's log format.

### The port

The shape TASK-159 implements. It accepts the frame stream, the Composition's rational FPS and total frame count, and the target path; it returns a `Result` and reports progress against that total.

```ts
// src/render/encoding/encoder.ts — planned; TASK-159 implements it.
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type FrameCaptureResult } from '../capture/frame.ts';

/** Not a new type: exactly the stream `renderFrames` already yields, re-aliased so it cannot
 * drift from the public `FrameCaptureResult` (exported from the `./render` subpath). */
export type FrameStream = AsyncIterable<FrameCaptureResult>;

export type EncodeProgress = {
  /** Frames handed to FFmpeg so far; monotonic and never greater than `frameCount`. */
  readonly encodedFrames: number;
  /** The request's total, echoed; not a count of the stream. */
  readonly frameCount: number;
};

export type EncodeRequest = {
  readonly frames: FrameStream;
  /** The Composition's rational rate; never a rounded float. */
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** The descriptor's `durationInFrames`: the total `frames` is expected to yield, and the
   * bound `EncodeProgress` and the receipt are measured against. Zero is legal (see Diagnostics). */
  readonly frameCount: number;
  /** Absolute path of the MP4 to produce. */
  readonly output: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EncodeProgress) => void;
  // TASK-171 adds the audio track here (`audioTracks?: …`), on this same rational timebase.
  // TASK-159 implements no audio and only leaves the field's attachment point open.
};

export type EncodeReceipt = {
  readonly output: string;
  /** Equal to the request's `frameCount`; the encoder counts what it wrote. */
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** Derived by the Time Module from frameCount and fps. */
  readonly durationSeconds: number;
  /** The warnings the encoded frames carried, in frame order and unchanged. */
  readonly diagnostics: readonly Diagnostic[];
};

/** Several Diagnostics without a second result type; cancellation aborts instead. */
export type EncodeOutcome =
  | Result<EncodeReceipt, readonly Diagnostic[]>
  | { readonly ok: false; readonly aborted: true };

export type Encoder = {
  encode: (request: EncodeRequest) => Promise<EncodeOutcome>;
};

/** Probes PATH once per invocation; its Result is how a missing or too-old binary reports. */
export type FfmpegEncoderOptions = {
  readonly ffmpegPath?: string;
  readonly signal?: AbortSignal;
};
export const createFfmpegEncoder: (
  options?: FfmpegEncoderOptions,
) => Promise<Result<Encoder>>;
```

The stream's first failed frame ends the encode: the encoder stops reading, kills the child, removes the temporary file, and forwards that frame's Diagnostics unchanged, so a capture failure is never reported as an FFmpeg failure. `FrameCaptureResult`'s third variant — `{ ok: false, aborted: true }` — is not one of those failures even when it arrives as an element of a stream the caller assembled rather than from a cancellation motion-kit itself observed: it ends the encode as aborted control flow, with no Diagnostic and never as `internal.unexpected`, exactly like the abort above (kill the child, remove the temporary sibling, return `{ ok: false, aborted: true }`). A frame whose dimensions differ from the first frame is a contract violation, not a recoverable one: the viewport is fixed for a mount, so it is reported as `internal.unexpected`. `EncodeOutcome` carries `width`, `height`, `frameCount`, and `durationSeconds` because the CLI's `mp4` variant needs them ([CLI contract `render` data](../../agent/adr/20261024-cli-output-contract.accepted.md#command-data)). The receipt's `frameCount` is the request's total, confirmed against the frames the encoder actually handed over. A shortfall must not be reported as success: when the stream ends before `frameCount` with no failed frame and no cancellation, the encoder removes the temporary file and returns `internal.unexpected`, because `frameCount` is the descriptor's `durationInFrames` and a silently short stream is a violated invariant — the same class as the dimension mismatch above — not an FFmpeg failure and not a usable result.

_Amended 2026-10-25 (review):_ the receipt carries the encoded frames' Diagnostics, so a successful encode does not lose the warnings capture already produced. `EncodeReceipt.diagnostics` is the concatenation, in frame order and unchanged, of the `diagnostics` of every frame the encoder handed to the child; the CLI reports it as the `mp4` envelope's `diagnostics` exactly as the frames route reports each frame's warnings. The envelope field already exists and the contract already requires "warnings and infos on success" ([CLI contract](../../agent/adr/20261024-cli-output-contract.accepted.md#output-and-exit-codes)), so this adds no field, no schema and no `schemaVersion` change. An aborted or failed encode still carries no receipt: cancellation is aborted control flow and a failure is a Diagnostic array.

**Audio has no implementation and one visible seam.** Phase 1's port is video-only; TASK-171 ("Mux audio tracks into the rendered MP4", blocked by TASK-159) adds audio, and TASK-159's job is to leave the attachment point open as the commented `audioTracks` field in `EncodeRequest` shows. The seam is the shared rational timebase §9.6 requires: `fps` and `frameCount` already describe the whole `[0, frameCount / fps)` interval, so a track added later muxes onto that same interval inside the same `encode` call and child invocation instead of inventing a second clock or a second pass. Nothing about track selection, formats, or mixing is decided here.

**The port stays internal.** `Encoder`, `EncodeRequest`, `EncodeReceipt`, `EncodeProgress`, `EncodeOutcome` and `src/render/encoding` are not exported from the `./render` subpath in Phase 1: that subpath exports only `createRenderer` and its public types ([render contract](../CONTEXT.md#renderer-api)), and internal types named in the Ubiquitous Language have a precedent in `LoadingSession`. The CLI/agent route TASK-159 adds is the public entry; widening the subpath is a separate, deliberate change to that contract, not a side effect of the encoder.

### Encoder Diagnostics

All four are errors. The `hint` is one corrective sentence an agent can act on without reading logs; only `encode.ffmpeg-not-found` is per-OS, because only the install command differs by platform, while the other three carry a platform-independent corrective action. `details` carries machine-readable facts only, never a stack.

| Failure                                                                                         | Code                        | `details`                                                         | Hint                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary missing or not runnable                                                                  | `encode.ffmpeg-not-found`   | `{ "binary": "ffmpeg" }`                                          | Per OS: macOS `brew install ffmpeg`; Debian/Ubuntu `sudo apt install ffmpeg`; Fedora `sudo dnf install ffmpeg` (RPM Fusion); Arch `sudo pacman -S ffmpeg`; Windows `winget install --id Gyan.FFmpeg`; otherwise <https://ffmpeg.org/download.html>. |
| Too old, or no `libx264`                                                                        | `encode.ffmpeg-unsupported` | `{ "found": "4.4.2", "required": "6.0", "missing": ["libx264"] }` | Install or upgrade to FFmpeg 6.0 or newer built with `libx264`, then re-run; do not disable H.264.                                                                                                                                                  |
| Non-zero exit after at least one frame                                                          | `encode.ffmpeg-failed`      | `{ "exitCode": 1, "signal": null, "stderrTail": "…" }`            | Read the reported FFmpeg error and fix the composition or the target path; re-running without a change fails the same way.                                                                                                                          |
| No usable output: zero frames, an unwritable target directory, or a zero-byte temporary sibling | `encode.output-invalid`     | `{ "output": "/abs/out.mp4", "reason": "no-frames" }`             | Check write access and free disk space in the target directory; a zero-frame composition produces no video.                                                                                                                                         |

`encode.ffmpeg-not-found` and `encode.ffmpeg-failed` already exist in [`DiagnosticCodeSchema`](../../../../src/lib/diagnostic.ts); `encode.ffmpeg-unsupported` and `encode.output-invalid` are reserved here, and TASK-159 adds them to that enum and regenerates the committed JSON Schema. Adding a value is a compatible change that needs no `schemaVersion` bump.

**Zero frames is `encode.output-invalid`, never `encode.ffmpeg-failed`.** `durationInFrames: 0` is a legal Composition, and `renderFrames` over the empty valid range yields no frames, so an empty `image2pipe` stdin makes FFmpeg exit non-zero. The encoder decides from its own count, not from the child's exit status: with `frameCount` known up front, a request that encodes zero frames reports `encode.output-invalid` with `reason: "no-frames"`, and the `ffmpeg-failed` mapping applies only to a non-zero exit of an encode that handed at least one frame to the child.

**`reason` describes the temporary sibling, never `output`.** A failed encode leaves nothing at the target, so the artifact Phase 1 inspects is the temporary sibling it writes beside `output`; `details.output` still names the final target, because that is the path the user asked for and the one the hint's corrective action is about. The values are `"no-frames"` (no frame ever reached the child), `"unwritable"` (the temporary sibling could not be created in the destination directory — `EACCES` or `ENOSPC` at creation — so no child was started) and `"empty"` (the child exited 0 and wrote nothing: the temporary sibling is zero bytes). They are disjoint, and each follows from one observation taken before any other can apply: `"no-frames"` from the request's `frameCount` before the sibling is created, `"unwritable"` from that creation attempt before the child starts, and `"empty"` from a `stat` of the sibling after a zero exit. There is no `"missing"` value, because a successful exit cannot leave the sibling absent: motion-kit created it and the child runs with `-y`, which truncates that file rather than deleting it, so a zero-byte sibling and a written file are the only post-exit-0 outcomes; a sibling that vanished anyway is a violated invariant and reports `internal.unexpected`, like the short stream above. There is no `truncated` reason: Phase 1 cannot tell a complete MP4 from a partial one without an `ffprobe` inspection, which is hardening for a later task, so a non-empty temporary file over a successful exit is accepted. A non-zero exit maps to `encode.ffmpeg-failed` with the stderr tail whatever the temporary sibling looks like, since that exit and its diagnostics are the only evidence of why FFmpeg gave up.

_Amended 2026-10-25 (review):_ a rename that the destination refuses is not `"unwritable"`. `"unwritable"` is the pre-spawn observation that no child was started, and this failure happens after the child ran and wrote a non-empty sibling, so reusing it would break the reason's own definition for an agent that branches on `reason`. The rename failure is reported as `internal.unexpected` — a target path that accepts the sibling but refuses it back, such as `--out` naming an existing directory, is a violated invariant rather than one of the three observations above — and the sibling is removed as for any other failure. The reason set stays three values.

The two reserved codes belong to the CLI output contract's `details` vocabulary, so the [contract](../../agent/adr/20261024-cli-output-contract.accepted.md#diagnostic) documents all four `encode.*` payloads before implementation and TASK-159's rollout is three artifacts in one change: the enum in `src/lib/diagnostic.ts`, the committed generated schema `docs/contexts/agent/schema/cli-output.v1.schema.json` regenerated with `pnpm schema:cli-output` then `pnpm fix` (a sync test compares it with fresh generation), and the contract's own code reference — the `encode` row of its namespace table.

## Consequences

motion-kit ships zero binaries, so its own license surface and install size stay at the MIT package, and §14.2's audit has nothing to redistribute. The cost lands on the user: an FFmpeg install is a real prerequisite, and its version, codec support, and encoder quality vary per machine. That is the accepted §14.1 departure — the owner traded "Chromium 等の必要環境を自動準備" and near-zero manual setup for an encoder motion-kit does not ship, and decided on 2026-10-23 that the trade is worth it. The probe makes the departure explicit once per invocation, with a code and a corrective hint an agent can act on without reading logs, which is why the CLI prepares nothing automatically: it is the same documented-prerequisite pattern as the browser (`render.browser-launch-failed` names `pnpm exec playwright install chromium`). Support questions become "which FFmpeg did the probe find" instead of an undiagnosable empty file.

The subprocess boundary has to be supervised like the other Node boundaries: never through a shell, always with piped stdin/stdout/stderr, never buffering an unbounded frame or log tail, always killing the child and removing the temporary file on abort. TASK-159 owns that, plus a probe matrix (absent binary, old version, no `libx264`, non-zero exit, unwritable target directory, a zero-byte temporary sibling after a successful exit, zero-frame composition, a stream short of `frameCount`, an aborted element from a caller-assembled stream, abort mid-stream) and the equality of the produced file's frame count with the rendered range.

Phase 1 encodes video only. TASK-159 implements no audio, and audio muxing is **TASK-171** ("Mux audio tracks into the rendered MP4", blocked by TASK-159); the only obligation here is the seam described above, which the shared rational timebase (§9.6) already gives. Hardware encoders (VideoToolbox/NVENC), quality presets and bitrate policy, and writing the same port in a browser context are not decided here and are not on any task yet. Wiring the CLI's `render` command to this port is TASK-159's route through agent; TASK-159 also chooses the user-facing flag for it and records that choice in `docs/contexts/agent/CONTEXT.md`, because `format` is envelope data ([CLI contract `render` data](../../agent/adr/20261024-cli-output-contract.accepted.md#command-data)), not a flag this ADR can fix. The `mp4` variant stays reserved until a producer emits it.

## Alternatives

- **In-page WebCodecs encoding muxed with Mediabunny (Phase 5 experiment, explicitly not now).** Chromium is already running and already has the pixels, so encoding inside the capture page and muxing with Mediabunny would be the real zero-binary path: no child process, no PNG round trip through Node. It is not Phase 1. It puts H.264 support at the mercy of the browser's WebCodecs implementation and codec availability, it has to be driven from the page next to the readiness barrier and the frame deadline, and it would make the encoder a browser concern in a context that is deliberately split between the page and the Node supervisor. It becomes a Phase 5 task once the renderer and the Phase 1 encoder exist.
- **ffmpeg.wasm (`@ffmpeg/core`).** The published cores are transpiled FFmpeg and follow FFmpeg's and its libraries' licenses; the shipped cores include `x264`/`x265`, so the build is GPL, which the [allowlist](../../../../scripts/check-licenses.ts) does not admit and which would make an MIT package redistribute GPL code. Single-threaded WebAssembly is slower than native, and the multi-thread core needs cross-origin isolation and much more memory; the project itself recommends native FFmpeg outside the browser. An LGPL configuration is possible if motion-kit builds the core itself, and H.264 capability is not what blocks it: FFmpeg can encode H.264 from an LGPL build through `libopenh264` (OpenH264, BSD-licensed), so losing `x264` costs quality, profiles and the shipped-core shortcut rather than H.264 output. What does not work is everything else about that route: it means compiling, publishing and supporting motion-kit's own WebAssembly FFmpeg instead of spawning the binary the user's OS already packages, OpenH264's royalty-free binary distribution is Cisco's so a self-built core leaves the patent question to whoever builds it, and the memory and cross-origin-isolation costs remain. Evidence: [ffmpeg.wasm overview](https://ffmpegwasm.netlify.app/docs/overview) (bundled FFmpeg/x264/x265 versions, single-thread and multi-thread cores), [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq) (license of `@ffmpeg/core`, WebAssembly performance).
- **Mediabunny (MPL-2.0) on the server.** In the browser it encodes through WebCodecs with no native dependency, but in Node it requires the `@mediabunny/server` extension, which is a thin wrapper over NodeAV — N-API bindings to FFmpeg's C API — so the native dependency stays and is merely repackaged behind a larger surface. MPL-2.0 is also outside the production allowlist, exactly as it excluded Vite 8's Lightning CSS earlier ([bundled-vite ADR](20261024-bundled-vite.accepted.md)). Evidence: [Mediabunny introduction](https://mediabunny.dev/guide/introduction) (browser-first, `@mediabunny/server` for Node), [`@mediabunny/server` README](https://github.com/Vanilagy/mediabunny/blob/main/packages/server/README.md) (NodeAV/FFmpeg bindings, MPL-2.0), [Mediabunny license](https://github.com/Vanilagy/mediabunny#license).
- **Bundle or download an FFmpeg binary (for example `ffmpeg-static`).** This buys a zero-setup install but adds per-platform redistribution, LGPL/GPL configuration choices, and codec patent conditions to motion-kit's own distribution, and it would make the package's install size and CI matrix grow for a tool the user's OS usually packages. It contradicts §14.2 and the user's decision.
- **Write the encoder (port x264, or a pure-TypeScript H.264 encoder).** Duplicates a mature library and would take months to reach the quality FFmpeg already provides; the coding guidelines prefer a mature library, and the existing library table already names FFmpeg behind a Node wrapper for encoding.
