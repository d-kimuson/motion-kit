# Tests that assert a real-time budget fail while the machine is busy

## Symptom

A full-suite run beside other work — another agent's `pnpm test` in a sibling worktree, a `pnpm dev`
server, or both — fails one or two tests that measure a real-time budget. Observed on this repository,
with the exact text:

```sh
DIRENV_DISABLE=1 pnpm test
```

```text
Test Files  1 failed | 87 passed (88)
Tests       1 failed | 1087 passed (1088)

FAIL |loading| src/render/loading/loading.test.ts > supervised loading session > restarts individual defaults and later props budgets, kills a blocked later parse, and never keeps the poisoned realm
src/render/loading/loading.test.ts:376:24
```

```text
FAIL |frame-transport| src/render/capture/frame.test.ts > host frame lease > re-settles changed versions before taking any screenshot
src/render/capture/frame.test.ts:146:35
  expected { ok: false, error: [ { …(5) } ] } to match object { ok: true }
```

A third, on another loaded run, is a timeout rather than an assertion:

```text
FAIL |frame-transport| src/render/determinism/examples.determinism.test.ts > reference example probes > captures the explainer example identically across the eight traversal modes
Error: Test timed out in 60000ms.
```

Three more were seen on loaded machines, all gone on a quiet re-run:

- An examples smoke test (`examples/*/*.smoke.test.ts`) timed out at its 120 s limit after Vite's dependency scan read a temporary `entry.tsx` while it was still being written.
- `src/cli/cli.test.ts` > `refuses a unrelated manifest collision before writing any PNG` failed on timing (the `%s` of its `it.each` is `unrelated`).
- The `three-dom` project once reported `6 passed (7)` with no failure listed. The seventh test was not reported at all, and the cause was not identified. Do not read that line as a pass: re-run the file with `--silent=false` and see that every test is accounted for.

Every one of them passes in isolation on the same machine (`pnpm vitest run <file>`, repeated three
times for `frame.test.ts`), and a full suite of the same code passed 1088/1088 when the machine was
quiet. `src/render/loading/loading.test.ts` itself took 100095 ms for 44 tests in the failing run.

## Workaround

Re-run the failing file in isolation before investigating:

```sh
pnpm vitest run src/render/loading/loading.test.ts
pnpm vitest run --project frame-transport src/render/capture/frame.test.ts
pnpm vitest run --project frame-transport src/render/determinism/examples.determinism.test.ts
pnpm vitest run examples/<name>/<name>.smoke.test.ts
pnpm vitest run src/cli/cli.test.ts -t "refuses a unrelated manifest collision"
```

A pass in isolation, on a code path the change does not touch, means the machine was starved, not that
the change regressed. Treat it as a real defect only when it fails at the same assertion on an idle
machine, or on CI. CI runs on a clean runner, so its verdict is the authoritative one for these files.

## Why Not Fixed

Both failing assertions measure wall-clock time against a real deadline with almost no margin:
`open(root, 3000)` in the loading test runs a fixture whose entry awaits 1600 ms per props parse, and
`src/render/capture/frame.test.ts` builds its job with `make()`'s default `frameTimeoutMs = 100` on real
timers, so an event-loop stall longer than 100 ms fires `render.frame-timeout` before the mocked
promises resolve. The real fix is to time only the work under test or to run those cases on fake
timers, which changes what the tests measure; that is a test-design change of its own, not a workaround
to adopt silently here.
