# Spike C: choose the browser clock

Use an explicit motion-kit clock with integration-specific seeking and readiness, not rAF scheduling or CDP virtual time as the master clock. Read the [comparison](../../docs/contexts/core/knowledge/spike-c-clock.md) and [accepted cross-context ADR](../../docs/decisions/20261023-explicit-browser-clock.accepted.md).

## Run

From the repository root, using `.node-version` and the pnpm version in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm spike:clock
# Optional inspection image of the chosen driver at 500 ms:
SPIKE_CLOCK_SCREENSHOT=/tmp/motion-kit-clock.png pnpm spike:clock
```

On Linux, install Chromium with `pnpm exec playwright install --with-deps chromium` (system libraries may require sudo). Use the pinned Playwright browser, not system Chrome. If `node_modules` is a managed-worktree symlink, unlink only that symlink before installing locally.

The command runs **three serial repetitions** of the unchanged comparison and emits one JSON report. Its `repetitions` array retains each repetition's environment, seeded frame order, every sequential state, exact DOM/PNG comparison outcomes, individual frame wall times, mean/population variance/standard deviation, async probes and negative controls. `costRanges` reports each mechanism's three `meansMs` and their `minMeanMs`/`maxMeanMs`: a range of repetition means, not individual frames or a confidence interval. Each repetition uses fresh fixture pages in the same browser context/process; candidate order remains fixed. Own clock and controlled rAF have overlapping cost bands; correctness, not a speed ranking between them, decides. Timing values and rejected mechanisms' failures are observations, not golden assertions. A chosen-driver mismatch, missing CSS/video synchronization, unsettled registered work, missing negative counterexample or deadline fails the command. No network service or FFmpeg is needed to run it.

This is **separate from `pnpm test`** (about 39 seconds locally for three repetitions): browser provisioning is not part of the default checks and the suite stays out of the CI gates ([ADR](../../docs/decisions/20261031-spike-suites-stay-out-of-ci.accepted.md)). On Linux it does not hold: 1, 4, 0, 3, 4 and 0 of 5 runs passed across six qualification runs, and every failure whose log carries a verdict was an identical DOM with different pixels — the paused `<video>` presenting a neighbouring frame at the same `currentTime` (media frame accuracy, [out of scope](#out-of-scope)); the first run's four failures predate that verdict and are attributed by analogy only. The pixel diagnostic in `pixels.ts` names the size and coordinate of each mismatching capture ([record](../../docs/contexts/render/knowledge/20261031-linux-spike-qualification.md)). Typecheck/lint include this directory; the package's unchanged `files` allowlist excludes it. No dependencies were added.

## Experiment layout

- `fixture.tsx` / `index.html`: identical React state, real CSS Animation and CSSTransition, two rAF consumers (callback timestamp and `performance.now()`), a registered asynchronous DOM update, and paused video. The 320×240 crop includes every integration.
- `experiment.ts`: Node-side Playwright driver exposed as one Vitest custom command. Each fixture has a fresh page, so clock changes never affect Vitest's runner. `seek(milliseconds)` supplies time, settles registered work, reads DOM and captures PNG. Deadlines and cost measurements use the **host's** unmodified clock.
- `vitest.config.ts` / `clock.browser.test.ts`: standalone Browser Mode entry. Vite serves the same fixture to all candidates. React dependencies are preoptimized to avoid a mid-test Vite reload.
- `sample.webm`: generated, silent three-second 160×90, 10 fps VP8 test pattern; no third-party asset. To regenerate (FFmpeg with libvpx required **only** for regeneration):

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'testsrc2=size=160x90:rate=10:duration=3' \
  -c:v libvpx -b:v 120k -an -y spikes/c-clock/sample.webm
```

Different FFmpeg versions can produce different encoded bytes; each run compares its own decoded images, not a stored PNG golden.

## Candidates and fairness

1. **Own clock:** injected millisecond snapshot; `performance.now()` and `Date.now()` read it; a manual rAF queue receives it. Real timers remain live for readiness. `new Date()`, workers and cached native clock references are deliberately not patched.
2. **Controlled rAF only:** the identical manual rAF queue, but no clock overrides. Callback timestamps are seekable; code that independently reads a browser clock is not.
3. **CDP virtual time:** native clocks/rAF, `Emulation.setVirtualTimePolicy` pause/advance budgets, and `Runtime.evaluate` with `awaitPromise:true`. Calibrate its JS epoch after pausing. Budget expiry is not a render acknowledgement. A tracked 5 ms timer and video decoding require further 10 ms budgets; pumping is bounded by attempts and a host deadline. Reverse/repeated targets behind the consumed budget are marked unsupported; the driver does **not** pretend they rewind or silently reload/replay.

First probe each clock **without** CSS/media adapters at 500 ms. Then give every candidate the **same** paused `Animation.currentTime` CSS/transition adapter and `video.currentTime` + `seeked` adapter. An explicit React state-injection probe succeeds for all three. The full comparison deliberately retains clock-reading React/rAF consumers as well as a timestamp-only rAF consumer: this asks whether the mechanism coordinates them, not whether pure timestamp-only code is possible. Controlled rAF is not claimed incapable of React or deterministic timestamp-only animation.

Compare ascending samples `[0,100,250,500,750,1000,1500,2000]` ms, seed-145 shuffled/repeated samples, eight fresh pages, and an 80 ms real-time hold. Fresh pages share one browser context/process and warmed module cache. PNG bytes and serialized markup/computed state must both agree; no animation disabling, image tolerance or screenshot golden. Cost includes seeking, readiness, DOM inspection and PNG capture, but excludes page setup/asset loading. No throughput threshold is asserted.

Four negative controls omit CSS seeking, omit video seeking, accumulate rAF clock values, or capture without awaiting an externally gated registered promise. All must differ in both DOM and PNG; releasing the gate must recover the good frame. Separate probes check microtasks, rejected readiness, never-ready host timeouts and a CDP timer that cannot resolve while virtual time is paused.

## Out of scope

This is not a shipped clock, a preview UI, a generic promise-draining algorithm or a production readiness API. It does not certify arbitrary React concurrent/Suspense work, Motion/R3F integration, unknown timers, CSS lifecycle reconstruction, media frame accuracy, audio, external assets/network, alternate playback speeds, long compositions, multiple realms, other browsers or cross-machine pixels. The clock shims are compatibility probes, not permission to patch a preview host's global clocks. See the report for the accepted strategy and its limits.
