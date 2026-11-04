# Render a frame range with `--from` and `--to`

## Context

A person reviewing a render points at a moment as `4:20`, but `render` always writes the whole Composition, and a full render takes minutes. Checking one fix therefore means rendering everything again. TASK-249 (an audio-only WAV export) needs the same "which part of the timeline" answer, so the notation and its conversion cannot live in `render`'s argv handling.

Forces:

- Frames are the unit diagnostics and the manifest speak (`frameCount`, `location.frame`), while a reviewer speaks in `mm:ss`.
- The [render audio muxing ADR](../../render/adr/20261026-audio-track-muxing.accepted.md) places audio by frame counts converted once by the Time Module. A range must not introduce a second clock: the audio of the range is the Composition's own tracks re-expressed against it.
- The [CLI output contract](20261024-cli-output-contract.accepted.md) fixes what `render`'s `data` means; an agent must be able to read which part of the timeline the artifact covers.
- The render range must follow the Composition's resolved duration (TASK-236 may resolve it differently), so resolution takes `durationInFrames` and the `FrameRate` as inputs.

## Decision

**Flags.** `render` accepts `--from <bound>` and `--to <bound>`; both are optional and an omitted end is the Composition's own. They apply to both routes (`--out file.mp4` and `--out dir`). There is no environment counterpart and no new command.

**Notation decides the unit**, so `--from 260` and `--from 4:20` cannot be confused:

| Written          | Means                                             |
| ---------------- | ------------------------------------------------- |
| `260`            | Global Frame 260                                  |
| `260s`, `4.5s`   | seconds, exactly as written (decimals allowed)    |
| `4:20`, `4:20.5` | minutes and seconds (`mm:ss[.fff]`, seconds 0–59) |

A decimal without a unit (`4.5`) is rejected instead of guessed. The Time Module is the only frame↔time converter: `parseRangeBound` produces a `TimelineTime` or a Global Frame, and `resolveFrameRange` converts the time ends with `timeToFrameCeil`.

**Half-open on the frame grid.** The range is `[startFrame, endFrame)` with `startFrame = ceil(from · fps)` and `endFrame = ceil(to · fps)`, so the artifact holds exactly the frames whose presentation time lies in the written interval: no frame before `from`, and no frame at or after `to`. Both ends round up for that reason, and an exact frame boundary keeps that frame. A range outside the Composition or with no frames left is `cli.invalid-arguments` (exit 2) and no output is written.

**The artifact is zero-based on both routes.** Output frame 0 is Composition frame `startFrame`; the range cuts the Composition, it does not re-time it. The MP4 is encoded from the range alone, and the frames route names its PNGs `frame-00000.png`, `frame-00001.png`, … for the same reason, so a ranged sequence is the standalone artifact `ffmpeg -i frame-%05d.png` expects. File n of either route is Composition frame `startFrame + n`.

**`data` reports the original timeline.** Both `render` variants carry `range: { startFrame, endFrame, startSeconds, endSeconds, frameCount }`, where `startSeconds`/`endSeconds` are the Time Module's own seconds for those Global Frames and `frameCount = endFrame - startFrame`. It is present for every render, spelled out in full when no bound was given, so a reader never has to infer the interval. `frameCount` and `durationSeconds` describe the artifact — the range — which for a whole-Composition render is what they already meant. The frames manifest carries the same `range`, and its `frameCount` is the range's length; the zero-based files plus that `range` are the whole source-timeline mapping.

**Invalid ranges.** An unreadable bound is rejected by the argument schema (the argv is wrong whatever the Composition is). An empty or reversed range whose two bounds share a unit — frame against frame, or time against time — is decided by the same schema and rejected before any renderer opens, because `ceil` is monotonic so `from >= to` gives `startFrame >= endFrame` at every rate. The remaining checks need the descriptor: a mixed-unit empty range and a range outside the Composition are rejected as soon as the resolved `durationInFrames` is known — before any frame is captured and before the output path is touched, which for the frames route is before its directory is created. Every one of them is `cli.invalid-arguments` with a corrective hint.

**Interplay with the other options.**

