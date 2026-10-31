# preview

A human's fast authoring loop. preview is the browser page `motion-kit preview` serves: it plays, scrubs and steps a Composition in the user's own browser with its declared audio, and shows the timeline of named Sequences and audio clips. It is not the render: it never encodes, never captures a screenshot, and may differ from the MP4 (WebGL implementation, encoding loss, the audio mix). It runs in the browser outside the Composition's iframe and reaches the Composition only through the preview protocol; Node-side serving belongs to render's loading service and the command to agent.

## Ubiquitous Language

| Term               | Code                                       | Definition                                                                                                                                                                                |
| ------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview            | `motion-kit preview`                       | The command that serves the host page on `127.0.0.1` until it is stopped; readiness is its result.                                                                                        |
| Preview host page  | `startPreviewHost`                         | The page the loading service serves at `__motion-kit/preview/`: the controls, timeline and audio, with the Realm embedded in an iframe. Built as a separate entry.                        |
| Realm              | `Realm`                                    | The host's connection to one Composition realm (the iframe running the user's entry): `list`, `mount` and `show` requests over a `MessagePort`. A reload replaces it.                     |
| Preview host mode  | `?host=preview`, `servePreviewPort`        | The mode of the composition shell that the page URL fixes: the realm serves the preview protocol and installs no `window.__motionKit`, no Playwright callbacks.                           |
| Preview protocol   | `previewProtocolVersion`, `PreviewRequest` | The versioned, Zod-validated messages between host page and realm: a `ready`/`connect` handshake, then `list`, `mount` and `show` correlated by `id`.                                     |
| Show               | `show`, `ShowOutcome`                      | Display one frame in the realm: it settles the frame as source `preview`, completes the lease without a screenshot, and replies `shown` (with the Sequence Spans), `failed` or `aborted`. |
| Presenter          | `Presenter`                                | The rule that at most one `show` is in flight and the latest wanted frame follows its reply, so a slow frame is shown late rather than starved.                                           |
| Playhead           | `PreviewState.playhead`                    | The frame the user is on. While playing it is derived from the audio clock; the Realm may still be showing an earlier frame.                                                              |
| Playback           | `Playback`                                 | `paused` at a frame, or `playing` from an anchor frame and anchor time on the audio clock.                                                                                                |
| Audio clock        | `AudioContext.currentTime`                 | The clock that drives the Playhead while playing, because drift between picture and sound is what the ear notices.                                                                        |
| Preview fps        | `PreviewQuery.fps`, `--preview-fps`        | How many frames per second playback samples (1-60, default `defaultPreviewFps` = 12). It is a sampling rate for the picture, not the Composition's fps.                                   |
| Preview query      | `PreviewQuery`, `previewQueryString`       | The selection (Composition id, props, Preview fps) carried in the host page URL, so the server keeps no selection state.                                                                  |
| Audio schedule     | `audioSchedule`, `ScheduledClip`           | The declared clips still audible from a frame, as `{ src, delay, offset, duration, gain }` in seconds computed through the Time Module and capped at the Composition duration.            |
| Audio player       | `createAudioPlayer`                        | Decodes each distinct `src` once and plays an Audio schedule through Web Audio gain nodes.                                                                                                |
| Muted source       | `mutedSources`                             | A `src` the user silenced; kept in `localStorage` per project root and applied to every clip of that source.                                                                              |
| Reload             | `reload` (server-sent event)               | The signal that a served module changed; the host page rebuilds the Realm and shows the Playhead again. There is no hot module replacement.                                               |
| Preview controller | `createPreviewController`                  | The host's state machine (`Session`, `Playback`, spans, muted sources) and the Realm, audio and timer it drives; the view only renders it.                                                |
| Preview timeline   | `Timeline` (`view.tsx`), `packLanes`       | Rows under the scrubber: the named Sequence Spans the Realm has reported and the declared audio clips, the clips packed into lanes so non-overlapping ones share a row.                   |

## Invariants

- Preview imports `core` and `src/lib` only (plus React and Zod); it never imports `render`, `agent`, `cli`, `three`, Vite, Playwright or Node APIs (lint, `PREVIEW_RESTRICTION`).
- The Realm is reached only through the preview protocol over a transferred `MessagePort`. The realm accepts one port, only from its parent window at its own origin; the host accepts the realm only from its own frame at its own origin.
- At most one `show` is in flight, and the Playhead is never reset by a reload: after a reload the Realm shows the Playhead's frame again.
- While playing, the Playhead is `anchorFrame` plus the elapsed audio-clock time floored through the Time Module, clamped to the last frame; paused, it is the exact frame. The last frame ends playback.
- Time arithmetic (frame to seconds, timecode centiseconds, clip delay and offset) goes through the Time Module, never floating-point frame math.
- The server keeps no selection state: the same URL always selects the same Composition, props and Preview fps.
- Preview and renderer share core's Composition runtime and registry loading contract, never a loading session or a Realm; a preview realm rejects renderer requests and leases, and the renderer's page rejects preview ones.
