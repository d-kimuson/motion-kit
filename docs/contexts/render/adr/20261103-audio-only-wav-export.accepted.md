# Export the mixed audio of a Composition to a WAV without capturing a frame

## Context

Checking the loudness (RMS), the level balance between two clips, or what whisper hears in a narration currently means rendering the whole MP4: 2.6–6 minutes for a full-length Composition, almost all of it frame capture and H.264. The audio alone is enough for those checks, and it is already mixed in the encoder's single `-filter_complex` graph ([audio muxing ADR](20261026-audio-track-muxing.accepted.md)).

Forces:

- **One mix, not two.** The WAV must hold exactly what the MP4's audio holds, or a level measured on it says nothing about the video. The product owner decided that the encoder's own `audioFilterGraph` (and `clipAudioTracks` for a range) is the only mix implementation; the "single clock, single pass" principle of the audio muxing ADR stays intact.
- **The range already exists.** `--from`/`--to` were added for video by the [render frame range ADR](../../agent/adr/20261103-render-frame-range.accepted.md), which requires `src/cli/range.ts` to be reused rather than re-implemented. The audio of a range is the declared tracks re-expressed against the range start, in frames.
- **The resolved descriptor lives in the page.** Audio is declared as data on `defineComposition` and crosses to Node on the descriptor; the length a render uses is the one `resolveMetadata` resolved from the validated props ([props-driven metadata ADR](../../core/adr/20261103-props-driven-metadata.accepted.md)), which runs inside the page realm. Node never imports the entry: the [loading contract](../../design-doc/20261024-composition-loading.md) keeps Node-owned generators out of the browser import graph, and the bundled-Vite adapter rejects a second loader or a private path. **This departs from the wording of TASK-249 Verification (1)**, which asks the export to complete "without launching the browser and without capturing frames": the frame half is met, the browser half is not. The task text names no fallback, so this is a deviation the product owner is asked to accept, argued in [One realm, no frame](#decision) and measured in [Consequences](#consequences).
- **A silent artifact must not be an answer.** A Composition that declares no audio has nothing to mix; writing a silent WAV would look like a successful check of audio that does not exist.
- **Failures are values** ([coding](../../../guidelines/coding/index.md#failures-and-exceptions)), and the CLI contract already owns the codes for a missing asset, a missing binary and a refused target ([CLI output contract](../../agent/adr/20261024-cli-output-contract.accepted.md)).

## Decision

**The target's extension selects the audio export.** `motion-kit render <entry> --out <file>.wav` writes the Composition's mixed audio alone. There is no `--audio-only` flag and no `audio` subcommand: the CLI already selects the artifact by `--out` (`.mp4` is video, anything else is a PNG directory), so the third format joins that one rule instead of adding a second way to say what to write. `--from`/`--to` apply unchanged and are resolved by `src/cli/range.ts` against the descriptor's own `durationInFrames`.

**The video-only options are rejected, including `--concurrency`.** `--video-crf`, `--video-bitrate`, `--scale` and `--fps` already require an `.mp4` target; `--concurrency` joins them for a `.wav` target with its own hint, because an audio export opens one realm and captures nothing for a pool to share. The rejection happens before a browser opens.

**One realm, no frame.** The export opens one Renderer (`createRenderer`, not the pool), reads the mounted descriptor, and never calls `renderFrame`/`renderFrames`. Chromium is launched because the resolved descriptor — the declared `audio` array and the props-resolved `durationInFrames` — exists only in the page realm, as the forces above record. This is the one place the export does not meet TASK-249 Verification (1) as written ("without launching the browser and without capturing frames"): no frame is captured, one realm is mounted, and the alternative below would resolve metadata outside the page. A scene that throws while rendering proves the frame half: it fails the `.mp4` route and does not affect the `.wav` route.

**The mix is the encoder's.** The export runs one FFmpeg child with the tracks as its inputs (`audioInputArguments`) and `audioFilterGraph(tracks, durationSeconds, 0)`, the same graph the MP4's audio uses with the video stream at input 0; the graph takes the first track's input index as a parameter rather than growing a second copy. The tracks are resolved by `resolveAudioTracks` — which validates every declared `src` and re-expresses the kept clips through `clipAudioTracks` — and the interval is decided by `audioRangeFor`, the same rule the MP4 encode reads, so a range that covers the whole Composition clips nothing on either artifact. The channel probe (`ffprobe`) is the encoder's, so a mono clip keeps its level here exactly as it does in the MP4.

**Output format: 48 kHz, stereo, signed 16-bit PCM (`pcm_s16le`).** 48 kHz stereo is the mixed stream's own shape, so the WAV and the decoded MP4 audio are directly comparable sample for sample. 16 bits is what whisper and every loudness tool consume, it halves the file, and 24 bits would claim a precision neither the sources nor the 192 kbit/s AAC carry. The graph's final `atrim` ends the file at the artifact duration, so a 0.2 s range writes exactly 9600 samples.

**`render.no-audio` is the one new Diagnostic code.** A Composition whose `audio` is absent or empty fails with it (severity `error`, exit `1`, `location.compositionId`) after the mount and before any file or child exists, so a silent WAV is never produced silently. It is additive, so `schemaVersion` stays `1`. A Composition that _does_ declare audio and a range that keeps none of it writes a silent WAV with `trackCount: 0`: that is what the MP4's audio for the same range holds, and the count says so instead of hiding it.

**Envelope data.** `render`'s `data` gains a `format: "wav"` variant carrying `output`, `sampleRate`, `channels`, `bitDepth`, `durationSeconds`, `trackCount` (clips the range kept and mixed) and the same `range` object the other variants carry. No frame count or resolution is reported, because the artifact has neither.

**Failures reuse the encoder's vocabulary.** A missing, non-file or unopenable `src` is `asset.load-failed` with the redacted source in `location.file` and `details.assets`, reported before the temporary sibling exists. A missing binary is `encode.ffmpeg-not-found`, a binary older than 6.0 `encode.ffmpeg-unsupported`, a non-zero exit `encode.ffmpeg-failed` with its stderr tail, and a target the sibling cannot be created in or one that comes back zero bytes `encode.output-invalid` with `reason: "unwritable"` or `"empty"`. The probe checks the **version only**: the export encodes no video, so a build without `libx264` can still write PCM, and asking for the encoder list would refuse a machine that can do the job.

**The temporary sibling and cancellation are the encoder's.** The target is written to an exclusive `.part.wav` sibling in its own directory and renamed only on success; the caller's `AbortSignal` kills the child (`SIGTERM`, then `SIGKILL`) and removes the sibling, and `coverOnExit` does the same synchronously if the process exits under the run. Both artifacts share one subprocess boundary (`src/render/encoding/process.ts`), so neither owns a second way to start, stop or replace a child.

## Consequences

A full-length Composition's audio is now seconds of work — one mount, one `ffprobe` per kept track, one FFmpeg pass with no video — and `motion-kit render entry.tsx --out out.wav --from 4:20 --to 4:35` answers "what does the mix sound like here" in the same time. Because the WAV is the encoder's own mix, an RMS or onset measurement on it is evidence about the MP4's audio; the artifacts differ only in the codec (PCM against AAC 192 kbit/s), so a comparison between them is by level and waveform, never by bytes.

**Measured cost.** On the QA fixture (2 s at 30 fps, 64×64, two clips), the WAV export took **8.4 s wall** against **22 s** for the same Composition's MP4; about 6 s of the export is the realm mount (Vite service, Chromium launch, mount, teardown), which does not grow with the Composition's length, while the MP4 pays capture and H.264 per frame. A whole-Composition MP4 render of the 2.6–6 minute videos this task started from therefore costs minutes, and its WAV export the same roughly-constant seconds plus one audio pass.

The export still launches Chromium and evaluates the entry, so it is seconds rather than milliseconds, and it needs the same Vite loading path as a render. A Composition whose audio is only audible through a hook or a runtime registration still exports nothing, because audio is declaration data.

A successful export reports no per-frame warnings (`seek.uncontrolled`, `layout.*`), because it captures no frame; `diagnostics` is empty. An agent that wants those warnings renders at least one frame.

## Alternatives

- **An `audio` subcommand.** It would add a command value to the envelope, a second argv resolver branch and a second place where the output format is decided, for a target path that already says `wav`; it also duplicates the range, props and renderer-configuration options.
- **A `render --audio-only` flag.** The extension already selects the format, so the flag would be a second source of truth and would have to be reconciled with `--out out.mp4`.
- **Read the descriptor from Node instead of opening a realm.** It needs a second loader (`vite.ssrLoadModule` or a custom import), which the loading contract forbids and which could resolve different metadata than the page: the `resolveMetadata` result is only defined inside the realm.
- **Capture one frame to "keep a single path".** The frame capture is the cost this task removes; the mix does not depend on any frame.
- **A second mix implementation (JavaScript or a filter graph of its own).** It would be the second clock the audio muxing ADR forbids, and the first divergence between the WAV and the MP4.
- **`anullsrc` when no audio is declared.** A silent file answers the request with the same bytes for every bug the caller is looking for; `render.no-audio` says what is missing instead.
- **24-bit PCM.** No source carries 24 bits, and the MP4's audio is 192 kbit/s AAC, so the extra depth would describe nothing and double the file.
- **AAC in `.m4a`.** It is lossy, so an RMS check would measure the encoder as well as the mix, and it needs the encoder list probe that a PCM export does not.
- **Reuse the encode child with a dummy video input.** It needs a real frame stream, which is exactly the capture this task avoids.
