# render

Frames and files. render runs a Composition in Chromium through Playwright, waits for readiness, captures each frame, and encodes the result. It is the only context besides agent that uses Node.js APIs.

## Ubiquitous Language

| Term              | Code                              | Definition                                                                                                           |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Renderer          | `renderer.renderFrame({ frame })` | The contract that produces one frame: compute time, update the timeline, wait for readiness, capture.                |
| Readiness Barrier | `awaitFrameReady`                 | The explicit condition (assets loaded, React committed, WebGL flushed) that must hold before capture; never a timer. |
| Capture           | `captureFrame`                    | Taking the pixels of the rendered page for one frame.                                                                |
| Encoder           | `encode`                          | Turning captured frames and audio into the output file with FFmpeg.                                                  |

The following loading terms describe the accepted TASK-153 design; it is not implemented yet.

| Term            | Code                              | Definition                                                                                                                                                                      |
| --------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading session | `src/render/loading`              | One supervised Vite/configuration module graph and HTTP service reused for one project/entry/host mode within a CLI invocation.                                                 |
| Host mode       | `source: 'renderer' \| 'preview'` | The owning host's mode. Sessions and Composition realms are never shared between modes; each capture lease records its source so duplicate or cross-source claims are rejected. |
| Page settlement | `settleFrame`                     | The page operation that seeks, commits and settles without capturing; returns a discriminated `ready` / `failed` / `aborted` result. It is not `renderer.renderFrame`.          |

## Invariants

- A frame is captured only after the Readiness Barrier passes; a timed wait is not readiness.
- Within supported A/B paths and a fixed qualified environment, rendering frames in any order produces the same files as rendering them in sequence; detected Tier C emits `seek.uncontrolled` instead of a determinism claim.
- The [loading contract](design-doc/20261024-composition-loading.md) uses bundled Vite 7.3.7 and the named Composition registry. Node-owned shell/entry generators do not enter the browser import graph.
- Settlement retains the capture lease until the host validates capture; resource-version changes re-settle under the original deadline, while cancellation aborts without publication.

## Trust model

Render executes the user's own project code with the invoking user's privileges, like Vite or a test runner. The [Phase 0 ADR](../../decisions/20261024-time-control-and-frame-capture.accepted.md#capture-environment-and-gpu-baseline) fixes this Phase 1 boundary: Chromium's sandbox is on by default, with container opt-out only through an explicit option; software-WebGL flags are explicit opt-ins. Suppress Playwright defaults that disable the sandbox or enable unsafe software WebGL.

Composition page/iframe separation protects clock/state ownership, not host security. Vite config/plugins execute trusted Node code. Serve normal project/referenced assets without adding privileged page RPCs. No rendering modes, OS-level job isolation or network policy are implemented in Phase 1. Untrusted rendering is TASK-176, parked, **do not start**.
