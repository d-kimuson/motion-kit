# Many encoding tests fail at once while the machine is under heavy load

## Symptom

One full `pnpm test` run reported 43 failures in the `encoding` project (`src/render/encoding/ffmpeg.test.ts` and the other files under `src/render/encoding/`) while a 30-minute full video render and other agents' work ran on the same machine. Two immediate re-runs with nothing changed passed (669 tests in the full `pnpm test` run). The failure output was not kept, so the failing assertion or timeout is unknown.

## Workaround

1. When a mass failure appears, save the output of that run before re-running anything (run `pnpm test 2>&1 | tee <file>`, or copy the terminal output into a file), so the cause can be told apart (a `testTimeout`/`hookTimeout` expiry, a `waitFor` expiry, or FFmpeg being killed or out of memory).
2. Re-run the failing project when the machine is idle: `pnpm test --project encoding 2>&1 | tee <file>`.
3. If it passes, treat the first run as load-induced and go on.
4. If it fails again on an idle machine, it is a real failure: investigate it, and do not retry blindly.

## Why Not Fixed

The cause is not known: one observation, no kept output. The `encoding` project spawns the system FFmpeg for every case and sets `testTimeout: 60_000` and `hookTimeout: 20_000` (`vitest.config.ts`); the likeliest explanation is timeouts or process starvation under heavy concurrent load (inferred, not observed). Fixing it needs the failure output from a reproduction. Delete this troubleshot when the cause is found and fixed, or when it has not recurred for a long time.
