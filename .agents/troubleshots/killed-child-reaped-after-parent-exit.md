# A killed child outlives its parent's exit

## Symptom

`src/cli/cli.test.ts` "ends a second SIGINT 1000ms into the cleanup window …" fails on Linux CI and
only there, once every few runs, always at the same assertion:

```
AssertionError: expected false to be true // Object.is equality
 ❯ src/cli/cli.test.ts:671:69
```

That line read `expect(childGone(Number(readFileSync(encoderPid, 'utf8')))).toBe(true)` straight
after the run's `exit`. The run's cover had killed the encoder and removed its `.part` sibling (the
assertions above it passed); the encoder still answered `process.kill(pid, 0)` because the OS had
not scheduled its death and reaped it yet. It was seen on the `120ms` variant on PR #30 and #31 and
on the `1000ms` variant on `main` (`a81fce7`), and never on a macOS dev box: 60 iterations of the
test under 12 spinning cores, plus a minimal `node -e` reproduction (a parent that `SIGKILL`s a child
ignoring `TERM` and exits at once), always found the child already gone.

## Workaround

Poll for the death with `waitFor` instead of reading it once, and keep the bound far below the
stand-in's own lifetime so the wait still proves the run killed it:

```ts
const encoder = Number(readFileSync(encoderPid, 'utf8'));
await waitFor(() => childGone(encoder), 10_000, 'the encoder it killed to be gone');
```

Do not assert `childGone` synchronously for a child of a run that a signal ended.

The same call answers the other direction. When a test means "the run is still there, so the signal
sent next lands on it", read it with `childGone(pid)`, not `run.child.exitCode`: the code moves when
the exit event is delivered, which can be after the exit itself, so a guard written on it passes for
a run that is already gone and the signal lands on nothing (that is how the teardown-window case
reported `expected { code: 0 } to equal { code: 130 }`). Do not sleep a guessed gap to land inside a
window either: wait for a fact the run produces and stall the teardown so the window is wider than
the work.

## Why Not Fixed

`process.kill(pid, 0)` answers for any process in the process table, and a killed but unreaped
process is still in it. The cover has to kill and exit synchronously, because an exiting process
runs no promise (`src/lib/exit.ts`), so the run cannot wait for the reap: the OS does, when it gets
to it. A Linux runner under load schedules and reaps the orphan later than macOS' `launchd` does
here, which is why only CI loses the race. The product's promise is that the child is killed and
its temporary sibling removed before the caller sees the exit, not that the kernel has reaped it;
asserting the reap would need a `waitpid` the exit path cannot perform.
