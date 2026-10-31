# Linux qualification of the spike suites and the R3F flag matrix

The spike suites now have Linux measurements from two runs of
`.github/workflows/spikes-linux.yaml` on `ubuntu-latest`, five repetitions per suite each:
[41204901232](https://github.com/kimuson/motion-kit/actions/runs/41204901232) and
[41207262712](https://github.com/kimuson/motion-kit/actions/runs/41207262712) (both `pull_request`
events on PR #65). `motion` passed 5/5 in both, `three` 5/5 in both, `three-flags` 5/5 in both,
`assets` 0/5 in both and `clock` 1/5 then 4/5. The three passing suites reproduce their macOS
results, including exact DOM and PNG equality, on ANGLE's SwiftShader (Subzero) Vulkan backend.
Neither open failure is a missing readiness barrier: `assets` is a single screenshot pixel in the font
fixture, unchanged between the two runs, and `clock` is the `skip-barrier` negative control's
readiness-gate recovery capture, whose DOM is identical and whose pixels are not. The suites stay out
of `check.yaml` ([ADR](../../../decisions/20261031-spike-suites-stay-out-of-ci.accepted.md));
`.github/workflows/spikes-linux.yaml` is the on-demand harness.

Previous records ([A](../../motion/knowledge/spike-a-seekability.md), [B](../../three/knowledge/spike-b-seekability.md),
[C](../../core/knowledge/spike-c-clock.md), [D](spike-d-assets.md)) were macOS arm64 only. Measured
2026-10-31 UTC.

## Environment

| Item            | Value                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------- |
| Runner          | `ubuntu-latest`: image `ubuntu26`, `ImageVersion` `20261026.180.1`                                            |
| OS              | Linux 7.0.0-1017-azure x86_64                                                                                 |
| Node / pnpm     | 26.12.0 / 12.15.0 (`.node-version`, `packageManager`)                                                         |
| Playwright      | 1.64.1; Chrome for Testing **156.0.8078.4** (`playwright chromium v1248`)                                     |
| WebGL backend   | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`                |
| Browser install | `playwright install --with-deps chromium` plus the AppArmor userns profile from `check.yaml`; sandbox enabled |

Both runs report this image, toolchain and Chromium build, so the two dispatches differ only in what
the suites did. The reproduction is `.github/workflows/spikes-linux.yaml`; a pull request that touches
`spikes/**` or that workflow runs it, and `gh workflow run spikes-linux.yaml --ref <branch> -f
repetitions=5` dispatches it by hand. The `spikes-linux-<suite>` artifacts of each run keep
`environment.txt`, `measurements.jsonl` and every repetition log.

## Results against macOS arm64

Wall time is around the whole `pnpm spike:*` process. Five repetitions per command per run; Vitest's
own duration stays within 1 s of it except for `three-flags`, which forks a child process per profile.

| Suite               | Linux result, run 1 / run 2 | Linux wall, run 1 | Linux wall, run 2 | macOS baseline  |
| ------------------- | --------------------------- | ----------------- | ----------------- | --------------- |
| `spike:motion`      | **5/5**, 10 tests           | 29.48–30.06 s     | 29.77–30.91 s     | 29.38 / 29.42 s |
| `spike:three`       | **5/5**, 8 tests            | 11.84–12.97 s     | 11.98–12.70 s     | 9.81 / 11.29 s  |
| `spike:three:flags` | **5/5**, 8 child processes  | 43.86–46.21 s     | 43.12–45.33 s     | 32.42 s         |
| `spike:clock`       | **1/5** / **4/5**           | 5.80–49.13 s      | 34.73–52.67 s     | 38.83 / 39.10 s |
| `spike:assets`      | **0/5**, 10 of 11 tests     | 7.48–8.50 s       | 7.79–8.16 s       | 9.70 / 10.07 s  |

- `motion` is indistinguishable from macOS. `three` is 8–26% slower than the two macOS software
  runs (mean 11.70 s in run 1, 12.30 s in run 2, against 10.78 and 9.30 s), `three-flags` about 37%
  slower (43.12–46.21 s against 32.42 s), and a passing `clock` 25–35% slower (49.13 s in run 1,
  50.83–52.67 s in run 2, against 38.83–39.10 s). `assets` is not comparable: the failing test aborts
  before its fresh-fixture and Suspense phases.
- `three` reproduced every macOS comparison on Linux in both runs: 14/14 seeded random, 10/10 fresh
  roots, 1/1 held frames, four `finish`/`readback`/`rAF`/`none` barriers 7/7 each, zero readback byte
  mismatches, and all four history-dependent negative controls mismatching in DOM and PNG. The
  non-preserved-buffer probe also behaved as on macOS: both screenshots matched the reference and the
  delayed readback mismatched all 307,200 bytes.
- `motion` passed all ten features and the four uncontrolled counterexamples (`presence`, `layout`,
  `use-spring`, `autonomous`) mismatched as intended.

## Renderer backend and the R3F flag matrix

Every WebGL context on the runner is software. The unmasked device string differs per platform
(`SwiftShader Device (LLVM 10.0.0)` on macOS, `SwiftShader Device (Subzero)` on Linux); cross-OS pixel
identity was never claimed, and none of these comparisons crosses machines.

| Profile                         | Linux outcome                                      | macOS outcome              |
| ------------------------------- | -------------------------------------------------- | -------------------------- |
| `swiftshader` (suite default)   | SwiftShader (Subzero), 25/25 comparisons           | SwiftShader (LLVM), pass   |
| `default` (Playwright defaults) | SwiftShader (Subzero), pass                        | SwiftShader fallback, pass |
| `angle-only`                    | SwiftShader (Subzero), pass — no GPU on the runner | Apple M3 Pro / Metal, pass |
| `swiftshader-no-opt-in`         | SwiftShader (Subzero), pass, **no warning**        | SwiftShader, pass          |
| `disable-gpu`                   | SwiftShader fallback, pass                         | SwiftShader fallback, pass |
| `desktop-gl`                    | SwiftShader fallback, pass — not hardware evidence | SwiftShader fallback, pass |
| `disable-gpu-and-software`      | fail: `WebGL2 unavailable`                         | fail: expected             |
| `disabled-webgl`                | fail: `WebGL2 unavailable` (expected)              | fail: expected             |

The matrix command exited 0 in all five repetitions of both runs: the canonical software run passed
as SwiftShader and `disabled-webgl` rejected WebGL. `angle-only` is the only profile whose meaning
changes across platforms — it selected Metal on the Mac and selects software rendering here.

## SwiftShader deprecation warning

The macOS record ([swiftshader warning](../../agent/knowledge/20261029-swiftshader-warning.md)) shows
`Automatic fallback to software WebGL has been deprecated…` when Playwright's
`--enable-unsafe-swiftshader` is absent. On Linux it appeared **zero times in all 25 runs** of run 1,
including `swiftshader-no-opt-in`, which removes the switch from both the spike's arguments and
Playwright's defaults, and still measured SwiftShader and rendered correctly. The logs carry the page
console — the channel on which macOS recorded the warning — but not Chromium's process stderr, so the
absence is a console observation, not a claim about every stderr line the browser emits. The warning is
therefore a property of the platform's Chromium build, not of software rendering as such; it cannot be
used to detect whether the opt-in flag is present on Linux. This does not change the launch policy:
motion-kit still passes the flag for trusted fixtures, and removing it is not supported by this
observation.

## `assets`: one screenshot pixel in the font fixture

The font case fails at the first reordered comparison (`frame 2`, the first entry of `[2,0,1,2]`,
inside the same fixture page that produced the baseline) with identical serialized DOM and a PNG that
differs in **exactly one pixel**. Run 41207262712 reproduced it at the same test, position and value in
all five repetitions, decoded from the logged `Expected`/`Received` base64:

|                        | Value                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Position               | `(11, 46)` — blank white space, left of the text box                                                                      |
| Baseline               | `rgb(255,255,255)`                                                                                                        |
| Re-capture             | `rgb(255,255,247)` (blue channel 8 lower)                                                                                 |
| Changed pixels / bytes | 1 pixel; 1 of 172,800 channel values (the 320×180 crop is encoded as 8-bit RGB, not RGBA)                                 |
| Non-white content      | baseline 2,541 pixels in box `x 23–223`, `y 13–47`; re-capture 2,542 in `x 11–223` — the one extra is the differing pixel |
| Reproducibility        | same position and value in all five repetitions of both runs                                                              |

The other ten tests pass, including 4/4 named asset failures, 4/4 never-settling diagnostics and the
texture context-loss diagnostic, so the readiness behaviour the spike exists to prove is unaffected:
the font is applied in both captures, and the differing pixel is outside the glyphs.

Classification: a portability limit of the spike's rule, not a readiness difference. Two screenshots
of identical DOM are not byte-identical on this Linux/Chromium/SwiftShader stack for the font
fixture. The candidate causes are a residual of the font-swap repaint (the negative control paints a
monospace fallback before Abel) or screenshot raster/tile rounding; the artifacts cannot separate them.
No zero-tolerance comparison was relaxed, because a tolerance for this fixture would also hide a real
one-pixel readiness regression, and the delta's cause is not established. The other three fixtures and
the whole `three` suite keep byte-exact equality on Linux.

## `clock`: the readiness-gate recovery capture

Ten repetitions over the two runs, `clock` failed 4/5 in run 1 and 1/5 in run 2. A failure aborts the
comparison, so only the thrown message reaches the log; the message added in `e297a57` names the
failing comparison and its DOM/PNG verdict, and changes no assertion.

| Run         | Failed | Wall of the failing repetitions | Assertion                                             | Verdict in the log                             |
| ----------- | ------ | ------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| 41204901232 | 4 of 5 | 35.19, 22.01, 21.62, 5.80 s     | 1 × readiness-gate recovery, 3 × own-clock order/hold | none — the message predates the verdict fields |
| 41207262712 | 1 of 5 | 34.73 s                         | readiness-gate recovery                               | `{"dom":true,"png":false}`                     |

- The recovery failure is the same assertion in both runs, at the same place in the run (about 34 s; a
  repetition takes 16.6–16.8 s when it passes, so it is the end of repetition 2). The diagnostic now
  prefixes the repetition index, so the next failing run says which.
- Run 1's three other failures aborted earlier, inside the own-clock `order`/`fresh`/`hold`
  comparisons, with the pre-`e297a57` message that carried no further detail. All five own-clock
  comparisons passed in every repetition of run 2, so that class did not reproduce there.
- The failing comparison is fixed: mechanism `own` (the negative controls only run it), the
  `skip-barrier` control's recovery capture of the 500 ms reference frame. Its pre-release capture
  (`bad`) is required to differ from the reference in DOM and PNG, and did.

### What the verdict fixes and what it does not

The fixture serializes every clock-derived value into the compared DOM: `outerHTML` (which carries the
rAF box styles), the React value, `rafClock`, both CSS `currentTime`s, the computed transforms,
`video.currentTime`, `seeking`, the microtask stamp and the timer stamp. `{"dom":true,"png":false}`
therefore says the clock state, the seek order and the readiness chain reproduced exactly, and the
screenshot did not. **The selected clock is not the difference; the capture is.** Three capture-side
causes survive, and the coordinate of the difference separates them:

| Cause                                                                     | The difference sits in                | Why it is possible                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale composite: the screenshot precedes the paint of the released commit | the async box, `y 120–139`, `x 0–69`  | The recovery capture is the only one in the spike whose last paint-affecting DOM mutation is followed by no awaited browser event: `release()` resolves the gate in a microtask, and the next two steps are a CDP round trip and a screenshot |
| The paused video presents a decoded frame that differs from `currentTime` | the video box, `y 150–240`, `x 0–160` | Media frame accuracy is out of scope; `seeked` fires before the frame is composited, and the two pages reach 500 ms by different seek histories (`0 → 500` against `0 → 2000 → 500`)                                                          |
| A raster difference of the `assets` class                                 | anywhere, typically a few pixels      | Measured for the font fixture on this stack: two captures of identical DOM are not byte-identical there                                                                                                                                       |

The async-box rectangle is measured, not assumed: the pre-release capture and the reference differ in
800 pixels, 2,400 channel values, `x 0–69`, `y 120–139`, `(0,120) 48,96,192 → 255,255,255` — the box at
`translateX(0)` against `translateX(50px)`, the only paint the barrier controls. The video rectangle is
the fixture's `<video>`, `160×90` at `y 150`.

The cause is **not yet decided**: the log gives the verdict, not the coordinate. What the evidence
rules out is a clock, a seek-order or a readiness-chain difference.

### The same class on macOS

Run 1's record called the instability platform-independent because one macOS arm64 run had failed with a message that predated `e297a57`. With that message in place, a local `pnpm spike:clock` run named it: `stage: "fresh"`, `time: 2000`, `dom: true`, `png: false`. That comparison awaits `seeked` before the screenshot, and the fresh page
reaches 2000 ms directly while the baseline walks `0, 100 … 1500, 2000`. So the DOM-equal,
pixel-different class is neither Linux-specific nor confined to the recovery capture, and the video
presentation candidate applies to both platforms. The clock itself reproduced in every macOS run.

## Diagnostics added for the next run

`spikes/c-clock/pixels.ts` decodes both captures of a mismatching comparison with the repository's own
decoder (`src/render/check/png.ts`; no dependency is added) and reports the differing pixel count, the
bounding box and three sample pixels. It is attached to every `order`/`fresh`/`hold` mismatch and to the
recovery capture, which additionally compares against the capture taken before the gate was released
(equal pixels there pin a stale frame) and re-captures after two native animation frames (a match there
says the paint converges; a mismatch says the difference is not paint timing). A passing run records
the same fields with `diff: null`, so a later failure is readable as a delta against a known-good
frame. The comparisons are unchanged: byte equality of DOM and PNG, no tolerance, no disabled
animation, no image threshold.

## Residuals

- Two runs, five repetitions per suite each, one Linux image (`ubuntu26`, 20261026.180.1), one Chromium
  build and one SwiftShader backend. A different runner image, a hardware GPU or an ARM runner is
  unmeasured. The `clock` failure rate moved from 4/5 to 1/5 between the two runs without any change to
  the comparison, so it is load- or timing-dependent and a third run would report differently.
- Both failures remain open. `assets` needs a decision about screenshot reproducibility for the font
  fixture (tolerance with a documented bound, or a capture path whose bytes are stable); `clock` needs
  the pixel diagnostic's verdict from a failing run and then a decision. Neither comparison was relaxed.
- The flag matrix is diagnostic, not a portable pass/fail expectation: `desktop-gl` and `angle-only`
  prove nothing about hardware rendering on a runner without a GPU.
- Nothing here qualifies a shipped path. The production browser contract keeps its own Linux coverage
  in `check.yaml` (`composition-dom`, `loading`, `frame-transport`), and each spike's macOS residuals
  still stand.
