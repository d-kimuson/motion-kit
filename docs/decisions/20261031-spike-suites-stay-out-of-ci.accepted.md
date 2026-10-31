# Keep the spike suites out of the CI gates and qualify them on Linux on demand

## Context

Four Phase 0 spikes established the accepted browser contracts: [Motion
seeking](../contexts/motion/adr/20261023-explicit-motion-seeking.superseded.md) and the [explicit
browser clock](20261023-explicit-browser-clock.accepted.md), [R3F advance](../contexts/three/adr/20261023-explicit-r3f-advance.superseded.md),
and [asset readiness](20261023-asset-readiness-registry.accepted.md). They are experiments, not
shipped code: `package.json`'s `files` allowlist excludes `spikes/`, and `pnpm test` never runs them.
Each spike report therefore ended with "Linux CI is not yet qualified" and added no browser job.

TASK-177 ran the four suites and the R3F flag matrix five times each on `ubuntu-latest`, the runner
`check.yaml` uses. [The qualification record](../contexts/render/knowledge/20261031-linux-spike-qualification.md)
has the environment, the per-run measurements and the renderer backend. `motion`, `three` and
`three-flags` passed 5/5. `assets` failed 5/5 on one screenshot pixel in the font fixture and `clock`
passed 1/5 on an unattributed comparison mismatch. None of the failures showed a missing readiness
barrier, and none is a property a shipped path depends on.

_Amended 2026-10-31 (TASK-177):_ five further runs (41207262712, 41219905051, 41220801083,
41221304831, 41221810659) passed `clock` 4/5, 0/5, 3/5, 4/5 and 0/5 and reproduced `assets` on the same single pixel. The `clock` failure is
attributed to the paused `<video>` presenting a picture that `currentTime` does not fix — the media
frame accuracy the spike excludes — rather than to the clock, the seek order or the readiness chain:
every failing comparison whose log carries the pixel diagnostic is DOM-identical and differs only
inside the video rectangle, and the earlier ones are attributed to the same class by analogy. The
decision below is unchanged.

The production browser contract is already exercised on Linux: `check.yaml` runs the
`composition-dom`, `loading` and `frame-transport` projects there, with the AppArmor user-namespace
profile for Playwright's Chromium. A spike job would add a third-party regression surface, not the
first Linux browser coverage.

## Decision

**Keep the spikes out of `pnpm test` and `check.yaml`, and qualify them on Linux on demand.**

- `.github/workflows/spikes-linux.yaml` is the qualification harness: `workflow_dispatch` runs every
  suite for the requested repetitions and records the runner image, toolchain and Chromium build, the
  pass counts, the per-run wall time, the renderer backend and every log.
- A pull request that touches `spikes/**` or that workflow runs it too. `clock` and `assets` are
  marked `known-linux-failure`: they still run, fail their step and annotate, and
  `continue-on-error` keeps the run green — the job still concludes `failure`, so the check list
  shows it red — while one warning, `Known Linux failure`, names the diagnosis and the rest report
  the failing step, the per-repetition exit codes and the run total. A new failure in a suite that
  passes on Linux still fails the run.
- Byte-exact DOM plus PNG equality stays the comparison rule of every spike. A Linux run reports the
  mismatch; it gets no tolerance.
- The two Linux failures stay open: neither is a readiness or determinism difference, and closing them
  means deciding what the fixture should compare, not loosening the comparison.
  _Amended 2026-10-31 (TASK-177):_ the failing `clock` comparisons whose log carries the diagnostic
  differ only inside the paused video's rectangle, so the choice is to mask the video out of the PNG
  comparison, to compare against a reference taken with the same seek history, or to accept the limit;
  `assets` needs the same kind of choice for its one pixel. Until one is taken, both keep byte-exact
  equality and stay `known-linux-failure`.
- Adopting a spike's technique into shipped code obliges the adopter to test the adopted contract on
  Linux. The spike is a record of an experiment, not that test.

## Consequences

- No spike regression is caught on push. Results can change silently when Chromium, Playwright,
  Vitest, React or three move, so a spike or toolchain change that matters needs a dispatched run.
- A pull request that edits a spike gets Linux evidence without a blocking gate, and the two known
  failures cannot make that gate red forever.
- `check.yaml` keeps its ~15 minute budget and its shipped-code focus; the qualification workflow
  carries the chrome download, the SwiftShader measurements and the artifacts.
- The workflow reuses `check.yaml`'s `actions/checkout` pin, so both copies must be bumped together,
  and pins `actions/upload-artifact`, which no other workflow uses. It reuses the local
  `./.github/actions/setup-node` composite rather than pinning `actions/setup-node` again, so it must
  not bypass that action.
- TASK-177's remaining work is a decision on the `assets` pixel and, for `clock`, a decision once a
  run reports the differing pixels of the readiness-gate recovery capture; not a CI change.
  _Amended 2026-10-31 (TASK-177):_ the four diagnostic runs (41219905051, 41220801083, 41221304831,
  41221810659) happened and named the failing comparisons and their rectangles — the paused video's
  frame for `clock`, one pixel for `assets`. The earlier failures are attributed to the same class by
  analogy. What remains is the decision for both, not a CI change.

## Alternatives

- **One combined browser job in `check.yaml`:** rejected. No spike is shipped code, the five commands
  take about two minutes on macOS, and on Linux two of them fail, so every pull request would pay
  for historical experiments and inherit an ungreen gate.
- **Adding only the passing suites to `check.yaml`:** rejected. `motion` alone is ~29 s, at the
  task's own 30 s ceiling for a CI addition, and nothing shipped depends on it passing.
- **Dispatch-only workflow, no pull request trigger:** rejected. A pull request that edits a spike
  would then get no Linux signal at all, including for the three suites that do hold on Linux.
- **Loosening the comparison on Linux:** rejected. The spikes exist to show exact frame equality; a
  tolerance would hide the difference under investigation, and nothing yet shows the `assets` delta
  is only capture noise.
