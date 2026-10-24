# Spring verification

Confirmed on 2026-10-24 for TASK-155 with Node 26 and the repository's pinned pnpm/Vitest toolchain. The [Spring decision](../adr/20261024-closed-form-spring.accepted.md) defines the numerical and sustained-settle contracts.

## Analytic references

The tests use independently reduced ODE solutions, not the implementation's basis coefficients:

| Regime       | Parameters (`mass=1`, `from=1`, `to=0`, `start=0`) | Independent solution and checked constants                                                          |
| ------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Under-damped | `stiffness=2`, `damping=2`, `velocity=-1`          | `x=exp(-t)cos(t)`; `x(pi/2)=0`, `v(pi/2)=-0.20787957635076193`, `x(pi)=-0.04321391826377226`        |
| Critical     | `stiffness=1`, `damping=2`, `velocity=0`           | `x=(1+t)exp(-t)`; `x(1)=0.7357588823428847`, `x(2)=0.4060058497098381`, `v(1)=-0.36787944117144233` |
| Over-damped  | `stiffness=3`, `damping=4`, `velocity=0`           | Roots `-1,-3`; `x=(3exp(-t)-exp(-3t))/2`; `x(1)=0.5269256275732315`, `v(1)=-0.4771385592053676`     |

Near-critical fixtures use `stiffness=1±1e-8`, `damping=2`, and `x(1)=2/e ∓ 2e-8/(3e) + O(1e-16)`. Stiff fixtures include damping and stiffness of `1e200`, and a delayed excursion with velocity `1e308` and damping `1e200`.

## Scaled-state regression

The review found that evaluating `exp(-a*t)` before multiplying by time and initial conditions returned successful zeros for representable states. At `t=7.5e202`, `from=to=start=0`, `velocity=1e200`, `stiffness=1e-200`, `damping=2`, `mass=1e200`, the original result was `{ position: 0, velocity: 0 }`. The corrected result is `{ position: 1.4262637226062684e77, velocity: -1.4243620376428428e-123 }`.

The basis now retains its decay exponent separately from its dimensionless cosine/sine factors and time/frequency scale. When the decay exponent or the scaled sine coefficient's exponent is below -500, each signed position and velocity contribution is evaluated as `sign * exp(exponent + sum(log(abs(factor))))`, including the initial conditions before calling `exp`. The threshold is well before subnormal decay loses relative precision; ordinary inputs retain direct arithmetic. The over-damped path retains the cancellation-free slow-root velocity identity and independently scales the fast-mode velocity terms when their exponent is below -500. This matters even when the slow mode has barely decayed. The signed near-critical `q*t` series and sustained-settle algorithm are unchanged. There is no state, cache or integration.

Independent 80-digit Ruby `BigMath` evaluation supplies the new fixture constants. With `r=1e-200`, `u=r*t=750`, `v0=1e200`, initial displacement zero and mass `1e200`:

| Regime   | Stiffness, damping | Independent solution                                          | Position, velocity                                  |
| -------- | ------------------ | ------------------------------------------------------------- | --------------------------------------------------- |
| Critical | `1e-200`, `2`      | `x=v0*t*exp(-u)`, `v=v0*(1-u)*exp(-u)`                        | `1.4262637226062548e77`, `-1.4243620376427798e-123` |
| Under    | `2e-200`, `2`      | `x=v0/r*exp(-u)*sin(u)`, `v=v0*exp(-u)*(cos(u)-sin(u))`       | `1.4168940262623077e74`, `-2.6852855346890724e-126` |
| Over     | `3e-200`, `4`      | `x=v0/(2r)*(exp(-u)-exp(-3u))`, `v=v0/2*(-exp(-u)+3exp(-3u))` | `9.508424817375032e73`, `-9.508424817375032e-127`   |

Reproduce the reference with `ruby -rbigdecimal -rbigdecimal/math`, decimal-string `BigDecimal` inputs and `BigMath.exp`, `BigMath.sin`, `BigMath.cos` with precision 80. These are independent ODE reductions, not values copied from the TypeScript implementation. The small difference from the review's rounded estimates is below the regression tolerance.

The 600-case property varies regime, dimensionless time (750–800), rate (1–1e-200), signed initial velocity (1e100–1e200) and a common physical-parameter multiplier. Its reference splits the decay into two representable `exp(-u/2)` factors, using the reduced solutions above rather than log-domain products. It asserts finite/nonzero reference values, nonzero results and relative error below `1e-9` for both state components. A large-displacement fixture (`from=1e308`, unit critical parameters, `t=750`) also retains its nonzero position and velocity. Two further over-damped fixtures cover fast-mode decay underflow with a still-significant velocity (`v0=1e308,c=1e200,k=m=1,t=7.5e-198`, velocity approximately `1.9016849634750064e-18`) and sine-basis division underflow despite a normal decay (`v0=k=c=1e308,m=1,t=100`, position `exp(-100)`, velocity `-exp(-100)`).

## Half-scaled cancellation regression (round 3)