- `--fps`: the output frame count is the ceiling of the _range's_ source duration times the output rate, and each output frame still samples the source frame containing its presentation time, now offset by `startFrame`. The output rate must remain no greater than the Composition rate. `durationSeconds` stays the range's source duration, so `frameCount / fps` may exceed it (the TASK-241 amendment).
- `--scale`, `--video-crf`, `--video-bitrate`: unchanged; they apply to the range's encode.
- `--concurrency`: unchanged; only the range's frames are captured.
- `--props`, renderer configuration, cancellation, diagnostics and exit codes: unchanged.

**Audio follows the range with no new flag.** The encoder re-expresses the declared tracks in **frames** relative to `startFrame` (`resolveAudioTracks` with `audioRange`, using `clipAudioTracks`), so its existing single frame→seconds conversion is untouched:

- a clip that starts after the range start moves earlier by `startFrame`;
- a clip already playing keeps its place and its source resumes where the range enters it (the head is cut in source frames, not seconds);
- a declared `endInFrames` is clipped to the range;
- a clip whose declared span does not overlap the range is not an input;
- a clip without a declared end plays to its natural end, and the graph's existing final `atrim` ends it at the range.

**Declaring audio always muxes one audio stream.** A Composition that declares at least one track gets one AAC stream on every render: if the range contains none of the clips, the stream is silence of exactly the artifact's duration (`anullsrc`), so a ranged artifact has the same stream layout as the whole render and a player or `ffprobe` still sees an audio track. An `audio` array that is absent or empty is the unchanged video-only path. Every declared `src` is validated — resolved and opened — whether or not the range keeps its clip, so a bad path is `asset.load-failed` on a ranged render exactly as on a whole one. A range that covers the whole Composition (`--from 0 --to <frameCount>`) is the whole-Composition render: nothing is clipped, so a clip declared at or after the end stays an input as it always did.

**Reuse.** `parseRangeBound` and `resolveFrameRange` live in `src/cli/range.ts`, depend only on the Time Module and `src/lib`, and are covered by property-based tests; TASK-249 calls them instead of re-implementing the notation.

## Consequences

A reviewer's `motion-kit render entry.tsx --out clip.mp4 --from 4:20 --to 4:35` renders fifteen seconds and takes seconds, with the audio of the same interval, and `--json` names the original frames and seconds the clip covers. The frames route writes the same interval as zero-based PNGs, so that sequence is also a standalone artifact. Two renders of the same range are not byte-identical (H.264 is not deterministic across encodes); the frames are the same, so a comparison uses the existing pixel criterion rather than byte identity.

`range` is a new required member of both `render` data variants. Adding a field is compatible and `schemaVersion` stays `1`, but a consumer validating the committed JSON Schema now requires it; the full range is emitted when nothing was asked for, so there is no "absent means whole Composition" rule to remember.

The frames manifest grows the same field. `durationSeconds` reads as the artifact's duration, which is unchanged for every render that existed before this.

## Alternatives

- **`mm:ss` only.** Frames are the render's own unit and the unit diagnostics report; an agent that read frame `7800` from a diagnostic would have to convert it.
- **Bare integers only, with any time written as `mm:ss`.** Counting minutes for a short clip is arithmetic the CLI can do.
- **Treat `4.5` as seconds.** A decimal frame does not exist, so it is tempting, but the same notation then means different units depending on a decimal point; the `s` suffix states the unit.
- **Include the `--to` frame.** An inclusive end makes `--to 4:35` cover a frame that starts at 4:35, so the clip is one frame longer than the interval the reviewer named, and it composes worse with `--fps`.
- **Floor the start.** The first frame's presentation time would be before `--from`, showing content the reviewer asked to exclude.
- **Trim a whole render with FFmpeg `-ss`.** That pays for the full render first, which is the problem being solved.
- **A separate `render-range` command.** Format selection, audio rules, cancellation and the envelope would be duplicated or the two commands would drift.
- **Recompute audio offsets in seconds in the CLI.** It moves the frame→second conversion out of the encoder and gives the audio a second clock.
