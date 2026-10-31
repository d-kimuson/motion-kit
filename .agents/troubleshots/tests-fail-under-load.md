# Many tests fail at once under heavy machine load

## Symptom

A full `pnpm test` fails in a different place on each run while other agents' work (and sometimes a full video render) runs on the same machine, then passes unchanged when re-run on an idle one. Observed on an 11-core machine at load average 13–24:

```
FAIL  src/core/timeline/time.oracle.test.ts > Time > matches Lean at arbitrary rational positions and on both sides of signed half-frame ties
Error: Test timed out in 5000ms.
```

```
FAIL  src/render/loading/loading.test.ts > bounds a synchronously blocked plugin and removes its service process/workspace
Error: ENOENT: no such file or directory, open '<tmp>/motion-kit-project-XXXX/blocked.json'
 ❯ src/render/loading/loading.test.ts:788
```

Both files pass when run alone, and every project passes with `pnpm test --project <name>`. One full run reported 43 failures under the same conditions; two immediate re-runs passed (669 tests then, 877 after the `/three` work).

## Workaround

1. Run `pnpm test 2>&1 | tee <file>` so the output is kept from the start. If a run already failed without it, copy the terminal output into a file before running anything else. The saved output tells the causes apart (a `testTimeout`/`hookTimeout` expiry, a `waitFor` expiry, a file the test expected another process to write, or FFmpeg being killed or out of memory).
2. Re-run the failed files, or the full `pnpm test`, when the machine is idle: `pnpm test <failed file> 2>&1 | tee <file>`. Do not re-run only one project unless every failure belongs to it.
3. If it passes, treat the first run as load-induced and go on.
4. If it fails again on an idle machine, it is a real failure: investigate it, and do not retry blindly.

CI avoids the condition by running one project per step (`pnpm test --project <name>` in `.github/workflows/check.yaml`); a local full run executes every project with Vitest's default file parallelism.

## Why Not Fixed

The failures are timeouts and process starvation under concurrent load, not logic bugs: the `unit` project keeps Vitest's default 5 s `testTimeout`, so a Lean differential case or a React DOM case can miss it when the CPU is oversubscribed, and the `loading` project's blocked-plugin case needs the spawned plugin to write its record before the 1500 ms startup timeout, after which the test reads the file and gets `ENOENT`.

A fix needs a timing policy, which is a judgement call: raise `testTimeout` for the `unit` project, lower `maxWorkers`, or both. Without that decision the workaround above stands. Delete this troubleshot when the policy is in place and a loaded run no longer fails.
