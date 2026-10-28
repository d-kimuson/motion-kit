# Many render tests fail at once while the machine is under heavy load

## Symptom

One full `pnpm test` run reported 43 failures while a 30-minute full video render and other agents' work ran on the same machine. Two immediate re-runs with nothing changed passed (669 tests in the full `pnpm test` run). The failure output was not kept, so the failing projects, files, and assertions or timeouts are unknown.

## Workaround

1. Run `pnpm test 2>&1 | tee <file>` so the output is kept from the start. If a run already failed without it, copy the terminal output into a file before running anything else. The saved output tells the causes apart (a `testTimeout`/`hookTimeout` expiry, a `waitFor` expiry, or FFmpeg being killed or out of memory).
2. Re-run the failed files, or the full `pnpm test`, when the machine is idle: `pnpm test <failed file> 2>&1 | tee <file>`. Do not re-run only one project unless every failure belongs to it.
3. If it passes, treat the first run as load-induced and go on.
4. If it fails again on an idle machine, it is a real failure: investigate it, and do not retry blindly.

## Why Not Fixed

The cause is not known: one observation, no kept output. The `encoding`, `frame-transport`, `loading`, and `cli` projects spawn the system FFmpeg or Chromium and set their own `testTimeout` (60_000) and `hookTimeout` (20_000 or 60_000) in `vitest.config.ts`; the likeliest explanation is timeouts or process starvation under heavy concurrent load (inferred, not observed). Fixing it needs the failure output from a reproduction. Delete this troubleshot when the cause is found and fixed, or when it has not recurred for a long time.
