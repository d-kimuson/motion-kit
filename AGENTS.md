# motion-kit

## Overview

motion-kit is an agent-first framework for programmatic video: scenes are written as React/TSX on a deterministic timeline, every frame is a pure function of time, and the render pipeline captures frames in Chromium (Playwright) and encodes them with FFmpeg. A CLI and structured diagnostics let coding agents render, inspect, and validate compositions without a GUI. It is an MIT alternative to Remotion, published as `@kimuson/motion-kit` with subpath exports (`/motion`, `/theme`, `/presets`, `/three`).

Stack: TypeScript, React, Zod (schema-first props and CLI input), Three.js + React Three Fiber (optional, `/three` only), Node.js for rendering and the CLI. Tooling: pnpm, oxlint/oxfmt, vitest + fast-check, Lean 4 specs for the time module.

The product vision lives in `docs/tmp/design.md` on the author's machine (gitignored, not in the repository). Decisions taken from it are recorded as ADRs and in `docs/contexts/*/CONTEXT.md`.

## Directory Structure

```text
.
├── AGENTS.md
├── REVIEW.md                  # Points to the review guideline
├── src/
│   ├── index.ts               # Root entry (public API)
│   ├── lib/                   # Shared utilities with no domain meaning (clock, Result, ...)
│   ├── core/                  # core context: Time Module, timeline, sequence, transition (Lean specs next to the code)
│   ├── motion/                # motion context: pure interpolation and Animate/Reveal/Stagger
│   ├── theme/                 # theme context: defineTheme, resolution, scoped CSS variables
│   ├── three/                 # three context: the only place that imports Three.js / R3F
│   ├── presets/               # presets context: schema-first scene templates with metadata
│   ├── render/                # render context: browser capture, media, encoding (Node only)
│   ├── agent/                 # agent context: inspect/validate for coding agents
│   └── cli/                   # agent context: `motion-kit` CLI (Node only)
├── spec/                      # Lean oracle (Oracle.lean) and the differential-test helper (oracle.ts)
├── scripts/                   # Repository tooling run by package.json scripts (lean-spec, check-licenses)
├── configs/                   # Test setup files
├── docs/
│   ├── CONTEXT-MAP.md         # Bounded contexts and their dependencies
│   ├── contexts/<ctx>/        # CONTEXT.md, adr/, design-doc/, knowledge/ per context
│   ├── decisions/             # Cross-context ADRs
│   ├── design-doc/            # Cross-context Design Docs
│   └── guidelines/            # Guidelines referenced from the table below
├── .agents/troubleshots/      # Workarounds for tooling problems
├── .agents/auto-pilot/        # auto-pilot state, maintenance tasks, and its own workarounds
├── lakefile.toml, lean-toolchain  # Lean project (specs under src/core)
└── .github/                   # CI (check.yaml) and composite setup actions
```

Only `src/lib` and `src/core` exist today; the other `src/` directories are created when their context gets its first code.

## Feedback Loop

| Command                                  | Checks                                                                                                                                                                                                                         | When to run                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `pnpm fix`                               | Auto-fixes oxlint findings and formatting                                                                                                                                                                                      | Always, before the checks below                                                   |
| `pnpm lint`                              | oxlint (correctness, determinism and dependency-boundary restrictions, import cycles), oxfmt formatting, dependency license allowlist (`scripts/check-licenses.ts`), Lean spec hygiene (`scripts/lean-spec.ts check src/core`) | Always                                                                            |
| `pnpm typecheck`                         | TypeScript (`tsconfig.json`, strictest)                                                                                                                                                                                        | Always                                                                            |
| `lake build`                             | Lean proofs under `src/core` and the `spec-oracle` binary the differential tests need                                                                                                                                          | A `*.lean` file changed, or `.lake/` is missing (fresh clone); before `pnpm test` |
| `node scripts/lean-spec.ts doc src/core` | Regenerates `<name>.lean.md` next to each Lean spec                                                                                                                                                                            | A `*.lean` file changed; commit the regenerated docs                              |
| `pnpm test`                              | vitest unit tests, property-based tests, and Lean differential tests (`*.oracle.test.ts`)                                                                                                                                      | Always                                                                            |

CI (`.github/workflows/check.yaml`) runs `pnpm lint`, `pnpm typecheck`, `lake build` (via `leanprover/lean-action`), and `pnpm test` on pushes to `main` and on pull requests, plus a gitleaks scan of the history. The pre-commit hook (`lefthook.yml`) fixes staged files with oxlint/oxfmt and runs gitleaks on the staged changes.

## References

References contain important instructions that are intentionally separated for progressive disclosure.
Always read every reference relevant to the task before making changes.

| When to read                                                                                                  | Reference                                                              |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Deciding how to proceed with a task, or how far to take an implementation task (commit, push, PR, merge)      | `docs/guidelines/delegate.md`                                          |
| Committing                                                                                                    | `docs/guidelines/commit.md`                                            |
| Writing documentation                                                                                         | `docs/guidelines/writing/index.md` and the guide for the document type |
| Checking what a term means, adding or changing a term                                                         | `docs/CONTEXT-MAP.md` and the context's `CONTEXT.md`                   |
| Changing AGENTS.md, guidelines, skills, or troubleshots                                                       | `docs/guidelines/harness.md`                                           |
| Writing or changing code                                                                                      | `docs/guidelines/coding/index.md`                                      |
| Verifying a change by running it (QA Check), deciding what kind of tests to write, reproducing a failing test | `docs/guidelines/quality-assurance/index.md`                           |
| Writing or changing a Lean spec, writing a differential test                                                  | `docs/guidelines/quality-assurance/lean-spec.md`                       |
| Adding tools or dependencies                                                                                  | `docs/guidelines/local-dev.md`                                         |
| Checking, filing, or updating tasks                                                                           | `docs/guidelines/backlog.md`                                           |
| Asking the user or the team a question, or reporting to them                                                  | `docs/guidelines/team-channel.md`                                      |
| Leading the progress of the project (when started as auto-pilot)                                              | `docs/guidelines/auto-pilot.md`                                        |
| A command or tool fails unexpectedly                                                                          | `.agents/troubleshots/`                                                |

## Code Review Rules

When asked to review code, read `REVIEW.md` in full and follow it.
