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

## Development process terms

Terms of how agents work on this repository, used by `docs/guidelines/`.

| Term              | Meaning                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SubAgent          | An agent started from the current agent for a bounded piece of work (an investigation, a review, a QA Check). It returns its result to the agent that started it |
| Independent Agent | A SubAgent that takes a delegated task to the definition of done (`docs/guidelines/delegate.md`) in its own worktree and context                                 |
| User task         | A Backlog task waiting for the user's decision or action, assigned to the user's actor (`docs/guidelines/backlog.md`)                                            |
| Maintenance task  | A recurring task auto-pilot starts when its trigger is reached: `.agents/auto-pilot/maintenance-tasks/<name>/` (`docs/guidelines/auto-pilot.md`)                 |

## Relations

- Every context depends on `core` for time. `core` depends on React/ReactDOM for the tree/browser bootstrap, Zod for Composition schemas, and `src/lib`, never host or integration contexts.
- `motion`, `theme`, `three`, and `presets` depend on `core`; `presets` also depends on `motion` and `theme`, and its `three` presets on `three`. None of them depends on `render` or `agent`.
- `three` is the only context that imports Three.js and React Three Fiber (lint-enforced).
- `render` depends on `core` and evaluates whatever the Composition contains; it never imports `presets` or `three` directly. Node.js APIs are allowed only in `render` and `agent` (lint-enforced).
- `agent` depends on `render` for `render` and `frame`, and on `core` and `presets` metadata for `inspect` and `validate`.
- A value crosses a boundary as a plain data type (a `Result`, a `Diagnostic`, a time value from the Time Module), never as a React component instance or a library object.
- The accepted [composition-loading design](contexts/render/design-doc/20261024-composition-loading.md) keeps Node-owned generated-entry/HTML-shell source in `src/render/loading`, but its emitted page graph imports only user browser code, core's browser-only `@kimuson/motion-kit/browser` bootstrap (not re-exported by the root) and browser-safe dependencies. It never imports `src/render`, `src/cli`, or agent CLI modules. Core/shared-root lint now rejects host and integration imports, and a resolved public-root browser build checks transitive dependencies and negative built-in/aliased-host fixtures. TASK-157 extends those checks to its browser subpath and generated entry; this is not yet enforcement of every context relation.
- Preview and renderer share core's Composition runtime implementation and the registry loading contract, never a loading session or Composition realm. Preview UI scheduling runs outside the composition iframe and needs neither CDP nor host clock patches; render owns external browser/deadline/capture supervision.
