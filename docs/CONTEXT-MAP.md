# Context Map

| Context | Responsibility                                                                                                                                   | Implementation                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| core    | The master clock: Composition, timeline, Sequence, Transition, the Time Module (frame/time conversion, rounding), asset readiness, runtime hooks | `src/core`, root export            |
| motion  | Deterministic values from time: `interpolate`, `spring`, `keyframes`, easing; `Animate`, `Reveal`, `Stagger`; the motion library integration     | `src/motion`, `/motion`            |
| theme   | Defaults and direction for expression: `defineTheme`, token resolution by priority, scoped CSS variables, fonts                                  | `src/theme`, `/theme`              |
| three   | 3D on the timeline: `ThreeCanvas`, `CameraRig`, manual frame advance for React Three Fiber                                                       | `src/three`, `/three`              |
| presets | Reusable scene components with Zod schemas and agent-facing metadata (typography, backgrounds, transitions, three)                               | `src/presets`, `/presets`          |
| render  | Turning a Composition into frames and a file: browser capture, readiness barrier, media, encoding                                                | `src/render` (Node only)           |
| agent   | What a coding agent operates: the CLI (`render`, `frame`, `inspect`, `validate`), diagnostics, layout checks                                     | `src/agent`, `src/cli` (Node only) |

`src/lib` holds utilities with no domain meaning (`Result`, clock abstractions) that any context may import.

## Relations

- Every context depends on `core` for time. `core` depends on nothing but React and `src/lib`.
- `motion`, `theme`, `three`, and `presets` depend on `core`; `presets` also depends on `motion` and `theme`, and its `three` presets on `three`. None of them depends on `render` or `agent`.
- `three` is the only context that imports Three.js and React Three Fiber (lint-enforced).
- `render` depends on `core` and evaluates whatever the Composition contains; it never imports `presets` or `three` directly. Node.js APIs are allowed only in `render` and `agent` (lint-enforced).
- `agent` depends on `render` for `render` and `frame`, and on `core` and `presets` metadata for `inspect` and `validate`.
- A value crosses a boundary as a plain data type (a `Result`, a `Diagnostic`, a time value from the Time Module), never as a React component instance or a library object.
