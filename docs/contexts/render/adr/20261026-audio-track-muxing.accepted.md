# Mux Composition-declared audio tracks into the MP4 inside the Encoder

## Context

Status: **accepted**. TASK-171 adds the first media feature after the silent pipeline: a Composition declares voice lines and background music as data, and `motion-kit render` produces an MP4 whose audio is placed on the same timeline as the frames.

Forces:

- The [system FFmpeg encoder ADR](20261025-system-ffmpeg-encoder.accepted.md) already reserves the attachment point — the commented `audioTracks` field of `EncodeRequest` — and fixes the surrounding rules: one child invocation per render, PNG frames on stdin, a temporary sibling renamed only on success, `-y`, and cancellation that kills the child. Audio must not add a second pass, a second clock, or a second temp file.
- `docs/tmp/design.md` §9.6 requires a common Timeline Time for video and audio, and leaves audio-reactive visuals (`useAudioData()`) for later. Frame timing therefore stays the single source of truth: audio is positioned by frame-derived seconds from the Time Module, never by a duration declared in seconds.
- The page cannot resolve or read files; Node owns every path and every child process (trust model in [CONTEXT](../CONTEXT.md#trust-model)). So audio declarations must reach Node as **data in the descriptor that already crosses the page boundary** — `defineComposition` → `registry.listCompositions()` → `descriptorSchema` ([`src/lib/loading-protocol.ts`](../../../../src/lib/loading-protocol.ts)) — instead of a new DOM/RPC channel.
- Failures are values ([coding](../../../guidelines/coding/index.md#failures-and-exceptions)). A missing audio file is a user-fixable input problem, not an invariant: the contract's `asset.load-failed` already owns it ([CLI contract](../../agent/adr/20261024-cli-output-contract.accepted.md#diagnostic)).
- A Composition without audio must keep producing exactly what it produced before this task — same arguments, same bytes — so adding the feature cannot silently change existing renders.
- Out of scope, and recorded as such: in-browser preview audio, audio-reactive visuals, and asset diagnostics beyond a missing file.

## Decision

**Declaration channel.** `defineComposition` accepts an optional `audio: AudioTrack[]`, validated at declaration like every other descriptor field and carried as plain frozen data on `CompositionDescriptor`. `descriptorSchema` gains an optional `audio` array, so the existing `listCompositions` transport delivers it to Node with no new page API, no hook, no DOM observation and no evaluation of the component.

```ts
type AudioTrack = {
  /** File path, resolved against the project root; an absolute path is used as given. */
  readonly src: string;
  /** Timeline frame where the clip starts. Defaults to 0. */
  readonly startInFrames?: number;
  /** Exclusive timeline frame where the clip stops. Defaults to the source's natural end. */
  readonly endInFrames?: number;
  /** Source frame to read from, trimming the head of the clip. Defaults to 0. */
  readonly offsetInFrames?: number;
  /** Linear gain; 1 is unchanged, 0 is silent. Defaults to 1. */
  readonly volume?: number;
};
```

Times are **frame counts**, not seconds: the Time Module converts each one to seconds exactly once, inside the encoder (`frameToTime` + `toSeconds`), so audio and frames cannot disagree about the timeline. An invalid declaration (`endInFrames <= startInFrames`, a negative or non-integer frame, a negative or non-finite volume) is a declaration failure at `defineComposition`, reported as `render.page-error` like invalid width/height/FPS — not a silent clamp. A volume of exactly `0` is valid and renders that clip silent.

**Path resolution.** The encoder resolves `src` against the request's `projectRoot` (the CLI's working directory) and treats absolute paths as given. Resolution happens in Node at encode time; nothing about a path is interpreted in the page.

**Mixing.** The declared tracks are muxed in the **same child invocation** as the frames, through one `-filter_complex` graph:

```text
[1:a]atrim=start=<offset>,asetpts=PTS-STARTPTS,volume=<gain>,aresample=48000,
      aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=<startMs>:all=1[t0]
[t0][t1]amix=inputs=N:duration=longest:normalize=0,apad[aout]
```

- `atrim` (with `end` when `endInFrames` is declared) trims the source, `asetpts` restarts it at zero, `adelay` places it at the frame-derived start, and `amix` sums overlapping clips. `normalize=0` keeps every declared gain exactly as authored — FFmpeg's default `normalize=1` would divide each track by the number of inputs and make the mixed loudness depend on how many tracks exist.
- `apad` fills the tail with silence and the **output `-t <durationSeconds>`** (derived from `frameCount` and fps, never from a second duration declaration) ends both streams at the Composition's exclusive end. `-shortest` is rejected: a single short track would cut the video.
- The video input stays `pipe:0`; each audio file is one `-i` in declaration order. The output maps `0:v:0` and `[aout]`, keeps `-c:v libx264 -pix_fmt yuv420p -r <fps>` and adds `-c:a aac -b:a 192k -ar 48000`.
- **Sample rate** is fixed at 48 kHz stereo for the mixed stream, the normal AAC-in-MP4 target. `aresample`/`aformat` normalize any input rate, format and channel count (mono is upmixed), so a track's own format never leaks into the output.
- Offsets cross as integer milliseconds (`Math.round(seconds * 1000)` at 48 kHz). The rounding error is at most 0.5 ms — three orders of magnitude below one frame at any supported rate — and `adelay` takes no finer unit.

**Failures.** Before the temporary sibling is created, the encoder stats every resolved track and reports the first missing or non-file path as `asset.load-failed` with `location.file` set to the resolved path, `details.assets` as `[{ "kind": "audio", "source": <resolved path>, "phase": "open" }]` ([contract payload](../../agent/adr/20261024-cli-output-contract.accepted.md#diagnostic)), and **no output**, with no child spawned. No new Diagnostic code is introduced. A mix that FFmpeg rejects after starting (an unsupported codec, a corrupt file) keeps the existing `encode.ffmpeg-failed` with its stderr tail. A build without the native `aac` encoder fails the same way; the probe still checks only the version and `libx264`, because `aac` is part of every FFmpeg build motion-kit supports.

**Silent path.** A request with no `audio` field, or an empty array, spawns exactly the argument vector TASK-159 spawned — no `-filter_complex`, no `-map`, no `-t`, no audio codec flags — so a Composition without audio is byte-identical to before. `ffmpeg.test.ts` pins that vector.

**Cancellation and the temporary file** are unchanged: the same `AbortSignal` kills the child and removes the sibling, and audio adds no process, file or timer of its own.

**No CLI flag and no envelope change.** Audio is part of the Composition, so `motion-kit render --out out.mp4` needs no new option; the `mp4` envelope's data stays as the CLI contract defines it. Reporting the track count or the mixed duration would be a contract change, and is not made here.

## Consequences

Authors declare narration and music next to the frames, and the render places them on the frame timeline exactly. Node resolves paths, so a Composition's audio is only as portable as its `src` values; a project that moves an asset fails with `asset.load-failed`, not with silence.

The encoder now depends on FFmpeg's audio path (`atrim`, `aresample`, `aformat`, `adelay`, `amix`, `apad`, `aac`), all present since well before the 6.0 floor. The frame-derived `-t` is what makes the audio stream's duration equal the video's; a Composition whose audio outlasts its frames is cut at the end rather than extending the video.

Audio is inaudible in preview until a later task (TASK-171 excludes it), and nothing here exposes waveform data for reactive visuals. Both remain open, unblocked by this decision.

## Alternatives

- **Declare audio with seconds.** It introduces the second clock §9.6 forbids: a start written as `0.5` and a frame grid at 30000/1001 do not agree, and the Timeline Time conversion would happen in the author's head rather than in the Time Module.
- **Collect audio declarations from a hook or runtime registration in the page.** It needs a new page→Node channel and ties the data to how the component tree happens to render in one frame; a declaration on the Composition is available before any frame is captured and cannot vary with the frame order.
- **One FFmpeg pass per track, then a concat/mix pass.** Two or more children, extra temp files and a second place where offsets can drift.
- **Mix in JavaScript or a bundled audio library.** A new dependency and licence surface for something the required FFmpeg already does; §14.2's audit would have to cover it.
- **`-shortest` instead of an explicit `-t`.** It ends at the shorter stream, so one short clip would truncate the video.
- **`normalize=1` (FFmpeg's default) in `amix`.** It scales every track by `1/N`, which makes an author's declared volume depend on how many other tracks exist.
