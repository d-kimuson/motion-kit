# Phase 1 determinism suite

The TASK-160 Phase 1 exit suite passed on macOS arm64, Node 26.12.0, Playwright 1.64.1 and Chromium 156.0.8078.4. It is fixed-environment, same-run evidence: each run captures its own sequential 0..N baseline and compares every other traversal mode against that baseline. It is not cross-GPU or cross-platform certification; those need an explicit `{ purpose: 'cross-environment', maxDifferentBytes }` tolerance (§13.5).

## Reproduce

```sh
pnpm test --project frame-transport
# Opt-in negative controls; run alone, never alongside tests or a live renderer.
# The runner restores each changed source in finally.
DIRENV_DISABLE=1 timeout 600 node scripts/mutate-determinism.ts
```

The suite lives in `src/render/determinism` (`suite.ts` = reusable runner, `compare.ts` = byte comparison). `defineDeterminismSuite({ composition, frames })` takes a Composition module and a frame list, so the motion, three and presets contexts can register their own reference compositions later as `*.determinism.test.ts`. Browser tests explicitly have 60-second timeouts; the tests are wired into the existing `frame-transport` CI project, so no new CI job is required.

## Reference compositions

All are 64×64, DPR 1, 30 fps, six frames, in `src/render/determinism/fixtures/references.tsx`:

| Composition          | Covers                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `dom-text`           | DOM text with a `useAsset` font                                   |
| `css-transform`      | CSS `translate`/`rotate` driven by the frame                      |
| `svg-path`           | SVG path geometry driven by the frame                             |
| `canvas-drawing`     | Canvas 2D layout-effect drawing; runs with sustained passes       |
| `sequence-boundary`  | `Sequence` start/end boundaries                                   |
| `transition-overlap` | `TransitionSeries` overlap with `useTransitionProgress`           |
| `asset-suspense`     | Nested `Suspense` around a `useAsset` font and image              |
| `nondeterministic`   | `Math.random()` render — the negative control the suite must fail |

## Traversal modes

The seven required modes are compared byte-for-byte against the sequential baseline:

| Mode                | Order compared                                                   |
| ------------------- | ---------------------------------------------------------------- |
| `sequential-then-n` | Frame N re-read after the 0..N sweep                             |
| `random`            | A seeded, non-sequential permutation that visits N, then N again |
| `reverse`           | N..0                                                             |
| `repeated`          | N,N,N                                                            |
| `fresh-realm`       | N after re-selection; fails if the loading service PID restarts  |
| `held-session`      | N after a 150 ms hold of the healthy realm                       |
| `fresh-renderer`    | N alone in a newly opened renderer                               |

`canvas-drawing` additionally enables `sustained-session` (six repeated passes in one session) to cover resource growth. Exact bytes are the default; a tolerance is accepted only as `{ purpose: 'cross-environment', maxDifferentBytes }`.

## Fail-closed

The suite fails closed: a required mode that did not run is recorded as a failure, not silently dropped. `framesDiffer` is also asserted — a constant composition cannot prove traversal independence, so identical sequential captures fail the composition. The `nondeterministic` composition proves the suite can fail and names the differing bytes.

## Mutation matrix

Two mutants were executed against `scripts/mutate-determinism.ts`; both were killed, then the restored suite passed.

| Mutant                       | Killing test                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| Compare only frame lengths   | `compares exact PNG bytes unless a cross-environment tolerance is explicit`                        |
| Skip the fresh-renderer mode | `captures DOM text identically across sequential, fresh, random, reverse, repeated and held modes` |

## Runtime observations

Measured serially with `/usr/bin/time -p pnpm test --project <name>` in the worktree:

| Project         | Tests | Process wall time |
| --------------- | ----- | ----------------- |
| unit            | 322   | 5.65 s            |
| composition-dom | 79    | 2.20 s            |
| loading         | 68    | 46.65 s           |
| frame-transport | 44    | ~28 s             |

`pnpm fix`, `pnpm lint`, `pnpm typecheck`, `lake build`, and `node scripts/lean-spec.ts check src/core` also passed.

## Residual qualification

- The suite certifies same-environment traversal byte identity. Cross-GPU/browser certification remains Phase 2 work using each environment's own baseline and an explicit cross-environment tolerance. Linux CI runs this suite via `frame-transport`; a green Linux run is still not cross-GPU certification.
- Hung GPU fences, context loss, and headless-vs-headed divergence are CI/platform work, not this suite. Motion/R3F/WebGL adapters, encoding, and the CLI are not added here.
