# Browser preview

## Goal

`motion-kit preview <entry>` lets a human scrub, step and play a Composition in their own browser, with its declared audio, without encoding a file (TASK-246), and take review comments on a frame, a range of frames, a point or an element, copied as Markdown for a coding agent with a command that renders each comment's frames (TASK-245); named Sequences (TASK-247) give both a semantic location.

Verified by (all in the repository's test suite):

- unit tests of the host's pure parts: playhead → requested frame, the audio schedule, the `mm:ss.cc` label, the single-flight presenter, timeline lanes (`src/preview/schedule.test.ts`), asset groups and Asset spans (`asset-usage.test.ts`), the preview query (`query.test.ts`), the page language and where it is kept (`locale.test.ts`), the audio player and muted-source storage (`audio.test.ts`), the realm handshake and requests (`connection.test.ts`), and the controller as a state machine over fakes, including a realm that never starts and Play before the audio is decoded (`controller.test.ts`);
- unit tests of review comments: their Markdown and reproduction command, shell quoting and source paths (`src/preview/comments.test.ts`), the comment store over `localStorage` (`comment-book.test.ts`), and comment mode as a state machine over a fake controller, including a pointer that leaves during a pick (`review.test.ts`);
- a browser test that a composition realm in preview host mode answers list, mount, show, inspect and describe over a `MessagePort`, reports the assets a frame registered and props and range failures as data, keeps the shown frame on screen while the next one loads or is cut off, shows the next frame again after one failed, serves only the first port its parent transfers, and rejects renderer requests and leases (`src/core/runtime/preview-port.browser.test.tsx`);
- a loading test that a preview session serves the host page, the preview shell and the audio route under Vite's fs policy (file names with `#` and `?` included), emits `reload` on a source change and on a change to an audio file the host fetched, including one created after the host first asked for it, ends when the Vite config changes, listens on a requested port and reports one that is taken, marks the project's host elements with `data-source` and leaves an author's own, and removes its workspace on disposal (`src/render/loading/preview-session.test.ts`);
- a browser test of the host page: the realm's start failures, the side panel resize kept across loads, the language chosen in the settings kept across loads, the playback keys and where a focused control keeps them (a side panel tab and the language select included), timeline lanes (asset lanes included) and highlighting, the lag slot, a scrubber as wide on the last frame as on the first in either language, the side panel's audio mute toggles, Sequence seeks, registered assets and element tree, and a comment on an element picked in comment mode, from the click to the copied Markdown (`src/preview/host.browser.test.tsx`);
- a browser test that the asset lanes draw again only the bars whose span changed, out of a thousand (`src/preview/timeline.browser.test.tsx`);
- unit tests that the third-party notice covers what the preview bundles: the imported devDependencies and the packages they depend on (`scripts/third-party-licenses.test.ts`);
- CLI tests of the `preview` arguments, the readiness envelope and the stop semantics (`src/cli/preview.test.ts`);
- a built-package test that `dist/cli.js preview` serves the host page whose module imports `dist/preview.js` (`src/cli/built-artifact.test.ts`).

A QA Check in a real browser on an example Composition (scrub, play, audio with per-track mute, reload on edit, point, range and element comments whose command renders the frame commented on) is a manual step and is not recorded by this document.

## Non-Goals

- Pixel parity with the renderer. Preview is for authoring; the MP4 stays the final check (WebGL implementation, encoding loss, the audio mix).
- Vite HMR of scene state. A source change reloads the composition iframe; the host keeps the playhead and requests the frame again.
- Real-time playback at the Composition's fps. Playback samples a low fixed preview fps.
- Audio processing beyond the `AudioTrack` contract (start, end, offset, volume), video assets, and audio-reactive visuals.
- Supervising a hung page. Preview cannot terminate the user's browser; a frame that never settles ends in core's own frame timeout.
- Remote access: the session listens on loopback only.
- Validating the Composition or its props against the registry in the CLI. The CLI starts no browser and only requires `--props` to be a JSON object; selection and schema failures are shown in the page.
- Screenshots in review comments. The Markdown names the frames and a `motion-kit frame` command renders them; an image would be a preview frame, which may differ from the render.
- Sharing or storing comments on the server. The server stays read-only; comments live in the browser's `localStorage` and leave it as Markdown on the clipboard.

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
  | { type: 'show'; id: number; frame: number }
  | { type: 'inspect'; id: number; x: number; y: number }
  | { type: 'describe'; id: number };
type PreviewReply =
  | { type: 'listed'; id: number; result: Result<readonly LoadingDescriptor[]> }
  | { type: 'mounted'; id: number; result: Result<MountReceipt> }
  | { type: 'shown'; id: number; outcome: ShowOutcome }
  | { type: 'inspected'; id: number; result: Result<InspectedElement | null> }
  | { type: 'described'; id: number; result: Result<ElementTree | null> };
type ShowOutcome =
  | {
      status: 'shown';
      frame: number;
      sequences: readonly SequenceSpan[];
      assets: readonly RegisteredAsset[];
    }
  | {
      status: 'failed';
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
      assets: readonly RegisteredAsset[];
    }
  | { status: 'aborted' };
```

`mount` runs the Loading Page's mount with a fresh revision and instance and a 30 s loading timeout. `show` runs `settleFrame(frame, { source: 'preview' })`, then `completeCapture(lease)` once the frame is committed (`resettle` while the lease asks for it), and replies with the spans `sequences()` reports and the fonts and images the frame registered with `useAsset` (`RegisteredAsset`: kind, redacted source, `pending`/`ready`/`failed`, from `assetReadiness()`). A failed frame never committed, so the registry still holds the previous frame's registrations; its assets come from the `asset.load-failed` and `asset.not-ready` diagnostics instead. Completing the lease is the preview's presentation: it releases ownership without a screenshot. _Amended 2026-11-01 (TASK-273):_ a preview realm mounts the Composition with the `held` frame change (`frameChange`, the Held Frame Change of core): a frame change renders as a React transition, so the shown frame stays on screen while the next one suspends on an asset, and a frame aborted before it committed leaves it in place; the renderer keeps `live`, which captures only settled frames. A newly mounted Suspense boundary (the first frame of a shot) still shows its fallback, since a transition only holds content already revealed. A frame that failed clears the picture, and the next frame renders the content again. The failed frame may commit its failure only after the next request started; that failure, and the registrations of a render cut off before it committed, are not counted against the next frame. Ownership is granted inside the realm and core's own frame timeout bounds the work, because no external host can recycle the user's browser. A Loading Page serves one host source: renderer requests and leases are rejected in a preview realm, and preview ones in a renderer realm. A request whose handling throws still gets a reply of its type, carrying `internal.unexpected` (a failed `Result` or a failed `ShowOutcome`), so the single `show` in flight never blocks playback.

`inspect` answers which visible element of the mounted Composition is at a point in design pixels (`inspectPoint`, `src/core/runtime/inspect.ts`): its selector (tag, id, classes), its whitespace-collapsed text up to 80 characters, the `data-source` of its nearest marked ancestor, and its box in design pixels, or null where the point hits only the root. It skips an element that cannot be seen (it or an ancestor has opacity 0, or it is hidden), since scenes keep a faded-out shot mounted over the one the viewer sees, and it prefers the topmost element that draws something of its own (text, an image, a background, a border or a shadow) to a layout box spanning it. It reads the committed DOM and settles nothing, so it does not take a lease or wait for the `show` in flight.

`describe` answers every element of the mounted Composition as a tree (`describeTree`, `ElementTree`): each node is described as `inspect` describes an element, with whether it can be seen and its children. Like `inspect` it reads the committed DOM and settles nothing. The tree stops at 2000 elements and says it was truncated, so a scene of many particles cannot flood the port.

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

`createPreviewController` (`controller.ts`) owns `PreviewState` (session, playback, whether a play is waiting for its audio (`starting`), playhead, the last `ShowOutcome`, the spans seen since the last reload, the registered assets seen since then (`SeenAsset`: first-seen order and frame, latest status), the Asset spans seen since then (`assetSpans`), muted sources and unplayable sources) and drives the realm, the audio player and the timer through injected dependencies; `view.tsx` only renders it. Selection: with `composition` in the query the host mounts it; without it a registry of one is mounted and a larger one shows a chooser, which records the choice in the page URL (`history.replaceState`) so a page reload keeps it. Only those two name an id the next reload mounts: a registry of one is listed again on every reload, so a save that renames its only Composition is followed. A named id the registry no longer has (`cli.composition-not-found`) is dropped and the registry offered again, the chooser or its only Composition; the stale `composition` stays in the URL until the next choice. A `list`, `mount` or `show` failure is shown as a Diagnostic in the page. So is a realm whose entry failed to import or run (`render.page-error`, "The composition page loaded, but the entry did not start."); without it the page would stay on "Loading…". The preview shell carries a classic script ahead of the entry (`previewFailureReporter`, `src/lib/preview-protocol.ts`) that posts `motion-kit-preview-failed` to its parent on a script load failure or an uncaught error, and `connectRealm` rejects on it when it names the current load. There is no deadline, so an entry that awaits past its frame's `load` (top-level await on data, a slow first import) still connects whenever it announces itself. A module that fails to transform while the preview is serving (a typo being saved) does not end the session: the request answers with Vite's error, the terminal prints it, and the next save reloads the realm; only a dependency-optimizer failure ends a served preview.

Pure functions in `src/preview/schedule.ts`, each unit-tested:

- `playheadFrame(playback, audioTime, fps, durationInFrames)`: the anchor frame plus elapsed audio-clock seconds, floored through the Time Module and clamped to the last frame.
- `audioSchedule(tracks, fromFrame, fps, durationInFrames)`: `{ src, delay, offset, duration, gain }` for each clip still audible from `fromFrame`, capped at the Composition duration as the encoder caps it.
- `timecode(frame, fps)`: `mm:ss.cc`, the centiseconds floored through the Time Module.
- `wantFrame` / `frameAnswered`: the single-flight presenter.
- `packLanes(intervals)`: timeline lanes for half-open intervals.

Pure functions in `src/preview/asset-usage.ts`, each unit-tested:

- `assetGroup(asset)` / `observeAssets(spans, frame, assets, continued)`: the asset group of a registered asset, and the Asset spans after a frame was shown (`continued`: the frame the same playback showed right before).

Paused or scrubbing: show that exact frame. Playing: a timer at the preview fps (`--preview-fps`, 1-60, default 12) asks for `playheadFrame(...)`; the `AudioContext` clock is the playhead, because drift between picture and sound is what the ear notices. The anchor is put off by the context's `baseLatency + outputLatency`, so the picture leaves the anchor frame when the clips started there are heard, not when they are scheduled (a Bluetooth output adds a noticeable delay). The last frame ends playback, and Play on the last frame starts again from frame 0. Controls: Space plays and pauses, the arrow keys step one frame (Shift: ten), the scrubber and a click on the timeline seek, and the timecode and frame number are shown. The shortcuts are read on the host window wherever focus is, leaving out only the keys a focused control acts on (`nativeKeys`): every key in a text field, Space on a button or checkbox. A focused scrubber keeps the shortcuts, and its own arrow step is cancelled so a frame step happens once; a key with Alt, Ctrl or Meta is left to the browser (history navigation, the IME switch). The composition iframe takes no pointer input and is out of the tab order (`tabIndex={-1}`), so it never holds the focus. A seek lands on a whole frame (floored).

### Audio

Web Audio decodes each distinct `src` once (`fetch` of the audio route, `decodeAudioData`), starts one `AudioBufferSourceNode` per scheduled clip through a `GainNode`, and rebuilds the schedule on play, seek, mute or reload. Play waits until the mounted Composition's sources are decoded, so no clip starts silent. While it waits the play button shows pause, and a pause (the button or Space), a frame step, a reload or a later play withdraws the waiting play, so it does not start after the user stopped it. A reload whose `reload` event reports `{ "audio": true }` (an audio file the host fetched is among the changes) drops the decoded buffers, so a replaced file is fetched again; a save that changed only modules keeps them, so editing TSX does not decode long narration again. A source that cannot be fetched or decoded is marked unplayable in the UI and skipped; it does not fail the preview. That includes an absolute `src` outside `server.fs.allow`, which the renderer reads but the preview does not serve; add its directory to `server.fs.allow` to hear it. Mute is per `src` and kept in `localStorage` under `motion-kit-preview:muted:<projectRoot>`, so BGM can be off while voices play. The `AudioContext` is resumed from the Play gesture; if the browser refuses, playback stays paused, because that clock is the playhead.

### Layout and styling

The page is a grid: the stage (the composition iframe, scaled to fit) and a side panel share the top row, split by a handle (`react-resizable-panels`) that drags the side panel between 16rem and 60% of the row while the stage keeps at least a quarter of it; the width starts at 22rem and keeps its pixels while the window is resized, and once dragged, the share of the row it takes is kept in `localStorage` for the next load. The bottom row spans both with the transport (play, frame steps, timecode, the scrubber, the frame number and the lag) above the timeline. The bottom row is capped at 40% of the window and only the timeline scrolls in it, so the transport stays in view however many lanes there are. The side panel has a tab per concern, each scrolling on its own:

- **Info**: the Composition's facts (id, size, frame rate, duration, and the number of named Sequences seen, audio clips and registered fonts and images).
- **Sequences**: the named Sequences seen since the last reload, indented by depth and seeking to a Sequence's start when chosen.
- **Assets**: the fonts and images the frames shown since the last reload registered, each with its latest status and the frame it was first seen at (choosing it seeks there), those of the shown frame marked; below them the audio sources, one row per `src` with its mute toggle, its clip count and an unplayable badge. The fonts and images come first because a narrated Composition declares dozens of clips.
- **Elements**: the element tree of the shown frame, asked for with `describe` whenever a frame is shown while the tab is open and playback is paused (not while playing, so playback sends no extra requests). A row shows the selector (cut to fit, whole in its tooltip), the text of an element without children and the file and line of its `data-source`, dimmed when the element cannot be seen; the first three levels start expanded, and expansion is kept by the position in the tree, since elements have no identity across frames. Hovering a row outlines its box on the stage, and its button drafts a comment on the element.
- **Comments**: the review comments (below).

_Amended 2026-11-01 (TASK-276):_ The page's own text is English or Japanese (`Locale`, `src/preview/locale.ts`). Each language is a dictionary typed by the English one (`Messages`, `src/preview/messages.ts`), with a function for every text that takes a value, so a missing or misshapen entry fails the typecheck; the view provides the dictionary of the current language through a React context. The language is the one last chosen in the settings at the end of the transport (`createLocaleSetting`), kept in `localStorage` for every project, else the first of `navigator.languages` the page has by its primary subtag (`ja-JP` is `ja`), else English; the host page sets `<html lang>` to it. What the page hands to a coding agent stays English whatever the language: the review Markdown, the Diagnostics shown in the page and the messages of a failed boot. No i18n library is used: two languages of short UI strings need no plural rules, message format or loading, and a typed object catches more than string keys would.

_Amended 2026-11-01 (TASK-277):_ The settings are a gear button at the end of the transport that opens a popover; it holds the language as a native select, each language named in its own language, and further settings go there instead of crowding the transport. A focused select takes every key, like a text field, so the arrows choose a language instead of stepping a frame.

The components are shadcn/ui's (style `base-nova`, on Base UI), generated by the shadcn CLI into `src/preview/ui` and adapted to the repository's lint rules; the license is next to them and in `THIRD_PARTY_LICENSES.md`. The scrubber stays a native range input, because the window-wide arrow keys already step a frame and a Base UI slider would step a second time. Styles are Tailwind utilities with shadcn's dark palette and five colors of the preview's own (`playhead`, `sequence`, `audio`, `comment`, `warning`) in `src/preview/styles.css`. The user's Vite has no Tailwind plugin, so `scripts/preview-css.ts` compiles the stylesheet against the class names in `src/preview/**/*.tsx` into `src/preview/styles.generated.ts` (gitignored; `pnpm build` runs it first) with `tailwindcss` itself, not `@tailwindcss/node`, whose lightningcss is MPL-2.0 and would fail the license allowlist. The view renders the result in a `<style>` element that React hoists into `<head>`, keeping the CSS text out of the accessibility tree agents read. The host page is its own document, so the styles never reach the Composition.

Base UI imports the CommonJS shims of `use-sync-external-store`, whose `require("react")` has no answer in a browser bundle with React external. The `preview` build aliases them to `src/preview/vendor`: the plain shim re-exports React's own hook, and `with-selector` is a TypeScript port of the original (MIT, notice in the file).

### Timeline overlay

Rows under the transport show the named Sequences the realm has reported and the declared audio clips, each packed into lanes (`packLanes`) so spans or clips that do not overlap share a row. A named Sequence is reported while it is mounted, which is whenever its ancestors show the frame, active or not (core `CONTEXT.md`). So the top-level ones are listed from the first frame shown, and the host keeps every span it has seen since the last reload; it highlights the spans of the latest `shown` reply that are showing at the shown frame (`activeSequences`), not every reported one. Zero-length spans are not drawn; spans and clips are clipped to the Composition for drawing only. A last lane marks the mounted Composition's review comments: a range over its frames, a frame comment one frame wide.

_Amended 2026-11-01 (TASK-275):_ Asset lanes under the audio show where the fonts and images were used, on the same axis. The host knows only what the `shown` replies told it, so it keeps, per asset group, the frames shown so far that registered it (`observeAssets`), and a lane fills as the Composition is played or scrubbed, like the named Sequences. An asset group is one file, or every data URL of a kind, which has no name. A numbered name is not taken for a frame of an image sequence: photos named by when they were taken (`IMG20261031111549.jpg`, `IMG20261031111550.jpg`) number as closely as the stills of a video, so collapsing the numbers merged a whole folder of photos into one bar. A video made of stills therefore shows as a run of thin bars, one per still; a bar is as wide as its frames, at least a pixel, so on a long Composition, where a frame is narrower than a pixel, the stills of a clip blend into a thin band, which may spread over more than one lane. A span follows what the realm had registered, not the pixels on the stage: a still kept registered while playback runs on is drawn longer than it is seen. Spans pile up while playing, so a bar is drawn again only when its span or its place changes, and the lanes only when a span changes. Playback shows frames at the preview fps and skips the ones between; a span covers those skipped frames when the frames shown on both sides used its group and no seek came between, and frames that touch join into one span. A span in which an asset of its group failed to load is drawn in the destructive color. Spans are kept until the next reload.

### Review comments

A review comment (`ReviewComment`, `src/preview/comments.ts`) is about a time, one frame or a range of frames from `start` through `end`, and a place: the whole frame, a point, or an element, each in design pixels. It also records the paths of the named Sequences showing at its first frame, which are its primary location in the Markdown, because they survive edits that move frames and files.

- **Comment mode.** The Comment toggle in the transport, or C, pauses playback and lays a layer over the stage (`CommentLayer`) at the Composition's size and scale; the realm frame takes no pointer input. Moving the pointer asks the realm to `inspect` the point and outlines the element with its selector; the latest move wins. A click inspects the point and drafts a comment on that element, or on the point where it hits no element or the realm cannot answer, and leaves comment mode. Escape leaves comment mode, or drops the draft. An element can also be picked from the Elements tab, which finds one that is covered or hard to hit; it has no click point. "Comment on this frame" in the Comments tab drafts a whole-frame comment at the playhead.
- **Draft.** A draft is anchored at the playhead (`createReviewController`, `src/preview/review.ts`). Seeking and "Range to <time>" sets its other end, so the comment covers every frame in between; ⌘/Ctrl+Enter or Save stores it, Escape or Cancel drops it. The Comments tab opens with the draft, and its text field keeps every key, so Space types a space.
- **Source location.** In preview mode the loading service rewrites the project's own `.jsx`/`.tsx` modules to import a JSX dev runtime (`jsxSourcePlugin`) that adds `data-source="file:line:column"` to each host element from the location esbuild's development transform passes. motion-kit's modules, dependencies and the dependency optimizer are left alone, and an author's own `data-source` is kept. Only DOM elements are marked: a React Three Fiber element is a string type too, and the mark would land on its Three object, so a tag is marked when the browser knows it as HTML or it is a common SVG tag (`line` and `path` are left out, since they name three.js classes too). The page shows and copies the path relative to the project root. It is an aid: a component's elements carry the location inside the component, not where it is used.
- **Props.** A comment keeps the props the page mounted the Composition with (`ReviewComment.props`, from the Preview query), so its command renders the frame commented on even after the page is reopened with other `--props`.
- **Storage.** Comments are kept in `localStorage` under `motion-kit-preview:comments:<projectRoot>:<entry>` (`createCommentBook`), so they survive reloads and restarts on the same port, and are shown for the mounted Composition only. An entry that does not parse is skipped; a storage that refuses a write keeps the comments for the page.
- **Markdown.** Copy Markdown writes `reviewMarkdown(context, comments)` to the clipboard; where the browser refuses, the page shows the text to copy by hand. A header names the entry and project root, the Vite config when one was given, the Composition with its size and fps, and the props when every comment shares them and they are not `{}`. Each comment, earliest first, has a heading with its timecode and frames, its props when the comments do not share them, the innermost Sequence paths, the point or the element (selector, text, source, box, and the click position when it was clicked), the text as a quote, and a command that renders its frames:

```sh
motion-kit frame src/entry.tsx --project-root /work/app --composition intro --frame 12 --out review/frame-12.png
```

A range renders both ends (`--frame 30,60 --out review/frames-30-60`); `--props` is added when the comment's props are not `{}`. Every word is quoted for a POSIX shell. The server passes the page the project root as given and its real path, the entry and the Vite config (`PreviewHostConfig`), so the command selects the same Composition the page shows, with the props the comment keeps.

### CLI

`motion-kit preview <entry> [--composition <id>] [--props <json>] [--preview-fps <n>] [--port <n>] [--project-root <dir>] [--vite-config <path>] [--json]`. When the host page is listening it writes one success envelope, `data: { format: 'preview', url }`, or the line `serving <url> (Ctrl-C to stop); ready`, and serves until a stop signal, which is then its normal end (exit 0, no second document). A stop before readiness is a cancellation as for every command (stderr `preview aborted; nothing is being served`, exit 128 plus the signal number); a session failure after readiness writes one line `severity: code: message — hint` to stderr and exits 1. A missing entry, an invalid `--preview-fps` or `--port`, a `--props` that is not a JSON object, and a failure to start are the usual failure envelopes before readiness. This is new to the CLI output contract, so the [CLI output contract ADR](../contexts/agent/adr/20261024-cli-output-contract.accepted.md) is amended. The [CLI guide](../guide/cli.md#preview) is the user-facing description.

### Open items

- The timeline fills as spans are seen: a top-level named Sequence is listed from the first frame shown, and a nested one once the playhead has been inside its ancestors, because the runtime reports a Sequence only while it is mounted. Scrub through the Composition once to see every shot.
- Nothing bounds a `show` beyond core's frame timeout; a page that hangs the main thread hangs the host page's iframe, not the CLI.

## Alternatives

- Driving the page through Playwright from the CLI (a headed browser): the user's own browser already plays audio and needs no second Chromium; Playwright would add CDP to preview, which the loading design excludes.
- Same-origin `contentWindow.__motionKit` access instead of a `MessagePort`: less code, but the loading design fixes the channel, and the iframe boundary is where clock and state isolation hold.
- Vite HMR with React Fast Refresh: keeps scene state across edits, which a frame-as-a-function model does not need, and adds a plugin to every project.
- Superseding every in-flight `show` with the newest: a frame slower than the playback interval would never be shown while playing.
- Driving playback from `requestAnimationFrame` time: the picture would drift from the audio.
