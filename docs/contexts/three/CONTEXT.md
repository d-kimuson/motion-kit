# three

3D on the timeline. three is the only context that imports Three.js and React Three Fiber; it drives the R3F frame loop from motion-kit time instead of the browser clock. Its seekability guarantees are what Spike B establishes; the API that ships them is the [accepted capability ADR](adr/20261031-three-canvas-capability-api.accepted.md).

## Ubiquitous Language

| Term              | Code                       | Definition                                                                                                                |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ThreeCanvas       | `ThreeCanvas`              | An R3F canvas with `frameloop="never"` advanced once per rendered frame from timeline time.                               |
| CameraRig         | `CameraRig`                | A camera whose pose is a function of time, written absolutely on every committed frame.                                   |
| Camera Pose       | `CameraPose`               | The absolute camera state one frame asks for: position, `lookAt`, `up`, and optionally `fov`/`zoom`.                      |
| Manual Advance    | `advance(time)`            | Rendering one R3F frame at a given time, the only way the scene progresses.                                               |
| Canvas Settlement | `settle(snapshot, signal)` | The canvas's readiness and render work for one frame generation: root and size, committed generation, advance, GPU fence. |
| Generation Probe  | `GenerationProbe`          | The last child of a canvas's own Suspense boundary; it reports the frame generation of the commit it committed in.        |

## Invariants

- The R3F clock never runs on its own; every frame is advanced from the timeline.
- A canvas advances only its own root (`advance(seconds, false)`): never global effects, never another canvas.
- Nothing outside `src/three` imports `three` or `@react-three/*` (lint-enforced).
- `preserveDrawingBuffer` is always true and `dpr` defaults to 1, so a capture reads the buffer the frame was drawn into and does not depend on the host display.
- `CameraRig` writes every pose field on every committed frame; an omitted `fov`/`zoom` is the camera's value at mount, never the previous frame's.
- A frame is captured only after the canvas's own Suspense boundary has committed the frame's generation and the root has a non-zero measured size. A fallback commit is not a canvas acknowledgement.
- A canvas with no `useFrame` subscriber is Tier B; any subscriber makes it Tier C, reported as `seek.uncontrolled`. motion-kit's own components never register one, and an unknown canvas is never assumed seekable because it advances manually.
- The tier is read through `IntegrationRegistration['seekability']` as a getter, evaluated when a host asks for warnings, not when the integration registers.
- A lost WebGL context fails the frame as `render.page-error`; recovery is TASK-185.
- `three` and `@react-three/fiber` are optional peer dependencies the user installs. The package root's browser graph never contains them.
