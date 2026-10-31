# Browser preview

## Goal

`motion-kit preview <entry>` lets a human scrub, step and play a Composition in their own browser, with its declared audio, without encoding a file (TASK-246). Review comments copied as Markdown for a coding agent follow in TASK-245; named Sequences (TASK-247) give both a semantic location.

Verified by (all in the repository's test suite):

- unit tests of the host's pure parts: playhead → requested frame, the audio schedule, the `mm:ss.cc` label, the single-flight presenter, timeline lanes (`src/preview/schedule.test.ts`), the preview query (`query.test.ts`), the audio player and muted-source storage (`audio.test.ts`), the realm handshake and requests (`connection.test.ts`), and the controller as a state machine over fakes, including a realm that never starts and Play before the audio is decoded (`controller.test.ts`);
- a browser test that a composition realm in preview host mode answers list, mount and show over a `MessagePort`, reports props and range failures as data, serves only the first port its parent transfers, and rejects renderer requests and leases (`src/core/runtime/preview-port.browser.test.tsx`);
- a loading test that a preview session serves the host page, the preview shell and the audio route under Vite's fs policy (file names with `#` and `?` included), emits `reload` on a source change and on a change to an audio file the host fetched, ends when the Vite config changes, listens on a requested port and reports one that is taken, and removes its workspace on disposal (`src/render/loading/preview-session.test.ts`);
- CLI tests of the `preview` arguments, the readiness envelope and the stop semantics (`src/cli/preview.test.ts`);
- a built-package test that `dist/cli.js preview` serves the host page whose module imports `dist/preview.js` (`src/cli/built-artifact.test.ts`).

A QA Check in a real browser on an example Composition (scrub, play, audio with per-track mute, reload on edit) is a manual step and is not recorded by this document.

## Non-Goals

- Pixel parity with the renderer. Preview is for authoring; the MP4 stays the final check (WebGL implementation, encoding loss, the audio mix).
- Vite HMR of scene state. A source change reloads the composition iframe; the host keeps the playhead and requests the frame again.
- Real-time playback at the Composition's fps. Playback samples a low fixed preview fps.
- Audio processing beyond the `AudioTrack` contract (start, end, offset, volume), video assets, and audio-reactive visuals.
- Supervising a hung page. Preview cannot terminate the user's browser; a frame that never settles ends in core's own frame timeout.
- Remote access: the session listens on loopback only.
- Validating the Composition or its props in the CLI. The CLI starts no browser; selection and props failures are shown in the page.
- Review comments and their Markdown export (TASK-245). Not built; the timeline's Sequence names and the Playhead frame are the anchors it will use.

## Design

The names are the ones in `src/`; [preview CONTEXT](../contexts/preview/CONTEXT.md) defines the terms.

### Placement

| Piece                                                  | Where                                                                                         | Runs in                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------- |
| `preview` command, arguments, lifecycle (`runPreview`) | `src/cli`                                                                                     | Node                          |
| Preview loading session and host routes                | `src/render/loading` (`preview-session.ts`, `service.ts`, `server.ts` with `mode: 'preview'`) | Node (the loading child)      |
| Preview host mode of the page bootstrap                | `src/core/runtime/preview-port.ts`, `browser-entry.ts`                                        | composition iframe            |
| Host↔realm messages and the host page configuration    | `src/lib/preview-protocol.ts`                                                                 | both sides                    |
| Host UI, its state machine and pure scheduling         | `src/preview` (context `preview`)                                                             | host page, outside the iframe |

`preview` depends on `core` (Time Module) and `src/lib`; it never imports `render`, `agent`, `cli`, `three`, Vite, Playwright or Node APIs (lint: `PREVIEW_RESTRICTION` in `oxlint.config.ts`). The CLI imports only the query helpers from it (`src/preview/query.ts`).

The loading server serves the host bundle through two reserved ids, like the bootstrap (`@kimuson/motion-kit/browser`): the generated page module `virtual:motion-kit-preview-entry` (`previewEntrySource`), which imports `@kimuson/motion-kit/preview` and calls `startPreviewHost()`. The latter resolves to `src/preview/host.tsx` in the repository and to `dist/preview.js` in the built package (`tsdown.config.ts` entry `preview`). It is not a public subpath: a project alias for either id is overridden, as for the bootstrap ids. The child process lifecycle that `session.ts` and `preview-session.ts` share lives in `service.ts` (`startLoadingService`).

### Session

`openPreviewSession` forks the same loading child as the renderer with `mode: 'preview'` and an optional port, launches no browser, and returns `{ url, servicePid, failed, dispose }`. `url` is the host page, `failed` settles with the Diagnostic that ended the service after readiness, and a startup that exceeds the loading timeout (30 s) is `render.page-error`. The child's routes, under Vite's `base`:

| Route                                | Serves                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__motion-kit/?host=preview`         | The existing composition shell; the query fixes the realm's host mode.                                                                                                                                                                                                                                                                                                                    |
| `__motion-kit/preview/`              | The host page: `previewShell`, the host bundle, and its configuration (`projectRoot`, `shellUrl`, `eventsUrl`, `audioUrl`) as inline JSON with `<` escaped.                                                                                                                                                                                                                               |
| `__motion-kit/preview/events`        | Server-sent events; `reload` after a change to the entry, a module in Vite's graph or an audio file the host fetched, once per 50 ms burst of watcher events and only after Vite has invalidated the changed modules (it does so after its plugins' `watchChange` hooks settle).                                                                                                          |
| `__motion-kit/preview/audio?src=<s>` | The bytes of `resolve(projectRoot, s)`, `Cache-Control: no-store`, when Vite's `isFileLoadingAllowed` (the `server.fs` allow and deny lists) accepts it; otherwise 403, a missing file 404, a missing or empty `src` 400. The route reads the file itself because Vite's `/@fs/` URL decoding cannot reach a name with `#` or `?`. A served file is watched, so its change is a `reload`. |

None of these exists in a renderer session. Composition, props and preview fps travel in the host page's query (`?composition=<id>&props=<json>&fps=<n>`, `previewQueryString`; defaults are left out), so the server keeps no selection state.

A change to the Vite config or its dependencies still fails the session, because the module graph and plugins would no longer match: the service reports `render.page-error` ("The Vite config vite.config.ts changed, so the preview stopped.") and the command ends with exit 1. A requested `--port` that is taken is `render.page-error` ("Port N on 127.0.0.1 is already in use.", hint: stop the listener or choose another port); an omitted port is ephemeral and cannot be taken.

### Protocol

The realm's host mode is fixed at bootstrap from the shell URL (`?host=preview`). In preview mode the bootstrap installs no `window.__motionKit` and no Playwright callbacks, and creates its Loading Page for source `preview` (`createLoadingPage(input, 'preview')`):

1. The realm posts `{ type: 'motion-kit-preview-ready', protocolVersion }` to its parent, same origin only.
2. The host answers with `{ type: 'motion-kit-preview-connect', protocolVersion }` and a transferred `MessagePort`. The realm accepts one port, only from `window.parent` at its own origin; the host accepts the ready message only from its own iframe at its own origin.
3. Requests and replies on the port are correlated by `id` and validated with Zod on both sides (`protocolVersion` is 1):

```ts
type PreviewRequest =
  | { type: 'list'; id: number }
  | { type: 'mount'; id: number; compositionId?: string; props: unknown }
  | { type: 'show'; id: number; frame: number };
type PreviewReply =
  | { type: 'listed'; id: number; result: Result<readonly LoadingDescriptor[]> }
  | { type: 'mounted'; id: number; result: Result<MountReceipt> }
  | { type: 'shown'; id: number; outcome: ShowOutcome };
type ShowOutcome =
  | { status: 'shown'; frame: number; sequences: readonly SequenceSpan[] }
  | { status: 'failed'; diagnostics: readonly [Diagnostic, ...Diagnostic[]] }
  | { status: 'aborted' };
```

`mount` runs the Loading Page's mount with a fresh revision and instance and a 30 s loading timeout. `show` runs `settleFrame(frame, { source: 'preview' })`, then `completeCapture(lease)` once the frame is committed (`resettle` while the lease asks for it), and replies with the spans `sequences()` reports. Completing the lease is the preview's presentation: it releases ownership without a screenshot. Ownership is granted inside the realm and core's own frame timeout bounds the work, because no external host can recycle the user's browser. A Loading Page serves one host source: renderer requests and leases are rejected in a preview realm, and preview ones in a renderer realm.

The host keeps at most one `show` in flight (`Presenter`). When it replies, the host requests the latest wanted frame if it differs from the one shown. A frame slower than the playback interval is therefore shown late, never starved by supersession, and the UI shows the lag (`showing <n>` next to the playhead).

### Host state

```ts
type Session =
  | { kind: 'connecting' }
  | { kind: 'choosing'; compositions: readonly LoadingDescriptor[] }
  | { kind: 'failed'; diagnostic: Diagnostic }
  | { kind: 'ready'; descriptor: LoadingDescriptor; fps: FrameRate };
type Playback =
  | { kind: 'paused'; frame: number }
  | { kind: 'playing'; anchorFrame: number; anchorTime: number };
```

`createPreviewController` (`controller.ts`) owns `PreviewState` (session, playback, playhead, the last `ShowOutcome`, the spans seen since the last reload, muted sources and unplayable sources) and drives the realm, the audio player and the timer through injected dependencies; `view.tsx` only renders it. Selection: with `composition` in the query the host mounts it; without it a registry of one is mounted and a larger one shows a chooser, which records the choice in the page URL (`history.replaceState`) so a page reload keeps it. A `list`, `mount` or `show` failure is shown as a Diagnostic in the page. So is a realm frame that loads but does not announce itself within 1 s of its `load` event, because the entry failed to import or run (`render.page-error`, "The composition page loaded, but the entry did not start."); without it the page would stay on "Loading…".

Pure functions in `src/preview/schedule.ts`, each unit-tested:

- `playheadFrame(playback, audioTime, fps, durationInFrames)`: the anchor frame plus elapsed audio-clock seconds, floored through the Time Module and clamped to the last frame.
- `audioSchedule(tracks, fromFrame, fps, durationInFrames)`: `{ src, delay, offset, duration, gain }` for each clip still audible from `fromFrame`, capped at the Composition duration as the encoder caps it.
- `timecode(frame, fps)`: `mm:ss.cc`, the centiseconds floored through the Time Module.
- `wantFrame` / `frameAnswered`: the single-flight presenter.
- `packLanes(intervals)`: timeline lanes for half-open intervals.

Paused or scrubbing: show that exact frame. Playing: a timer at the preview fps (`--preview-fps`, 1-60, default 12) asks for `playheadFrame(...)`; the `AudioContext` clock is the playhead, because drift between picture and sound is what the ear notices. The last frame ends playback, and Play on the last frame starts again from frame 0. Controls: Space plays and pauses, the arrow keys step one frame (Shift: ten), the scrubber and a click on the timeline seek, and the timecode and frame number are shown. The shortcuts are read on the host window wherever focus is, except in an input, and Space on a focused button only activates the button; the composition iframe takes no pointer input, so it never holds the focus. A seek lands on a whole frame (floored).

### Audio

Web Audio decodes each distinct `src` once (`fetch` of the audio route, `decodeAudioData`), starts one `AudioBufferSourceNode` per scheduled clip through a `GainNode`, and rebuilds the schedule on play, seek, mute or reload. Play waits until the mounted Composition's sources are decoded, so no clip starts silent, and each reload drops the decoded buffers, so a replaced audio file is fetched again. A source that cannot be fetched or decoded is marked unplayable in the UI and skipped; it does not fail the preview. That includes an absolute `src` outside `server.fs.allow`, which the renderer reads but the preview does not serve; add its directory to `server.fs.allow` to hear it. Mute is per `src` and kept in `localStorage` under `motion-kit-preview:muted:<projectRoot>`, so BGM can be off while voices play. The `AudioContext` is resumed from the Play gesture.

### Timeline overlay

Rows under the scrubber show the named Sequences the realm has reported and the declared audio clips (packed into lanes so clips that do not overlap share a row). A named Sequence is reported while it is mounted (core `CONTEXT.md`), so the host keeps every span it has seen since the last reload and highlights the spans of the latest `shown` reply, the ones showing at the shown frame. Zero-length spans are not drawn; spans and clips are clipped to the Composition for drawing only.

### CLI

`motion-kit preview <entry> [--composition <id>] [--props <json>] [--preview-fps <n>] [--port <n>] [--project-root <dir>] [--vite-config <path>] [--json]`. When the host page is listening it writes one success envelope, `data: { format: 'preview', url }`, or the line `serving <url> (Ctrl-C to stop); ready`, and serves until a stop signal, which is then its normal end (exit 0, no second document). A stop before readiness is a cancellation as for every command (stderr `preview aborted; nothing is being served`, exit 128 plus the signal number); a session failure after readiness writes one line `severity: code: message — hint` to stderr and exits 1. A missing entry, an invalid `--preview-fps` or `--port`, and a failure to start are the usual failure envelopes before readiness. This is new to the CLI output contract, so the [CLI output contract ADR](../contexts/agent/adr/20261024-cli-output-contract.accepted.md) is amended. The [CLI guide](../guide/cli.md#preview) is the user-facing description.

### Open items

- The comment-to-Markdown UI (TASK-245) is not built.
- The timeline fills as spans are seen: a named Sequence appears once the playhead has been inside its ancestors, because the runtime reports a Sequence only while it is mounted. Scrub through the Composition once to see every shot.
- Nothing bounds a `show` beyond core's frame timeout; a page that hangs the main thread hangs the host page's iframe, not the CLI.

## Alternatives

- Driving the page through Playwright from the CLI (a headed browser): the user's own browser already plays audio and needs no second Chromium; Playwright would add CDP to preview, which the loading design excludes.
- Same-origin `contentWindow.__motionKit` access instead of a `MessagePort`: less code, but the loading design fixes the channel, and the iframe boundary is where clock and state isolation hold.
- Vite HMR with React Fast Refresh: keeps scene state across edits, which a frame-as-a-function model does not need, and adds a plugin to every project.
- Superseding every in-flight `show` with the newest: a frame slower than the playback interval would never be shown while playing.
- Driving playback from `requestAnimationFrame` time: the picture would drift from the audio.
