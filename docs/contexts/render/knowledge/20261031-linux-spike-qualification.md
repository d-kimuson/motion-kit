# Linux qualification of the spike suites and the R3F flag matrix

The spike suites now have Linux measurements from six runs of
`.github/workflows/spikes-linux.yaml` on `ubuntu-latest`, five repetitions per suite each:
[41204901232](https://github.com/d-kimuson/motion-kit/actions/runs/41204901232),
[41207262712](https://github.com/d-kimuson/motion-kit/actions/runs/41207262712),
[41219905051](https://github.com/d-kimuson/motion-kit/actions/runs/41219905051),
[41220801083](https://github.com/d-kimuson/motion-kit/actions/runs/41220801083),
[41221304831](https://github.com/d-kimuson/motion-kit/actions/runs/41221304831) and
[41221810659](https://github.com/d-kimuson/motion-kit/actions/runs/41221810659) (all `pull_request`
events on PR #65). `motion` passed 5/5 in all six, `three` 5/5, `three-flags` 5/5, `assets` 0/5 and
`clock` 1/5, 4/5, 0/5, 3/5, 4/5, 0/5. The three passing suites reproduce their macOS results, including exact
DOM and PNG equality, on ANGLE's SwiftShader (Subzero) Vulkan backend. Neither open failure is a
missing readiness barrier: `assets` is a single screenshot pixel in the font fixture, unchanged across
all six runs, and `clock` is the paused `<video>` presenting a picture that its `currentTime` does not
fix — the one comparison the clock spike excludes from its own scope. The suites stay out of
`check.yaml` ([ADR](../../../decisions/20261031-spike-suites-stay-out-of-ci.accepted.md));
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

All six runs report this image, toolchain and Chromium build: their thirty `environment.txt` files are
identical. The reproduction is
`.github/workflows/spikes-linux.yaml`; a pull request that touches `spikes/**` or that workflow runs
it, and `gh workflow run spikes-linux.yaml --ref <branch> -f repetitions=5` dispatches it by hand.
The `spikes-linux-<suite>` artifacts of each run keep `environment.txt`, `measurements.jsonl` and
every repetition log.

## Results against macOS arm64

Wall time is around the whole `pnpm spike:*` process. Five repetitions per command per run; Vitest's
own duration stays within 1 s of it except for `three-flags`, which forks a child process per profile.

| Suite               | Linux result across the six runs         | Linux wall    | macOS baseline  |
| ------------------- | ---------------------------------------- | ------------- | --------------- |
| `spike:motion`      | **5/5** every run                        | 29.06–30.91 s | 29.38 / 29.42 s |
| `spike:three`       | **5/5** every run                        | 11.42–13.01 s | 9.81 / 11.29 s  |
| `spike:three:flags` | **5/5** every run                        | 32.21–46.21 s | 32.42 s         |
| `spike:clock`       | **1/5**, 4/5, **0/5**, 3/5, 4/5, **0/5** | 3.82–52.67 s  | 38.83 / 39.10 s |
| `spike:assets`      | **0/5** every run                        | 7.48–9.57 s   | 9.70 / 10.07 s  |

- `motion` is indistinguishable from macOS, and `three` is 5–28% slower than the two macOS software
  runs (wall means 11.85, 12.16, 12.23, 12.30, 12.39 and 12.51 s against 11.29 and 9.81 s). The other
  two suites move more between runs than between platforms: `three-flags` took 43.12–46.21 s in the
  first three runs, 32.21–33.95 s in 41220801083, 37.01–37.99 s in 41221304831 and 37.43–39.74 s in
  41221810659 (macOS 32.42 s), and a passing `clock` ranged 36.12–52.67 s against 38.83–39.10 s on
  macOS. Wall time is therefore a runner-load observation, not a platform measurement, and only the
  pass counts carry the qualification. `assets` is not comparable at all: the failing test aborts
  before its fresh-fixture and Suspense phases.
- `three` reproduced every macOS comparison on Linux in all six runs: 14/14 seeded random, 10/10
  fresh roots, 1/1 held frames, four `finish`/`readback`/`rAF`/`none` barriers 7/7 each, zero readback
  byte mismatches, and all four history-dependent negative controls mismatching in DOM and PNG. The
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

The matrix command exited 0 in all five repetitions of all six runs: the canonical software run passed
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
differs in **exactly one pixel**. All six runs reproduced it at the same test, position and
value in all five repetitions each, decoded from the logged `Expected`/`Received` base64:

|                        | Value                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Position               | `(11, 46)` — blank white space, left of the text box                                                                      |
| Baseline               | `rgb(255,255,255)`                                                                                                        |
| Re-capture             | `rgb(255,255,247)` (blue channel 8 lower)                                                                                 |
| Changed pixels / bytes | 1 pixel; 1 of 172,800 channel values (the 320×180 crop is encoded as 8-bit RGB, not RGBA)                                 |
| Non-white content      | baseline 2,541 pixels in box `x 23–223`, `y 13–47`; re-capture 2,542 in `x 11–223` — the one extra is the differing pixel |
| Reproducibility        | same position and value in all five repetitions of all six runs                                                           |

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

## `clock`: the paused video's presented frame

Thirty repetitions over the six runs: `clock` passed 1/5, 4/5, 0/5, 3/5, 4/5, then 0/5. A failure
aborts the comparison, so only the thrown message reaches the log. Two messages carry the verdict:
`e297a57` names the failing comparison and its DOM/PNG verdict, and the pixel diagnostic added with this
record names the coordinate of the difference. Neither changes an assertion.

| Run         | Failed | Failing comparisons                                              | Verdict in the log                                  |
| ----------- | ------ | ---------------------------------------------------------------- | --------------------------------------------------- |
| 41204901232 | 4 of 5 | 1 × readiness-gate recovery (500 ms), 3 × own-clock order/hold   | none — predates `e297a57`'s verdict fields          |
| 41207262712 | 1 of 5 | 1 × readiness-gate recovery (500 ms)                             | `{"dom":true,"png":false}`                          |
| 41219905051 | 5 of 5 | 4 × own-clock `fresh` (250 ms ×3, 500 ms), 1 × recovery (500 ms) | DOM equal, pixels differ inside the video rectangle |
| 41220801083 | 2 of 5 | 2 × own-clock `fresh` (500 ms, 1500 ms)                          | same, both inside the video rectangle               |
| 41221304831 | 1 of 5 | 1 × own-clock `fresh` (2000 ms)                                  | same, inside the video rectangle                    |
| 41221810659 | 5 of 5 | 5 × own-clock `fresh` (100 ms ×2, 250 ms, 750 ms, 1000 ms)       | same, every box inside the video rectangle          |

**Attribution: the paused `<video>` presented a different picture at the same `currentTime`.** That is
media frame presentation — which this spike's own scope excludes — and not clock nondeterminism. The
evidence is the thirteen failures of the four runs with the pixel diagnostic (41219905051, 41220801083,
41221304831 and 41221810659); items 1, 2, 5 and 6 cover all thirteen, and items 3 and 4 are measured on
the single recovery capture, the one comparison the diagnostic re-captures:

1. Every failure is DOM-equal and pixel-different, and every differing box lies inside the video
   rectangle (`160×90` at `y 150`): `x 0–159`, `y 150–229` (5,545 pixels) for a 100 ms reference,
   `x 0–159`, `y 150–231` (6,893 pixels) for 250 ms, `x 0–159`, `y 150–233` (8,976 pixels) for 500 ms,
   `x 0–159`, `y 150–237` (9,697 pixels) for 750 ms, `x 0–159`, `y 150–239` (9,961 pixels) for
   1000 ms, the same box with 9,484 pixels for 1500 ms and 9,235 pixels for 2000 ms. None of the DOM
   boxes above `y 150` differs.
2. The compared DOM already carries every clock-derived value (`outerHTML` with the rAF box styles, the
   React value, `rafClock`, both CSS `currentTime`s, the computed transforms, `video.currentTime`,
   `seeking`, the microtask and the timer stamps), so `dom: true` says the clock state, the seek order
   and the readiness chain reproduced exactly.
3. That recovery capture is not a stale composite: against its own pre-release capture it differs in
   the async box only (`x 0–69`, `y 120–139`, 800 pixels — the box the readiness barrier moves), so
   the released commit was painted, and what remains against the reference is entirely the video.
4. Nor is that capture paint lag: re-capturing after two native animation frames left the same 8,976
   video-rectangle pixels different.
5. The sample pixels are different test-pattern colours for the same frame — `(0,150) 128,0,254`
   against `(0,150) 245,2,0` — so these are different pictures, not a one-pixel raster deviation.
6. Every failure is at a comparison where the two pages reach the target by different seek histories:
   the baseline page walks `0, 100 … → target` and the fresh page seeks `0 → target`, and the one
   recovery failure has the same shape (`0 → 500` against `0 → 2000 → 500`). Which targets lose is not
   fixed: 41219905051 lost 250 and 500 ms, 41220801083 500 and 1500 ms, 41221304831 2000 ms, and
   41221810659 100, 250, 750 and 1000 ms, so the target alone does not decide it. Which of the
   neighbouring frames each page presents is not fixed by `currentTime`, and Chromium's choice inside
   the media pipeline was not measured here.

Run 41207262712's recovery failure has the same DOM/pixel verdict as the one the diagnostic located in
the video. Run 41204901232's four failures — three own-clock `order`/`hold` comparisons against a
baseline and one readiness-gate recovery — carry no verdict of their own and are attributed to this
class by analogy only. The twelve `fresh` failures have neither a pre-release capture nor a post-paint
re-capture, so they are attributed by their box, their sample colours and their seek history (items 1,
5 and 6), not by a re-capture.

### What this settles and what it leaves open

The spike's selected clock stands: every comparison whose DOM is equal shows a reproducible clock, and
the failing comparisons differ only in pixels the spike declares out of scope. What is left is a
decision, not a diagnosis:

- Mask the video rectangle out of the PNG comparison, keeping byte equality for the rest of the frame.
- Compare a capture against a reference taken the same way (a fresh page seeking `0 → target` against
  another fresh page doing the same), so the media presentation is not part of the comparison.
- Keep asserting the full frame against the walked baseline and record the failure as a known limit of
  the fixture.

No comparison was relaxed for this record, because choosing between those is the maintainer's call
([ADR](../../../decisions/20261031-spike-suites-stay-out-of-ci.accepted.md)).

### The same class on macOS

One macOS arm64 `pnpm spike:clock` run failed during run 41204901232's qualification with a message that
predated `e297a57`. With that message in place a local run named it `stage: "fresh"`, `time: 2000`,
`dom: true`, `png: false` — the same DOM-equal, pixel-different class, on a comparison that awaits
`seeked` and reaches 2000 ms from a fresh page against a walked baseline. The pixel diagnostic was not
in place for that run, so whether its difference was the video too is unmeasured; the class is
nevertheless not Linux-specific and not confined to the recovery capture. The clock itself reproduced
in every macOS run.

## Diagnostics

`spikes/c-clock/pixels.ts` decodes both captures of a mismatching comparison with the repository's own
decoder (`src/render/check/png.ts`; no dependency is added) and reports the differing pixel count, the
bounding box and three sample pixels. It is attached to every `order`/`fresh`/`hold` mismatch and to the
recovery capture, which additionally compares against the capture taken before the gate was released
(equal pixels there pin a stale frame) and re-captures after two native animation frames (a match there
says the paint converges; a mismatch says the difference is not paint timing). Neither observation
decides the run: a throw from the extra capture or from its own deadline is reported inside the message
instead of failing a comparison that passed. A passing run records the same fields with `diff: null`, so
a failure is readable as a delta against a known-good frame. The message also names the repetition it
aborted. The comparisons are unchanged: byte equality of DOM and PNG, no tolerance, no disabled
animation, no image threshold.

## Residuals

- Six runs, five repetitions per suite each, one Linux image (`ubuntu26`, 20261026.180.1), one
  Chromium build and one SwiftShader backend. A different runner image, a hardware GPU or an ARM
  runner is unmeasured. The `clock` failure rate went 4/5, 1/5, 5/5, 2/5, 1/5, 5/5 across six runs
  with no change to the comparison, so how often the presented video frame differs is load- or
  timing-dependent and another run would report differently again. This record covers the six runs
  above; the harness is on-demand, so later runs are not folded into it.
- Both failures are attributed and open. `assets` is one screenshot pixel in the font fixture and `clock`
  is the paused video's presented frame; each needs a decision (a documented tolerance or a stable
  capture path for `assets`; mask the video, compare against a reference taken with the same seek
  history, or accept the limit for `clock`). Neither comparison was relaxed here.
- Which mechanism inside Chromium's media pipeline picks the neighbouring frame, and whether the macOS
  occurrence is the same one, is unmeasured. A macOS failure with the pixel diagnostic in place would
  say.
- The flag matrix is diagnostic, not a portable pass/fail expectation: `desktop-gl` and `angle-only`
  prove nothing about hardware rendering on a runner without a GPU.
- Nothing here qualifies a shipped path. The production browser contract keeps its own Linux coverage
  in `check.yaml` (`composition-dom`, `loading`, `frame-transport`), and each spike's macOS residuals
  still stand.