When `from-to` overflows, retain `from/2-to/2`, `velocity/2`, and `to/2` through all signed products and sums; multiply the final position and velocity by two only after cancellation. Adding `LN2` to each product exponent restored the full displacement too soon. The scaled real-root velocity also combines `slow*y*(exp(-2*q*t)-1)` using the basis's `expm1`, instead of subtracting independently log-rounded products. Direct ordinary-magnitude arithmetic is unchanged.

For `start=0,k=c=1e308,m=1,t=1e-310`, all six rows below returned `motion.non-finite-result` from both `springState` and `spring` at `955cde6`. `spring` now equals the position component of the successful state. Independent roots round to `-1,-1e308`; the position change is below its ULP, and the reduced velocity is `from*(2*expm1(-0.01)) + velocity*exp(-0.01)` without ever forming `2*from`.

| From, to       | Initial velocity | Position after            | Velocity after           | Independent velocity      |
| -------------- | ---------------- | ------------------------- | ------------------------ | ------------------------- |
| `1e308,-1e308` | `0`              | `1.0000000000000272e308`  | `-1.990033250166452e306` | `-1.9900332501663895e306` |
| `1e308,-1e308` | `1e308`          | `1.0000000000000272e308`  | `9.701495012474678e307`  | `9.701495012475043e307`   |
| `1e308,-1e308` | `-1e308`         | `1.0000000000000272e308`  | `-1.009950166250797e308` | `-1.009950166250832e308`  |
| `-1e308,1e308` | `0`              | `-1.0000000000000272e308` | `1.990033250166452e306`  | `1.9900332501663895e306`  |
| `-1e308,1e308` | `-1e308`         | `-1.0000000000000272e308` | `-9.701495012474678e307` | `-9.701495012475043e307`  |
| `-1e308,1e308` | `1e308`          | `-1.0000000000000272e308` | `1.009950166250797e308`  | `1.009950166250832e308`   |

`combines half-scaled endpoints and velocity before restoring their magnitude` requires both outputs within `1e-12` relative error against those references. `combines nearly equal scaled velocity modes with expm1` uses `t=2.001e-311`, just above the series boundary; reverting the grouping produces relative error `2.481581606872396e-11`, exceeding its `2e-13` tolerance.

