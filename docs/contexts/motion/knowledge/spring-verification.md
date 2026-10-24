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

## Properties and determinism

`src/motion/spring.test.ts` checks exact initial position, position and velocity continuity at Retarget, original-description immutability, shuffled call order, interleaved translated descriptions, absolute-tolerance monotonicity, and sustained settling. The settle property checks 501 later samples per case, including times well beyond the boundary, plus a point just before the last entry. A dedicated oscillatory fixture checks 10,001 later samples and proves its earlier target crossing is not the settle time. Monotone critical/over-damped fixtures also check several strictly shorter durations remain outside tolerance.

Repeated samples compare the eight binary64 bytes, not rounded decimal strings. `scripts/spring-determinism.test.ts` compares position/velocity bytes from separate Node processes, including reversed evaluation order, all three regimes, near-critical inputs and stiff damping. This verifies same-runtime determinism, not cross-engine identity.

## Mutation matrix

Each mutation was applied alone to `src/motion/spring.ts`, the named test was executed with `pnpm vitest run src/motion/spring.test.ts --project unit -t '<name>'`, and the original implementation was restored. All eight runs failed on assertions, not compilation or setup. No survivor remains.

| Mutant                                                                              | Killing test                                                                           | Observed failure                                                      |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Route under-damped basis through the over-damped branch (`regime === -1` → `=== 1`) | `matches independently derived under-damped quarter-cycle constants`                   | `x(pi/2)=0.10843143368594568`, expected zero                          |
| Use `exp(-a*t)` instead of the slow-root exponential in the over-damped branch      | `matches independently derived over-damped constants`                                  | `0.19384510541055194`, expected `0.5269256275732315`                  |
| Remove the elapsed-time factor from critical/series `S`                             | `matches independently derived critical constants`                                     | `x(2)=0.2706705664732254`, expected `0.4060058497098381`              |
| Reset Retarget velocity to zero                                                     | `retargets continuously in both position and velocity without mutating the old spring` | Shrunk case expected velocity `-0.9999000000001667`, received zero    |
| Divide the settle root by two                                                       | `has a tight last-entry boundary for monotone critical and over-damped motion`         | Deviation `0.42113628585326535` exceeded tolerance `0.1`              |
| Snap the near-critical signed series term to zero                                   | `preserves near-critical signed corrections rather than snapping damping`              | Error `2.4525296238309124e-9` exceeded `5e-15`                        |
| Reintroduce a module-level history cache keyed only by time                         | `is byte-identical under shuffled evaluation and interleaved different inputs`         | Cached zero returned for translated equilibrium whose position is one |

The additional stiff-velocity mutant forces the original `C-aS` coefficient instead of the stable real-root identity. `preserves stiff analytic velocity without cancellation or coefficient underflow` kills it: normalized velocity is zero instead of `0.36787944117144233` for `velocity=1e308`, `damping=1e200`, `stiffness=1`, `time=1e200`.

## Residuals

- Binary64 quantization limits tolerances at very large targets. Cross-engine transcendental last-bit identity is not guaranteed.
- Non-representable rates, solver intermediates, durations or an under-damped last-peak index outside the safe-integer range return Diagnostics. This is not an arbitrary cycle scan cap.
- `/motion` packaging remains the existing package-layout deferral: export-map entry, build wiring and consumer smoke test.
- Lean validates existing core specs; no claim is made that the floating-point oscillator is formally proved.
