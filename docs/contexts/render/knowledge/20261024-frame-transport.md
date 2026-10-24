# Frame transport qualification

On 2026-10-24, the TASK-157 transport suite passed on macOS arm64, Node 26.12.0, Playwright 1.64.1 and Chromium 156.0.8078.4. This is fixed-environment DOM/CSS/SVG/Canvas evidence, not cross-platform or GPU certification. Chromium uses the sandboxed default launch profile; software-WebGL is not enabled for this 2D fixture.

## Reproduce

```sh
pnpm test --project frame-transport
# Opt-in negative controls; run alone, never alongside tests or a live renderer.
# The runner restores each changed source in finally and rejects survivors.
DIRENV_DISABLE=1 timeout 600 node scripts/mutate-frame-transport.ts
```

The checked fixture is `src/core/runtime/fixtures/capture.tsx`; host assertions are in `src/render/renderer.test.ts` and `src/render/capture/frame.test.ts`. Browser tests explicitly have 60-second timeouts. CI installs Chromium and runs `frame-transport` alongside the existing projects.

## Pixels and comparison modes

The composition is 64×64, DPR 1, at rational FPS 30000/1001, with six valid frames. PNGs use `animations: 'allow'`, CSS-pixel scale and a composition-sized crop at (0,0). Decoding frame 2's PNG in Chromium yields these exact RGBA samples:

| Position | Content                      | RGBA          |
| -------- | ---------------------------- | ------------- |
| (8,8)    | DOM background               | (80,0,0,255)  |
| (40,8)   | CSS background               | (0,0,255,255) |
| (8,40)   | SVG rectangle                | (0,80,0,255)  |
| (40,40)  | Canvas layout-effect drawing | (0,0,80,255)  |

The determinism test compares PNG **bytes**, not only nonempty output or metadata:

| Mode         | Compared against sequential baseline                                    |
| ------------ | ----------------------------------------------------------------------- |
| Sequential   | Frames 0–5 through `renderFrames({ from: 0, to: 6 })`                   |
| Single frame | Frame 5 as the first frame in a separate renderer                       |
| Random order | 4,1,5,0,3,2                                                             |
| Reverse      | 5,4,3,2,1,0                                                             |
| Repeated     | 2,2,2                                                                   |
| Fresh realm  | First frames 0,2,5 after separate selections, with the same service PID |
| Held session | Frame 5 after a 150 ms hold of the healthy realm                        |

Every listed comparison passed. The test separately asserts **frame 0 differs from frame 5**. The hold is a negative-control observation interval, never a readiness condition. A detected Tier C registration separately returns `seek.uncontrolled`; this test does not claim hidden-history detection for arbitrary code.

## Ownership, failure and teardown

- Readiness gates screenshot; validation precedes it and accepted completion follows it.
- A real integration source changes from version 1 to 2 after screenshot: the host discards the first PNG, re-settles and captures again, with generation `[2,2]`. Changed-version final acceptance and pre-capture invalidation also have isolated host tests.
- A second renderer frame waits through the first screenshot; canceling a queued middle request neither mutates the active snapshot nor consumes a core frame generation.
- A forged stale-generation ready lease and a generation invalidated during screenshot produce aborted outcomes, not PNGs. Page protocol tests reject cross-mode requests and duplicate completion.
- Never-settling required asset work yields `asset.not-ready` with redacted current inventory and the configured budget. A failed integration asset yields `asset.load-failed`. A pending non-asset acknowledgement and a synchronously blocked page RPC yield `render.frame-timeout`.
- Active cancellation yields exactly `{ ok: false, aborted: true }`. Queue expiry and an unfinished ownership grant do likewise; late grants are rejected. A late screenshot cannot reach completion/publication.
- Known current inventory is queried only from a responsive coordinator; its bounded 100 ms diagnostic probe is outside publication. A blocked RPC gets no invented inventory.
- Real-browser failure/cancellation/stale-generation cases assert OS process nonexistence (`kill(pid,0)` fails for loading child and browser), refused HTTP fetch and removed workspace. Normal disposal is checked the same way. The conservative policy terminates the whole owned session after active failure rather than reusing a poisoned realm.

## Mutation matrix

Nine mutants were executed individually against the named tests; all nine were killed by assertions, then the restored suite passed. No survivors were accepted.

| Mutant                                | Killing test                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture before settlement             | `awaits readiness and validates both sides of dimensioned capture`                                                                          |
| Skip pre-capture validation           | `awaits readiness and validates both sides of dimensioned capture`                                                                          |
| Charge the frame budget while queued  | `does not charge queue residence to the frame budget`                                                                                       |
| Omit generation comparison            | `suppresses a stale generation before screenshot`                                                                                           |
| Crop one pixel too narrow             | `captures exact DOM CSS SVG Canvas pixels at the composition crop`                                                                          |
| Ignore caller cancellation            | `suppresses a canceled generation even when screenshot finishes late`                                                                       |
| Publish without completion acceptance | `discards changed-version pixels then publishes only accepted replacement bytes`                                                            |
| Constant frame fixture                | `matches sequential single random reverse repeated fresh-realm and held-session bytes with nonconstant frames` (different-frame inequality) |
| History-dependent fixture output      | The same determinism test (traversal byte equality)                                                                                         |

## Runtime observations

Measured serially with `/usr/bin/time -p pnpm test --project <name>` in the worktree:

| Project         | Tests | Vitest duration | Process wall time |
| --------------- | ----- | --------------- | ----------------- |
| unit            | 269   | 5.24 s          | 5.85 s            |
| composition-dom | 51    | 1.21 s          | 1.86 s            |
| loading         | 68    | 44.41 s         | 44.84 s           |
| frame-transport | 30    | 19.54 s         | 19.97 s           |

The complete `pnpm test` run passed **418 tests / 27 files**, 48.09 s Vitest / 48.67 s process wall time. A separate verbose pixel-test run measured **786.04 ms** for loading plus selection of the small warm-filesystem fixture (browser/config startup, default/props validation and realm replacement included); first capture and teardown are excluded from that measurement. This is not a cold-project service-level guarantee. `pnpm fix`, `pnpm lint`, `pnpm typecheck`, `lake build`, and `node scripts/lean-spec.ts check src/core` also passed.

## Residual qualification

- TASK-158 still owns asset registration/discovery/cache APIs and concrete font/image/model/upload cooperation. Transport consumes an integration's current inventory and settlement; it does not infer that arbitrary DOM assets are ready.
- The Phase 1 traversal suite is `src/render/determinism` ([phase 1 determinism](20261024-phase1-determinism.md)). It covers combined nested Suspense with a font and image, and repeated passes in one session. Hung GPU fences and Linux qualification remain CI/platform work. Broader source-change combinations stay in the transport tests, not that suite.
- Motion/R3F/WebGL adapters, arbitrary hidden clocks/history, encoding, CLI, and untrusted isolation are not added. The tested blocked page RPC verifies host termination, not a particular GPU driver fence.
- The renderer is fail-closed: active failure/cancel disposes the entire session. Automatic in-place recovery is not claimed. Browser teardown overhead and the bounded diagnostic inventory probe are not permission to publish after the original frame deadline.
