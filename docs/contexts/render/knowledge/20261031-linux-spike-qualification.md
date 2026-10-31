# Linux qualification of the four spike suites

The spike suites now have Linux measurements. On `ubuntu-latest`, five repetitions each:
`motion` 5/5, `three` 5/5, `three-flags` 5/5, `assets` 0/5 and `clock` 1/5. The three passing suites
reproduce their macOS results, including exact DOM and PNG equality, on ANGLE's SwiftShader (Subzero)
Vulkan backend. The two failures are a single screenshot pixel in the `assets` font fixture and an
unattributed comparison mismatch in `clock`; neither shows a missing readiness barrier. The suites
stay out of `check.yaml` ([ADR](../../../decisions/20261031-spike-suites-stay-out-of-ci.accepted.md));
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

The reproduction is `.github/workflows/spikes-linux.yaml`; `gh workflow run spikes-linux.yaml --ref
<branch> -f repetitions=5` dispatches it and `spikes-linux-<suite>` artifacts keep
`environment.txt`, `measurements.jsonl` and every repetition log.

## Results against macOS arm64

Wall time is around the whole `pnpm spike:*` process; Vitest duration is the reporter's number. Five
runs per command.

| Suite               | Linux result                            | Linux wall    | Linux Vitest            | macOS baseline  |
| ------------------- | --------------------------------------- | ------------- | ----------------------- | --------------- |
| `spike:motion`      | **5/5**, 10 tests, 218 captures each    | 29.48–30.06 s | 29.02–29.55 s           | 29.38 / 29.42 s |
| `spike:three`       | **5/5**, 8 tests, 81 PNG captures       | 11.84–12.97 s | 11.16–12.24 s           | 9.81 / 11.29 s  |
| `spike:three:flags` | **5/5**, exit 0 each, 8 child processes | 43.86–46.21 s | first child 5.63–6.18 s | 32.42 s         |
| `spike:clock`       | **1/5**                                 | 5.80–49.13 s  | 5.03–48.76 s            | 38.83 / 39.10 s |
| `spike:assets`      | **0/5**, 10 of 11 tests pass            | 7.48–8.50 s   | 7.13–7.82 s             | 9.70 / 10.07 s  |

- `motion` is indistinguishable from macOS. `three` is 8–26% slower than the two macOS software
  runs (mean 11.70 s against 10.78 and 9.30 s), `three-flags` about 37% slower (43.86–46.21 s
  against 32.42 s), and `clock` 25% slower when it passes (49.13 s against 38.83–39.10 s).
  `assets` is not comparable: the failing test aborts before its fresh-fixture and Suspense phases.
- `three` reproduced every macOS comparison on Linux: 14/14 seeded random, 10/10 fresh roots, 1/1
  held frames, four `finish`/`readback`/`rAF`/`none` barriers 7/7 each, zero readback byte
  mismatches, and all four history-dependent negative controls mismatching in DOM and PNG. The
  non-preserved-buffer probe also behaved as on macOS: both screenshots matched the reference and the
  delayed readback mismatched all 307,200 bytes.
- `motion` passed all ten features and the four uncontrolled counterexamples (`presence`, `layout`,
  `use-spring`, `autonomous`) mismatched as intended.

## Renderer backend and the R3F flag matrix

Every WebGL context on the runner is software. Both the LLVM and the Subzero SwiftShader device names
appear in the reports because the same pinned Chromium ships different SwiftShader builds per
platform; cross-OS pixel identity was never claimed, and none of these comparisons crosses machines.

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

The matrix command exited 0 in all five repetitions: the canonical software run passed as SwiftShader
and `disabled-webgl` rejected WebGL. `angle-only` is the only profile whose meaning changes across
platforms — it selected Metal on the Mac and selects software rendering here.

## SwiftShader deprecation warning

The macOS record ([swiftshader warning](../../agent/knowledge/20261029-swiftshader-warning.md)) shows
`Automatic fallback to software WebGL has been deprecated…` when Playwright's
`--enable-unsafe-swiftshader` is absent. On Linux it appeared **zero times in all 25 runs**, including
`swiftshader-no-opt-in`, which removes the switch from both the spike's arguments and Playwright's
defaults, and still measured SwiftShader and rendered correctly. The logs carry the page console —
the channel on which macOS recorded the warning — but not Chromium's process stderr, so the absence
is a console observation, not a claim about every stderr line the browser emits. The warning is
therefore a property of the platform's Chromium build, not of software rendering as such; it cannot
be used to detect whether the opt-in flag is present on Linux. This does not change the launch
policy: motion-kit still passes the flag for trusted fixtures, and removing it is not supported by
this observation.

## `assets`: one screenshot pixel in the font fixture

The font case fails at the first reordered comparison (`frame 2`, the first entry of `[2,0,1,2]`,
inside the same fixture page that produced the baseline) with identical serialized DOM and a PNG that
differs in **exactly one pixel**:

|                        | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| Position               | `(11, 46)` — blank white space, left of the text box                           |
| Baseline               | `rgb(255,255,255)`                                                             |
| Re-capture             | `rgb(255,255,247)` (blue channel 8 lower)                                      |
| Changed pixels / bytes | 1 pixel; 1 of 230,400 RGBA bytes                                               |
| Content                | unchanged: same 2,541 non-white pixels, same content box `x 23–223`, `y 13–47` |
| Reproducibility        | same position and value in all five repetitions                                |

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

## `clock`: an unattributed comparison mismatch

Four of five repetitions failed with `Own clock failed order/hold equality`, thrown inside the browser
command, and the whole comparison report was lost with it; the one passing repetition matched every
comparison (12/12 order, 8/8 fresh pages, 1/1 held frame) and produced the full measurement JSON.
Total wall time separates the runs: failures aborted at 5.80, 21.62, 22.01 and 35.19 s against 49.13 s
for the pass, so the failing comparisons sit at different depths.

The cause is **not established**. Two candidates survive the evidence: PNG-only mismatch on a
composited video frame (the fixture contains a paused `<video>`, and media frame accuracy was already
declared out of scope for this spike), or the same class of screenshot difference as `assets`.
`spikes/c-clock/experiment.ts` now reports the phase (`order`, `fresh`, `hold`), the target time and
the DOM/PNG verdict of every mismatching comparison — commit `e297a57`, which changes no assertion —
so the next dispatched run attributes it. Until then the suite is marked `known-linux-failure` in the
workflow rather than described as flaky-but-fine.

The instability is not Linux-specific. On the author's macOS arm64 host, one of eight
`pnpm spike:clock` runs made during this qualification failed a test-level assertion after 32.4 s;
the other seven passed. That message predates `e297a57` and was not kept, so it is unattributed for
the same reason. Treat `clock` as an unstable experiment on both platforms until a run with the new
diagnostic names the mismatch.

## Residuals

- One Linux image (`ubuntu26`, 20261026.180.1), one Chromium build and one SwiftShader backend. A
  different runner image, a hardware GPU, or an ARM runner is unmeasured.
- Both failures remain open. `assets` needs a decision about screenshot reproducibility for the font
  fixture (tolerance with a documented bound, or a capture path whose bytes are stable); `clock` needs
  the diagnostic re-run and then a decision.
- The flag matrix is diagnostic, not a portable pass/fail expectation: `desktop-gl` and `angle-only`
  prove nothing about hardware rendering on a runner without a GPU.
- Nothing here qualifies a shipped path. The production browser contract keeps its own Linux coverage
  in `check.yaml` (`composition-dom`, `loading`, `frame-transport`), and each spike's macOS residuals
  still stand.
