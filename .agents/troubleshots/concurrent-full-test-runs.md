# A full `pnpm test` fails only while other worktrees run theirs

## Symptom

`pnpm test` in one worktree fails with Vite errors and 60-second tests that pass on their own, while
`pnpm test` in other worktrees of the same repository is running at the same time:

```text
(!) Failed to run dependency scan. Skipping dependency pre-bundling. Error: Failed to scan for dependencies from entries:
TypeError: Error during dependency optimization:
 FAIL  |frame-transport| src/render/determinism/examples.determinism.test.ts > reference example probes > captures the teaser example identically across the eight traversal modes
Error: Test timed out in 60000ms.
 FAIL  |loading| src/render/loading/loading.test.ts > supervised loading session > restarts individual defaults and later props budgets, kills a blocked later parse, and never keeps the poisoned realm
AssertionError: expected false to be true
 Test Files  3 failed | 84 passed (87)
```

The failing set moves between runs, every failure is a timeout or a timing assertion, and the run
takes about 600 s instead of the usual 370 s.

## Workaround

Run one full suite at a time per machine. Before starting, check what else is running and wait:

```sh
pueue status | grep Running
pueue wait   # or wait for the other task ids
```

`pueue status` takes no task id: its arguments are a filter query, so `pueue status <id>` fails with `Failed to parse query` (pueue 4.0.4). To follow one task, wait for it and read its log:

```sh
pueue wait <id>
pueue log <id> --lines 80
```

If a run fails this way, re-run it alone before investigating the failing tests: no source change is
needed and the same run passes. A failure that reproduces with nothing else running is a real defect.

A run can also end without any test failure: a full `pnpm test` started with pueue can be killed by `SIGTERM` partway through, with no failing test in its log and no known sender. Re-running it alone passed. Treat it like the failures above: run it again before looking for a cause, and start looking only if it is killed again with nothing else running.

## Why Not Fixed

One full suite already opens several Playwright Chromium instances, Vite servers in temporary
project directories, FFmpeg children and the Lean oracle; three or four suites together exceed the
machine, and Vite's dependency scan and the 30–60 s test budgets give up first. The budgets cannot be
raised without hiding the real hangs they exist to catch, and the suites share the machine by design
(one worktree, one suite). Serializing whole runs is the fix, and it belongs to whoever starts the
runs.
