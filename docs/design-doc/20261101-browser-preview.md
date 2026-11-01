# Browser preview

## Goal

`motion-kit preview <entry>` lets a human scrub, step and play a Composition in their own browser, with its declared audio, without encoding a file (TASK-246). Review comments copied as Markdown for a coding agent follow in TASK-245; named Sequences (TASK-247) give both a semantic location.

Verified by (all in the repository's test suite):

- unit tests of the host's pure parts: playhead → requested frame, the audio schedule, the `mm:ss.cc` label, the single-flight presenter, timeline lanes (`src/preview/schedule.test.ts`), the preview query (`query.test.ts`), the audio player and muted-source storage (`audio.test.ts`), the realm handshake and requests (`connection.test.ts`), and the controller as a state machine over fakes, including a realm that never starts and Play before the audio is decoded (`controller.test.ts`);
- a browser test that a composition realm in preview host mode answers list, mount and show over a `MessagePort`, reports props and range failures as data, serves only the first port its parent transfers, and rejects renderer requests and leases (`src/core/runtime/preview-port.browser.test.tsx`);
- a loading test that a preview session serves the host page, the preview shell and the audio route under Vite's fs policy (file names with `#` and `?` included), emits `reload` on a source change and on a change to an audio file the host fetched, including one created after the host first asked for it, ends when the Vite config changes, listens on a requested port and reports one that is taken, and removes its workspace on disposal (`src/render/loading/preview-session.test.ts`);
- a browser test of the host page: the realm's start failures, the playback keys and where a focused control keeps them (a side panel tab included), timeline lanes and highlighting, the lag slot, and the side panel's audio mute toggles and Sequence seeks (`src/preview/host.browser.test.tsx`);
- unit tests that the third-party notice covers what the preview bundles: the imported devDependencies and the packages they depend on (`scripts/third-party-licenses.test.ts`);
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
- Validating the Composition or its props against the registry in the CLI. The CLI starts no browser and only requires `--props` to be a JSON object; selection and schema failures are shown in the page.
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

`preview` depends on `core` (Time Module) and `src/lib`, plus the UI libraries in [Layout and styling](#layout-and-styling); it never imports `render`, `agent`, `cli`, `three`, `motion`, `theme`, `presets`, Vite, Playwright or Node APIs (lint: `PREVIEW_RESTRICTION` in `oxlint.config.ts`). The CLI imports only the query helpers from it (`src/preview/query.ts`).

The loading server serves the host bundle through two reserved ids, like the bootstrap (`@kimuson/motion-kit/browser`): the generated page module `virtual:motion-kit-preview-entry` (`previewEntrySource`), which imports `@kimuson/motion-kit/preview` and calls `startPreviewHost()`. `@kimuson/motion-kit/preview` resolves to `src/preview/host.tsx` in the repository and to `dist/preview.js` in the built package (`tsdown.config.ts`, the `preview` build). That build targets the browser and keeps React, React DOM and Zod external, so the user's Vite resolves the same copies the realm uses; the UI libraries are devDependencies and are bundled into it. It is not a public subpath: a project alias for either id is overridden, as for the bootstrap ids. The child process lifecycle that `session.ts` and `preview-session.ts` share lives in `service.ts` (`startLoadingService`).

### Session

`openPreviewSession` forks the same loading child as the renderer with `mode: 'preview'` and an optional port, launches no browser, and returns `{ url, servicePid, failed, dispose }`. `url` is the host page, `failed` settles with the Diagnostic that ended the service after readiness, and a startup that exceeds the loading timeout (30 s) is `render.page-error`. The child's routes, under Vite's `base`:

| Route                                | Serves                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__motion-kit/?host=preview`         | The existing composition shell; the query fixes the realm's host mode.                                                                                                                                                                                                                                                                                                                                                                 |
| `__motion-kit/preview/`              | The host page: `previewShell`, the host bundle, and its configuration (`projectRoot`, `shellUrl`, `eventsUrl`, `audioUrl`) as inline JSON with `<` escaped.                                                                                                                                                                                                                                                                            |
| `__motion-kit/preview/events`        | Server-sent events; `reload` after a change to the entry, a module in Vite's graph or an audio file the host asked for (whether or not it existed then, so creating a missing one is heard), with data `{ "audio": boolean }` (whether an audio file is among the changes), once per 50 ms burst of watcher events and only after Vite has invalidated the changed modules (it does so after its plugins' `watchChange` hooks settle). |
| `__motion-kit/preview/audio?src=<s>` | The bytes of `resolve(projectRoot, s)`, `Cache-Control: no-store`, when Vite's `isFileLoadingAllowed` (the `server.fs` allow and deny lists) accepts it; otherwise 403, a missing file or a directory 404, a missing or empty `src` 400. The route reads the file itself because Vite's `/@fs/` URL decoding cannot reach a name with `#` or `?`. A served file is watched, so its change is a `reload`.                               |

The three `__motion-kit/preview/` routes are a middleware that a `configureServer` hook adds, so they run right after Vite's own Host check: a `Host` Vite refuses (not an IP literal, `localhost`, `*.localhost` or a `server.allowedHosts` entry) is 403, which keeps a DNS-rebound page from reading them. Vite skips that check under `server.https` or `server.allowedHosts: true`, so the loading service, which always answers plain http, clears `https` and turns `allowedHosts: true` into `[]` in every session. The composition shell at `__motion-kit/` is still answered ahead of Vite's middlewares, as in a renderer session. None of these exists in a renderer session. Composition, props and preview fps travel in the host page's query (`?composition=<id>&props=<json>&fps=<n>`, `previewQueryString`; defaults are left out), so the server keeps no selection state.

A change to the Vite config or its dependencies still fails the session, because the module graph and plugins would no longer match: the service reports `render.page-error` ("The Vite config vite.config.ts changed, so the preview stopped.") and the command ends with exit 1. A requested `--port` that is taken is `render.page-error` ("Port N on 127.0.0.1 is already in use.", hint: stop the listener or choose another port); an omitted port is ephemeral and cannot be taken.

### Protocol

The realm's host mode is fixed at bootstrap from the shell URL (`?host=preview`). In preview mode the bootstrap installs no `window.__motionKit` and no Playwright callbacks, and creates its Loading Page for source `preview` (`createLoadingPage(input, 'preview')`):

1. The realm posts `{ type: 'motion-kit-preview-ready', protocolVersion, load }` to its parent, same origin only. `load` echoes the shell URL's `load` parameter, which the host sets afresh on every (re)load of the frame: the frame's window outlives a reload, so the document being replaced can still post, and the host only listens to the load it started. The shell's failure report (`motion-kit-preview-failed`) carries the same `load`.
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

`mount` runs the Loading Page's mount with a fresh revision and instance and a 30 s loading timeout. `show` runs `settleFrame(frame, { source: 'preview' })`, then `completeCapture(lease)` once the frame is committed (`resettle` while the lease asks for it), and replies with the spans `sequences()` reports. Completing the lease is the preview's presentation: it releases ownership without a screenshot. Ownership is granted inside the realm and core's own frame timeout bounds the work, because no external host can recycle the user's browser. A Loading Page serves one host source: renderer requests and leases are rejected in a preview realm, and preview ones in a renderer realm. A request whose handling throws still gets a reply of its type, carrying `internal.unexpected` (a failed `Result` or a failed `ShowOutcome`), so the single `show` in flight never blocks playback.

The host keeps at most one `show` in flight (`Presenter`). When it replies, the host requests the latest wanted frame if it differs from the one shown. A frame slower than the playback interval is therefore shown late, never starved by supersession, and the UI shows the lag (`showing <n>` next to the playhead): always while paused, and during playback only past half a second, since every tick is a frame or two behind. Its slot is always laid out, so the controls row never changes width as it comes and goes.

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

`createPreviewController` (`controller.ts`) owns `PreviewState` (session, playback, whether a play is waiting for its audio (`starting`), playhead, the last `ShowOutcome`, the spans seen since the last reload, muted sources and unplayable sources) and drives the realm, the audio player and the timer through injected dependencies; `view.tsx` only renders it. Selection: with `composition` in the query the host mounts it; without it a registry of one is mounted and a larger one shows a chooser, which records the choice in the page URL (`history.replaceState`) so a page reload keeps it. Only those two name an id the next reload mounts: a registry of one is listed again on every reload, so a save that renames its only Composition is followed. A named id the registry no longer has (`cli.composition-not-found`) is dropped and the registry offered again, the chooser or its only Composition; the stale `composition` stays in the URL until the next choice. A `list`, `mount` or `show` failure is shown as a Diagnostic in the page. So is a realm whose entry failed to import or run (`render.page-error`, "The composition page loaded, but the entry did not start."); without it the page would stay on "Loading…". The preview shell carries a classic script ahead of the entry (`previewFailureReporter`, `src/lib/preview-protocol.ts`) that posts `motion-kit-preview-failed` to its parent on a script load failure or an uncaught error, and `connectRealm` rejects on it when it names the current load. There is no deadline, so an entry that awaits past its frame's `load` (top-level await on data, a slow first import) still connects whenever it announces itself. A module that fails to transform while the preview is serving (a typo being saved) does not end the session: the request answers with Vite's error, the terminal prints it, and the next save reloads the realm; only a dependency-optimizer failure ends a served preview.

Pure functions in `src/preview/schedule.ts`, each unit-tested:

- `playheadFrame(playback, audioTime, fps, durationInFrames)`: the anchor frame plus elapsed audio-clock seconds, floored through the Time Module and clamped to the last frame.
- `audioSchedule(tracks, fromFrame, fps, durationInFrames)`: `{ src, delay, offset, duration, gain }` for each clip still audible from `fromFrame`, capped at the Composition duration as the encoder caps it.
- `timecode(frame, fps)`: `mm:ss.cc`, the centiseconds floored through the Time Module.
- `wantFrame` / `frameAnswered`: the single-flight presenter.
- `packLanes(intervals)`: timeline lanes for half-open intervals.

Paused or scrubbing: show that exact frame. Playing: a timer at the preview fps (`--preview-fps`, 1-60, default 12) asks for `playheadFrame(...)`; the `AudioContext` clock is the playhead, because drift between picture and sound is what the ear notices. The anchor is put off by the context's `baseLatency + outputLatency`, so the picture leaves the anchor frame when the clips started there are heard, not when they are scheduled (a Bluetooth output adds a noticeable delay). The last frame ends playback, and Play on the last frame starts again from frame 0. Controls: Space plays and pauses, the arrow keys step one frame (Shift: ten), the scrubber and a click on the timeline seek, and the timecode and frame number are shown. The shortcuts are read on the host window wherever focus is, leaving out only the keys a focused control acts on (`nativeKeys`): every key in a text field, Space on a button or checkbox. A focused scrubber keeps the shortcuts, and its own arrow step is cancelled so a frame step happens once; a key with Alt, Ctrl or Meta is left to the browser (history navigation, the IME switch). The composition iframe takes no pointer input and is out of the tab order (`tabIndex={-1}`), so it never holds the focus. A seek lands on a whole frame (floored).

### Audio

Web Audio decodes each distinct `src` once (`fetch` of the audio route, `decodeAudioData`), starts one `AudioBufferSourceNode` per scheduled clip through a `GainNode`, and rebuilds the schedule on play, seek, mute or reload. Play waits until the mounted Composition's sources are decoded, so no clip starts silent. While it waits the play button shows pause, and a pause (the button or Space), a frame step, a reload or a later play withdraws the waiting play, so it does not start after the user stopped it. A reload whose `reload` event reports `{ "audio": true }` (an audio file the host fetched is among the changes) drops the decoded buffers, so a replaced file is fetched again; a save that changed only modules keeps them, so editing TSX does not decode long narration again. A source that cannot be fetched or decoded is marked unplayable in the UI and skipped; it does not fail the preview. That includes an absolute `src` outside `server.fs.allow`, which the renderer reads but the preview does not serve; add its directory to `server.fs.allow` to hear it. Mute is per `src` and kept in `localStorage` under `motion-kit-preview:muted:<projectRoot>`, so BGM can be off while voices play. The `AudioContext` is resumed from the Play gesture; if the browser refuses, playback stays paused, because that clock is the playhead.

### Layout and styling

The page is a grid: the stage (the composition iframe, scaled to fit) and a side panel share the top row, and the bottom row spans both with the transport (play, frame steps, timecode, the scrubber, the frame number and the lag) above the timeline. The bottom row is capped at 40% of the window and only the timeline scrolls in it, so the transport stays in view however many lanes there are. The side panel has a tab per concern, each scrolling on its own: the Composition's facts (id, size, frame rate, duration, number of audio clips), the named Sequences seen since the last reload, indented by depth and seeking to a Sequence's start when chosen, and the audio sources, one row per `src` with its mute toggle, its clip count and an unplayable badge.

The components are shadcn/ui's (style `base-nova`, on Base UI), generated by the shadcn CLI into `src/preview/ui` and adapted to the repository's lint rules; the license is next to them and in `THIRD_PARTY_LICENSES.md`. The scrubber stays a native range input, because the window-wide arrow keys already step a frame and a Base UI slider would step a second time. Styles are Tailwind utilities with shadcn's dark palette and four colors of the preview's own (`playhead`, `sequence`, `audio`, `warning`) in `src/preview/styles.css`. The user's Vite has no Tailwind plugin, so `scripts/preview-css.ts` compiles the stylesheet against the class names in `src/preview/**/*.tsx` into `src/preview/styles.generated.ts` (gitignored; `pnpm build` runs it first) with `tailwindcss` itself, not `@tailwindcss/node`, whose lightningcss is MPL-2.0 and would fail the license allowlist. The view renders the result in a `<style>` element that React hoists into `<head>`, keeping the CSS text out of the accessibility tree agents read. The host page is its own document, so the styles never reach the Composition.

Base UI imports the CommonJS shims of `use-sync-external-store`, whose `require("react")` has no answer in a browser bundle with React external. The `preview` build aliases them to `src/preview/vendor`: the plain shim re-exports React's own hook, and `with-selector` is a TypeScript port of the original (MIT, notice in the file).

### Timeline overlay

Rows under the transport show the named Sequences the realm has reported and the declared audio clips, each packed into lanes (`packLanes`) so spans or clips that do not overlap share a row. A named Sequence is reported while it is mounted, which is whenever its ancestors show the frame, active or not (core `CONTEXT.md`). So the top-level ones are listed from the first frame shown, and the host keeps every span it has seen since the last reload; it highlights the spans of the latest `shown` reply that are showing at the shown frame (`activeSequences`), not every reported one. Zero-length spans are not drawn; spans and clips are clipped to the Composition for drawing only.

### CLI

`motion-kit preview <entry> [--composition <id>] [--props <json>] [--preview-fps <n>] [--port <n>] [--project-root <dir>] [--vite-config <path>] [--json]`. When the host page is listening it writes one success envelope, `data: { format: 'preview', url }`, or the line `serving <url> (Ctrl-C to stop); ready`, and serves until a stop signal, which is then its normal end (exit 0, no second document). A stop before readiness is a cancellation as for every command (stderr `preview aborted; nothing is being served`, exit 128 plus the signal number); a session failure after readiness writes one line `severity: code: message — hint` to stderr and exits 1. A missing entry, an invalid `--preview-fps` or `--port`, a `--props` that is not a JSON object, and a failure to start are the usual failure envelopes before readiness. This is new to the CLI output contract, so the [CLI output contract ADR](../contexts/agent/adr/20261024-cli-output-contract.accepted.md) is amended. The [CLI guide](../guide/cli.md#preview) is the user-facing description.

### Open items

- The comment-to-Markdown UI (TASK-245) is not built.
- The timeline fills as spans are seen: a top-level named Sequence is listed from the first frame shown, and a nested one once the playhead has been inside its ancestors, because the runtime reports a Sequence only while it is mounted. Scrub through the Composition once to see every shot.
- Nothing bounds a `show` beyond core's frame timeout; a page that hangs the main thread hangs the host page's iframe, not the CLI.

## Alternatives

- Driving the page through Playwright from the CLI (a headed browser): the user's own browser already plays audio and needs no second Chromium; Playwright would add CDP to preview, which the loading design excludes.
- Same-origin `contentWindow.__motionKit` access instead of a `MessagePort`: less code, but the loading design fixes the channel, and the iframe boundary is where clock and state isolation hold.
- Vite HMR with React Fast Refresh: keeps scene state across edits, which a frame-as-a-function model does not need, and adds a plugin to every project.
- Superseding every in-flight `show` with the newest: a frame slower than the playback interval would never be shown while playing.
- Driving playback from `requestAnimationFrame` time: the picture would drift from the audio.
