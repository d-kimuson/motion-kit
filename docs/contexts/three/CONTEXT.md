# three

3D on the timeline. three is the only context that imports Three.js and React Three Fiber; it drives the R3F frame loop from motion-kit time instead of the browser clock. Its seekability guarantees are what Spike B establishes.

## Ubiquitous Language

| Term           | Code            | Definition                                                                                  |
| -------------- | --------------- | ------------------------------------------------------------------------------------------- |
| ThreeCanvas    | `ThreeCanvas`   | An R3F canvas with `frameloop="never"` advanced once per rendered frame from timeline time. |
| CameraRig      | `CameraRig`     | A camera whose pose is a function of time.                                                  |
| Manual Advance | `advance(time)` | Rendering one R3F frame at a given time, the only way the scene progresses.                 |

## Invariants

- The R3F clock never runs on its own; every frame is advanced from the timeline.
- Nothing outside `src/three` imports `three` or `@react-three/*` (lint-enforced).