The [joint numeric domain](../CONTEXT.md#spring-numeric-domain) replaces an impossible uniform relative-error promise with a mixed error bound. Boundary tests exercise `1e308`, common physical scales `2**-1022` and `1e308`, and `omega*t=2**20`, each multiplied by `1-EPSILON`, `1`, and `1+EPSILON`; both sides of `q*t=0.001`; coalescing roots; finite versus overflowing model rates; and position-only success when velocity overflows. Outside-domain samples are deliberately best-effort, not clamped or rejected merely for crossing a precision boundary.

### Spread comparison against `8d53ca4`

The previous scratch grid was not retained, so this round records its reproducible 26,880-state author-side spread explicitly: stiffness `[0.01,0.1,1,2,3,10,100,1000]`, damping `[0.0001,0.01,0.1,1,2,4,10,1000]`, mass `[0.1,1,10]`, `(from,to,velocity)` in `[(1,0,0),(-100,100,30),(0,1,-10),(10,10,1),(0,0,100)]`, `start=0`, and `time=20*i/27` for integer `i=0..27`. Import `git show 8d53ca4:src/motion/spring.ts` with its diagnostic import redirected to the current source and compare both state components.

- All 26,880 states succeeded in both versions. No component of magnitude at least `1e-200` changed at all.
- Maximum relative difference among nonzero normal components: **`1.533763464979795e-13`**, using `abs(old-new)/max(abs(old),abs(new))`; below the previously reported `2.9e-13`.
- Maximum difference with denominator `max(1,abs(old),abs(new))`: **`8.968426898586096e-236`**.
- 49 components changed, all tiny decayed tails. Including subnormals, the raw relative ratio reaches `1.6923076923076923`; this is not an ordinary-regime relative-accuracy claim. The normal-number floor and absolute term in the contract are intentional.

## Properties and determinism

`src/motion/spring.test.ts` checks exact initial position, position and velocity continuity at Retarget, original-description immutability, shuffled call order, interleaved translated descriptions, absolute-tolerance monotonicity, and sustained settling. The settle property checks 501 later samples per case, including times well beyond the boundary, plus a point just before the last entry. A dedicated oscillatory fixture checks 10,001 later samples and proves its earlier target crossing is not the settle time. Monotone critical/over-damped fixtures also check several strictly shorter durations remain outside tolerance.

Retarget coverage now explicitly asserts inherited stiffness, damping and mass without overrides, plus individual overrides. For `k=6,c=8,m=2`, the roots are -1 and -3; the no-override trajectory is checked against independent exponential coefficients at 0.5, 2 and 10 seconds after switching. A 300-case property compares both position and velocity against the original trajectory at arbitrary later times and 2, 10 and 30 seconds after a same-target switch. It scopes identity to active switches (`atTime > start`), not the distinct pre-start hold/restart semantics, and freezes the original description.

Repeated samples compare the eight binary64 bytes, not rounded decimal strings. `scripts/spring-determinism.test.ts` compares position/velocity bytes from separate Node processes, including reversed evaluation order, all three regimes, near-critical inputs and stiff damping. This verifies same-runtime determinism, not cross-engine identity.

## Mutation matrix

All fifteen distinct mutations were re-run individually in round 3 and restored after each run. Eight are the original matrix; the reviewer's four are explicitly marked below (velocity reset and series snapping overlap the original matrix). Three round-2 mutations cover premature decay, fast-mode velocity and sine-basis scale underflow; two round-3 mutations cover premature rescaling and subtraction of log-rounded velocity modes. All were killed by assertions, not timeout, compilation or setup; no survivor remains.

The named tests ran with `pnpm vitest run src/motion/spring.test.ts --project unit -t '<name>'`. The previously surviving default-stiffness mutation additionally ran the complete `pnpm test` suite: 2 assertion failures, 343 passes (345 total). Restored full-suite results are recorded in the PR body.

| Mutant                                                                                          | Killing test                                                                                                                  | Observed failure                                                                                             |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Route under-damped basis through the over-damped branch (`regime === -1` → `=== 1`)             | `matches independently derived under-damped quarter-cycle constants`                                                          | `x(pi/2)=0.10843143368594568`, expected zero                                                                 |
| Use `exp(-a*t)` instead of the slow-root exponential in the over-damped branch                  | `matches independently derived over-damped constants`                                                                         | `0.19384510541055194`, expected `0.5269256275732315`                                                         |
| Remove the elapsed-time factor from critical/series `S`                                         | `matches independently derived critical constants`                                                                            | `x(2)=0.2706705664732254`, expected `0.4060058497098381`                                                     |
| Reset Retarget velocity to zero (reviewer)                                                      | `retargets continuously in both position and velocity without mutating the old spring`                                        | Shrunk case expected velocity `-0.9999000000001667`, received zero                                           |
| Divide the settle root by two                                                                   | `has a tight last-entry boundary for monotone critical and over-damped motion`                                                | Deviation `0.42113628585326535` exceeded tolerance `0.1`                                                     |
| Snap the near-critical signed series term to zero (reviewer)                                    | `preserves near-critical signed corrections rather than snapping damping`                                                     | Error `2.4525296238309124e-9` exceeded `5e-15`                                                               |
| Reintroduce a module-level history cache keyed only by time                                     | `is byte-identical under shuffled evaluation and interleaved different inputs`                                                | Cached zero returned for translated equilibrium whose position is one                                        |
| Force stiff velocity back to `C-aS`                                                             | `preserves stiff analytic velocity without cancellation or coefficient underflow`                                             | Normalized velocity is zero instead of `0.36787944117144233`                                                 |
| Forward Euler with step at most `1e-4` for ordinary inputs (reviewer)                           | All three independent regime fixtures, plus `inherits all physical parameters and follows the analytic retargeted trajectory` | Under quarter-cycle error `3.2656e-5`; new later-retarget analytic error `2.6071e-5`                         |
| Insert `stiffness: 1` between `...s` and `...options` in Retarget (reviewer; previous survivor) | Both new inherited-parameter and future same-target tests                                                                     | Expected inherited stiffness 6, received 1; complete suite: 2 failed, 343 passed                             |
| Remove scaled-state dispatch, restoring premature exponential underflow                         | Both new scaled-state fixture and split-decay reference property                                                              | Normalized position zero instead of one; property shrinks to under-damped `u=750`, rate 1, velocity `-1e100` |
| Restore early fast-exponential underflow in over-damped velocity                                | New scaled-state fixture                                                                                                      | Normalized velocity approximately `-5.26e-75` instead of one                                                 |
| Ignore sine-basis scale when dispatching to scaled evaluation                                   | New scaled-state fixture                                                                                                      | Normalized position zero instead of one                                                                      |
| Restore full magnitude in each half-scaled product before cancellation                          | `combines half-scaled endpoints and velocity before restoring their magnitude`                                                | Expected successful state, received Diagnostic (`false` instead of `true`)                                   |
| Subtract independently rounded slow/fast velocity products instead of `expm1` grouping          | `combines nearly equal scaled velocity modes with expm1`                                                                      | Relative error `2.481581606872396e-11` exceeded `2e-13`                                                      |

Euler uses the reviewer's bounded domain (`t<=20`, `stiffness,damping<=100`, `mass>=1`), retaining closed-form fallback elsewhere. The failures are analytic mismatches, not the reviewer's earlier dense-property timeout. The stiffness mutant is now killed rather than merely documented as surviving.

## Residuals

- Binary64 quantization limits tolerances at very large targets. Cross-engine transcendental last-bit identity is not guaranteed.
- Outside the documented joint domain, sampling is best-effort. Non-representable rates, solver intermediates, durations or an under-damped last-peak index outside the safe-integer range return Diagnostics; they do not prove mathematical output overflow. This is not an arbitrary cycle scan cap.
- `/motion` packaging remains the existing package-layout deferral: export-map entry, build wiring and consumer smoke test.
- Lean validates existing core specs; no claim is made that the floating-point oscillator is formally proved.
