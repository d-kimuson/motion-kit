# Encode with the user's system FFmpeg behind an Encoder port

## Context

Status: **accepted**. TASK-150 records the user's decision of 2026-10-23: Phase 1 encodes H.264 into an MP4 file with an FFmpeg binary that the user installed, behind an `Encoder` interface in `src/render/encoding`. This ADR is the write-up; TASK-159 implements the encoder and the CLI route, TASK-150 changes no code.

Forces:

- Frames already arrive as PNG bytes. `renderer.renderFrames({ from, to })` yields one `RenderedFrame` (`frame`, `width`, `height`, `png`, `diagnostics`) per frame in the half-open range, and stops at the first failure or cancellation ([render contract](../CONTEXT.md#renderer-api), [loading design](../design-doc/20261024-composition-loading.md)). The encoder therefore receives a frame stream, not a file layout; the frame-input format is fixed by that transport and is not reopened here.
- The encoder runs on the user's machine, in Node, after capture. The author's design (`docs/tmp/design.md` §9.6) makes H.264/MP4 the initial target and FFmpeg the initial candidate, deferring Mediabunny/WebCodecs to a later evaluation. §14.2 makes motion-kit itself MIT, requires the license of every dependency to be checked in CI, and names FFmpeg's LGPL/GPL configuration as a hazard.
- Failures are values. External exceptions (Playwright, FFmpeg, the file system) are converted to a `Result` with a `Diagnostic` at the Node boundary, and only the CLI throws ([coding](../../../guidelines/coding/index.md#failures-and-exceptions), [CLI output contract](../../agent/adr/20261024-cli-output-contract.accepted.md)).
- The production license allowlist admits MIT-compatible licenses only ([`scripts/check-licenses.ts`](../../../../scripts/check-licenses.ts)); an FFmpeg binary is not a package dependency, so its license stays the user's concern rather than motion-kit's distribution.

## Decision

Phase 1 encodes H.264 in MP4 by spawning **`ffmpeg` from the user's `PATH`**, behind an `Encoder` port in `src/render/encoding`. motion-kit bundles and downloads no binary and adds no encoder package dependency; a working FFmpeg is a documented prerequisite, and its absence is an actionable Diagnostic, not an install attempt.

- The binary is `ffmpeg` from `PATH`, or an explicit `ffmpegPath`. Nothing is downloaded, extracted, or vendored. `src/render/encoding` owns the whole subprocess boundary; nothing above it sees a child process or a raw exception.
- The port is probed once per CLI invocation, before the first frame is rendered: `ffmpeg -version` for a parseable version on the first line, then `ffmpeg -hide_banner -encoders` for `libx264`. The minimum is **FFmpeg 6.0** (2023-02-27) with `libx264`; a named constant in `src/render/encoding` owns the floor, so raising it is a deliberate, tested change. A binary that is too old, unparseable, or lacks `libx264` fails the same probe step instead of failing mid-render.
- Frames are consumed as the stream `renderFrames` already yields and piped to FFmpeg's stdin as an `image2pipe` PNG sequence. Phase 1 writes no intermediate frame files and does not convert to raw RGBA; the PNG transport is the input contract.
- FPS crosses as the Composition's rational (`{ numerator, denominator }`) and is passed to FFmpeg as `numerator/denominator`, never as a float. Duration comes from the Time Module, not from a second division.
- The target is written to a temporary sibling file in the destination directory and renamed onto `output` only after a successful exit; a failed, aborted, or interrupted encode leaves no partial file at the target. FFmpeg's stderr is captured (bounded tail, credential-redacted) into the Diagnostic `details`; it never inherits motion-kit's stdout, which stays reserved for the single CLI JSON envelope.
- Cancellation kills the child (bounded `SIGTERM`, then `SIGKILL`), removes the temporary file, and returns aborted control flow with no Diagnostic, matching the renderer's cancellation contract. A caller `AbortSignal` is the only cancellation source; the encoder invents no timer of its own.
- Progress is reported through an optional callback as a monotonic count of frames handed to FFmpeg, so the CLI can emit progress without parsing FFmpeg's log format.

### The port

The shape TASK-159 implements. It accepts the frame stream, the rational FPS, and the target path; it returns a `Result` and reports progress.

```ts
// src/render/encoding/encoder.ts — planned; TASK-159 implements it.
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type RenderedFrame } from '../capture/frame.ts';

/** The frame stream as `renderFrames` already yields it: PNG bytes, or the failure that stopped it. */
export type FrameStream = AsyncIterable<
  | { readonly ok: true; readonly value: RenderedFrame }
  | { readonly ok: false; readonly error: readonly Diagnostic[] }
  | { readonly ok: false; readonly aborted: true }
>;

export type EncodeProgress = {
  /** Frames handed to FFmpeg so far; monotonic and never greater than frameCount. */
  readonly encodedFrames: number;
  readonly frameCount: number;
};

export type EncodeRequest = {
  readonly frames: FrameStream;
  /** The Composition's rational rate; never a rounded float. */
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** Absolute path of the MP4 to produce. */
  readonly output: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EncodeProgress) => void;
};

export type EncodeReceipt = {
  readonly output: string;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** Derived by the Time Module from frameCount and fps. */
  readonly durationSeconds: number;
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

The stream's first failed frame ends the encode: the encoder stops reading, kills the child, removes the temporary file, and forwards that frame's Diagnostics unchanged, so a capture failure is never reported as an FFmpeg failure. A frame whose dimensions differ from the first frame is a contract violation, not a recoverable one: the viewport is fixed for a mount, so it is reported as `internal.unexpected`. `EncodeOutcome` carries `width`, `height`, `frameCount`, and `durationSeconds` because the CLI's `mp4` variant needs them ([CLI contract `render` data](../../agent/adr/20261024-cli-output-contract.accepted.md#command-data)).

### Encoder Diagnostics

All four are errors. The `hint` is one corrective sentence and carries the per-OS install command; `details` carries machine-readable facts only, never a stack.

| Failure                        | Code                        | `details`                                                         | Hint (per OS)                                                                                                                                                                                                                               |
| ------------------------------ | --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binary missing or not runnable | `encode.ffmpeg-not-found`   | `{ "binary": "ffmpeg" }`                                          | macOS `brew install ffmpeg`; Debian/Ubuntu `sudo apt install ffmpeg`; Fedora `sudo dnf install ffmpeg` (RPM Fusion); Arch `sudo pacman -S ffmpeg`; Windows `winget install --id Gyan.FFmpeg`; otherwise <https://ffmpeg.org/download.html>. |
| Too old, or no `libx264`       | `encode.ffmpeg-unsupported` | `{ "found": "4.4.2", "required": "6.0", "missing": ["libx264"] }` | Install or upgrade to FFmpeg 6.0 or newer built with `libx264`, then re-run; do not disable H.264.                                                                                                                                          |
| Non-zero exit                  | `encode.ffmpeg-failed`      | `{ "exitCode": 1, "signal": null, "stderrTail": "…" }`            | Read the reported FFmpeg error and fix the composition or the target path; re-running without a change fails the same way.                                                                                                                  |
| Exit 0 but no usable file      | `encode.output-invalid`     | `{ "output": "/abs/out.mp4", "reason": "empty" }`                 | Check free disk space and write access to the target directory; a zero-frame composition produces no video.                                                                                                                                 |

`encode.ffmpeg-not-found` and `encode.ffmpeg-failed` already exist in [`DiagnosticCodeSchema`](../../../../src/lib/diagnostic.ts); `encode.ffmpeg-unsupported` and `encode.output-invalid` are reserved here and TASK-159 adds them to that enum and to the `encode` row of the CLI output contract table. Adding a value is a compatible change that needs no `schemaVersion` bump. `encode.output-invalid` covers exit 0 with a missing, empty, or truncated target, or a written-frame count of zero; a full `ffprobe` inspection of the produced stream is hardening for a later task, not part of Phase 1.

## Consequences

motion-kit ships zero binaries, so its own license surface and install size stay at the MIT package, and §14.2's audit has nothing to redistribute. The cost lands on the user: an FFmpeg install is a real prerequisite, and its version, codec support, and encoder quality vary per machine. The probe makes that explicit once per invocation, with a code and an OS-specific hint an agent can act on without reading logs. Support questions become "which FFmpeg did the probe find" instead of an undiagnosable empty file.

The subprocess boundary has to be supervised like the other Node boundaries: never through a shell, always with piped stdin/stdout/stderr, never buffering an unbounded frame or log tail, always killing the child and removing the temporary file on abort. TASK-159 owns that, plus a probe matrix (absent binary, old version, no `libx264`, non-zero exit, empty output, abort mid-stream) and the equality of the produced file's frame count with the rendered range.

Phase 1 encodes video only. Audio, hardware encoders (VideoToolbox/NVENC), quality presets and bitrate policy, and writing the same port in a browser context are not decided here; they are TASK-159 and later planning inputs. Wiring the CLI's `render --format mp4` to this port is TASK-159's route through agent, and the `mp4` variant stays reserved until then.

## Alternatives

- **In-page WebCodecs encoding muxed with Mediabunny (Phase 5 experiment, explicitly not now).** Chromium is already running and already has the pixels, so encoding inside the capture page and muxing with Mediabunny would be the real zero-binary path: no child process, no PNG round trip through Node. It is not Phase 1. It puts H.264 support at the mercy of the browser's WebCodecs implementation and codec availability, it has to be driven from the page next to the readiness barrier and the frame deadline, and it would make the encoder a browser concern in a context that is deliberately split between the page and the Node supervisor. It becomes a Phase 5 task once the renderer and the Phase 1 encoder exist.
- **ffmpeg.wasm (`@ffmpeg/core`).** The published cores are transpiled FFmpeg and follow FFmpeg's and its libraries' licenses; the shipped cores include `x264`/`x265`, so the build is GPL, which the [allowlist](../../../../scripts/check-licenses.ts) does not admit and which would make an MIT package redistribute GPL code. Single-threaded WebAssembly is slower than native, and the multi-thread core needs cross-origin isolation and much more memory; the project itself recommends native FFmpeg outside the browser. LGPL-only cores exist (build your own core), but a core without x264 cannot produce the H.264 Phase 1 targets. Evidence: [ffmpeg.wasm overview](https://ffmpegwasm.netlify.app/docs/overview) (bundled FFmpeg/x264/x265 versions, single-thread and multi-thread cores), [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq) (license of `@ffmpeg/core`, WebAssembly performance).
- **Mediabunny (MPL-2.0) on the server.** In the browser it encodes through WebCodecs with no native dependency, but in Node it requires the `@mediabunny/server` extension, which is a thin wrapper over NodeAV — N-API bindings to FFmpeg's C API — so the native dependency stays and is merely repackaged behind a larger surface. MPL-2.0 is also outside the production allowlist, exactly as it excluded Vite 8's Lightning CSS earlier ([bundled-vite ADR](20261024-bundled-vite.accepted.md)). Evidence: [Mediabunny introduction](https://mediabunny.dev/guide/introduction) (browser-first, `@mediabunny/server` for Node), [`@mediabunny/server` README](https://github.com/Vanilagy/mediabunny/blob/main/packages/server/README.md) (NodeAV/FFmpeg bindings, MPL-2.0), [Mediabunny license](https://github.com/Vanilagy/mediabunny#license).
- **Bundle or download an FFmpeg binary (for example `ffmpeg-static`).** This buys a zero-setup install but adds per-platform redistribution, LGPL/GPL configuration choices, and codec patent conditions to motion-kit's own distribution, and it would make the package's install size and CI matrix grow for a tool the user's OS usually packages. It contradicts §14.2 and the user's decision.
- **Write the encoder (port x264, or a pure-TypeScript H.264 encoder).** Duplicates a mature library and would take months to reach the quality FFmpeg already provides; the coding guidelines prefer a mature library, and the existing library table already names FFmpeg behind a Node wrapper for encoding.
