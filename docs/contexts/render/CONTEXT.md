# render

Frames and files. render runs a Composition in Chromium through Playwright, waits for readiness, captures each frame, and encodes the result. It is the only context besides agent that uses Node.js APIs.

## Ubiquitous Language

| Term              | Code                              | Definition                                                                                                           |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Renderer          | `renderer.renderFrame({ frame })` | The contract that produces one frame: compute time, update the timeline, wait for readiness, capture.                |
| Readiness Barrier | `awaitFrameReady`                 | The explicit condition (assets loaded, React committed, WebGL flushed) that must hold before capture; never a timer. |
| Capture           | `captureFrame`                    | Taking the pixels of the rendered page for one frame.                                                                |
| Encoder           | `encode`                          | Turning captured frames and audio into the output file with FFmpeg.                                                  |

## Invariants

- A frame is captured only after the Readiness Barrier passes; a timed wait is not readiness.
- Rendering frames in any order produces the same files as rendering them in sequence.
