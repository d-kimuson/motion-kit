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
      aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0,adelay=<startMs>:all=1[t0]
[2:a]atrim=start=<offset>,asetpts=PTS-STARTPTS,volume=<gain>,aresample=48000,
      aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=<startMs>:all=1[t1]
[t0][t1]amix=inputs=N:duration=longest:normalize=0,asetpts=N/SR/TB,apad=whole_dur=<durationSeconds>,atrim=end=<durationSeconds>[aout]
```

- `atrim` (with `end` when `endInFrames` is declared) trims the source, `asetpts` restarts it at zero, `adelay` places it at the frame-derived start, and `amix` sums overlapping clips. `normalize=0` keeps every declared gain exactly as authored — FFmpeg's default `normalize=1` would divide each track by the number of inputs and make the mixed loudness depend on how many tracks exist.
- _Amended 2026-10-29 (TASK-241):_ After mixing, `asetpts=N/SR/TB` makes timestamps follow the mixed samples even when the first input ends early. `apad=whole_dur` fills the tail with finite silence and a final `atrim` ends audio at the Composition's exclusive end. This replaces the output-wide `-t`: at a reduced output rate it can drop the last ceiling-counted video frame. `-shortest` is also rejected because it can truncate video.
- The video input stays `pipe:0`; each audio file is one `-i` in declaration order. The output maps `0:v:0` and `[aout]`, keeps `-c:v libx264 -pix_fmt yuv420p -r <fps>` and adds `-c:a aac -b:a 192k -ar 48000`.
- **Sample rate and channels** are fixed at 48 kHz stereo for the mixed stream, the normal AAC-in-MP4 target, so no input rate or sample format leaks into the output. The channel conversion is chosen **per track from the source's own count**, which `ffprobe -select_streams a:0 -show_entries stream=channels` reports once per declared track before the encode child exists (it ships with the FFmpeg the encoder already requires; the silent path probes nothing). A **mono** source is duplicated into both output channels at unity gain by `pan=stereo|c0=c0|c1=c0`; anything else keeps `aformat=…:channel_layouts=stereo`, which is the identity for stereo and downmixes a wider layout. `aformat`'s automatic mono→stereo matrix is **constant-power** (0.7071 per channel, −3.01 dB), so leaving mono to it would make the same file render quieter as mono than as stereo and silently change the balance between clips; no compensating gain is applied anywhere. A file whose stream the probe cannot read reports no count and keeps the layout-agnostic conversion, so it still fails as `encode.ffmpeg-failed` with its stderr tail rather than as a second input error.
- Offsets cross as integer milliseconds (`Math.round(seconds * 1000)` at 48 kHz). The rounding error is at most 0.5 ms — three orders of magnitude below one frame at any supported rate — and `adelay` takes no finer unit.

**Failures.** Before the temporary sibling is created, the encoder stats and opens every resolved track and reports the first missing, non-file or unopenable path as `asset.load-failed` with `location.file` set to the reported source, `details.assets` as `[{ "kind": "audio", "source": <reported source>, "phase": "open" }]` ([contract payload](../../agent/adr/20261024-cli-output-contract.accepted.md#diagnostic)), and **no output**, with no encode child spawned (the version and encoder probes have already run). Opening the file is what makes a mode the process cannot read an input failure instead of an FFmpeg error after the first frame; `stat` alone accepts it. The reported source — in the message, in `location.file` and in `details.assets[].source` — is produced by the asset diagnostics producer's `redactAssetSource`, because a `src` written as a URL is resolved as a path and echoed: scheme, host and path stay, the query becomes a count marker, and fragments and userinfo are stripped ([CLI contract](../../agent/adr/20261024-cli-output-contract.accepted.md#diagnostic), [asset readiness](../../core/adr/20261024-asset-readiness.accepted.md)). A `render.page-error` for an invalid declaration redacts `src` the same way. No new Diagnostic code is introduced. A mix that FFmpeg rejects after starting (an unsupported codec, a corrupt file) keeps the existing `encode.ffmpeg-failed` with its stderr tail. A build without the native `aac` encoder fails the same way; the probe still checks only the version and `libx264`, because `aac` is part of every FFmpeg build motion-kit supports. A missing `ffprobe` is `encode.ffmpeg-not-found` naming that binary: without a channel count the mono conversion cannot be trusted, and the install — not the track — is what is wrong.

**Silent path.** A request with no `audio` field, or an empty array, spawns exactly the argument vector TASK-159 spawned — no `-filter_complex`, no `-map`, no `-t`, no audio codec flags, no channel probe — so a Composition without audio is byte-identical to before. `ffmpeg.test.ts` pins that vector.

**Cancellation and the temporary file** are unchanged: the same `AbortSignal` kills the child and removes the sibling. Audio adds no file and no timer of its own; its only extra processes are the one `ffprobe` per declared track, run before the sibling exists and killed by the same signal.

**No CLI flag and no envelope change.** Audio is part of the Composition, so `motion-kit render --out out.mp4` needs no new option; the `mp4` envelope's data stays as the CLI contract defines it. Reporting the track count or the mixed duration would be a contract change, and is not made here.

**Naming.** `audio` on `defineComposition` and the root-only `AudioTrack` type are this ADR's own vocabulary: audio is declared as data beside `width` and `durationInFrames`, and `audio` is the only new name a consumer writes. The QA check's `human-check` on the public shape is settled by the owner's decision that audio is **declared as data on the Composition** — the alternative "collect from a hook or a runtime registration" below is rejected — so the field and type names are kept as the task and this record state, with no rename.

## Consequences

Authors declare narration and music next to the frames, and the render places them on the frame timeline exactly. Node resolves paths, so a Composition's audio is only as portable as its `src` values; a project that moves an asset fails with `asset.load-failed`, not with silence.

The encoder now depends on FFmpeg's audio path (`atrim`, `aresample`, `aformat`, `pan`, `adelay`, `amix`, `apad`, `aac`), all present since well before the 6.0 floor, and on `ffprobe` for one channel count per declared track. _Amended 2026-10-29 (TASK-241):_ the final audio `atrim` caps the mixed stream at the Composition duration without truncating video; the final constant-rate video frame can extend past that end.

`volume: 1` means the file's own level for every declared track: a mono clip and a stereo clip at the same amplitude render at the same RMS, so mixing narration and music keeps the balance the author heard in their files. That parity is asserted against the source files' absolute RMS, not against a ratio between the clips, because a ratio cannot see a gain applied to every track.

Audio is inaudible in preview until a later task (TASK-171 excludes it), and nothing here exposes waveform data for reactive visuals. Both remain open, unblocked by this decision.

## Alternatives

- **Declare audio with seconds.** It introduces the second clock §9.6 forbids: a start written as `0.5` and a frame grid at 30000/1001 do not agree, and the Timeline Time conversion would happen in the author's head rather than in the Time Module.
- **Collect audio declarations from a hook or runtime registration in the page.** It needs a new page→Node channel and ties the data to how the component tree happens to render in one frame; a declaration on the Composition is available before any frame is captured and cannot vary with the frame order.
- **One FFmpeg pass per track, then a concat/mix pass.** Two or more children, extra temp files and a second place where offsets can drift.
- **Mix in JavaScript or a bundled audio library.** A new dependency and licence surface for something the required FFmpeg already does; §14.2's audit would have to cover it.
- **`-shortest` instead of an explicit `-t`.** It ends at the shorter stream, so one short clip would truncate the video.
- **Compensate the constant-power upmix with a per-track gain.** A ×1.414 factor behind a mono check hides FFmpeg's matrix instead of not applying it, and it fails the moment the matrix changes or a third layout appears; `pan` states the intended mapping instead.
- **Upmix from a hardcoded channel assumption.** Guessing "mono unless told otherwise" would attenuate or mono-ize a real stereo file; the count is measured per source, and a file whose stream cannot be measured keeps the layout-agnostic conversion.
- **`normalize=1` (FFmpeg's default) in `amix`.** It scales every track by `1/N`, which makes an author's declared volume depend on how many other tracks exist.
