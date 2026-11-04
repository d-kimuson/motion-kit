# Capture throughput: the screenshot sets the frame rate, and realms scale it

Measured 2026-10-28 (TASK-222) on an 11-core Apple Silicon machine (5 performance cores, 36 GB), Chromium from Playwright, rendering `examples/explainer` at 1920x1080 from frame 600 on. Before TASK-222 the full 6660-frame render took 28m47s alone on this machine.

## Where a frame's time goes

One Renderer, PNG capture, timed per step of the frame job:

| Step                                     | ms per frame |
| ---------------------------------------- | ------------ |
| `page.screenshot` (PNG)                  | ~332         |
| Settlement (`settleFrame`)               | ~15          |
| Capture validation                       | ~4.4         |
| Warning collection                       | ~3.4         |
| Capture completion                       | ~2.7         |
| Whole frame, as `renderFrames` yields it | 274–358      |

The RPC round trips are under 10% of a frame; Chromium's PNG encode of a full-HD screenshot is the rest. Batching the round trips cannot move the rate, and a cheaper encode or more realms can.

## Format and realms

Whole-frame cost from `renderFrames`, same range:

| Configuration                | ms per frame |
| ---------------------------- | ------------ |
| 1 Renderer, PNG              | 274–358      |
| 1 Renderer, JPEG quality 92  | 143          |
| 4 Renderers, PNG             | 91           |
| 6 Renderers, PNG             | 85           |
| 8 Renderers, PNG             | 85           |
| 4 Renderers, JPEG quality 90 | 61           |
| 4 Renderers, JPEG quality 95 | 64           |

Realms scale to about 4 and then flatten: past the performance cores, more browsers only contend. Hence `defaultConcurrency()` is half of `os.availableParallelism()` (5 here), not all of it.

## JPEG quality

PSNR of the captured frame against its PNG capture, and of the H.264 output (`libx264`, the encoder's defaults) against the PNG source:

| Input    | Capture vs PNG | H.264 vs PNG source |
| -------- | -------------- | ------------------- |
| PNG      | —              | 39.8 dB             |
| JPEG q95 | 48.2 dB        | 39.3 dB             |
| JPEG q90 | 45.0 dB        | 39.2 dB             |
| JPEG q80 | 41.4 dB        | —                   |

The H.264 encode loses far more than JPEG q95 does, so q95 costs the video 0.5 dB, and the step to q90 buys 3 ms per frame for a visibly softer capture. `renderVideo` therefore captures JPEG q95; still frames and the frames route stay PNG, where the bytes are the product.

## How it was measured

Temporary timers around each step of `createFrameJob` (`src/render/capture/frame.ts`), reverted after the measurement; a script that opened N Renderers on the explainer and dealt 120 frames round-robin; PSNR by `ffmpeg -lavfi psnr` against the PNG capture of the same frames.
