# Evaluate springs in closed form and settle at the last tolerance entry

## Context

TASK-155 implements design.md §6.2's Spring Contract and §13.2's arbitrary-time and Retarget tests. The [Pure Motion contract](20261024-pure-motion-contract.accepted.md) already fixes the shared Result/Diagnostic convention. The design does not define a settle tolerance, pre-start behavior or a numerical stability strategy.

## Decision

- `Spring` is a readonly description with explicit `from`, `to`, `start`, `velocity`, `stiffness`, `damping`, and `mass`. Times are seconds, velocity is value units per second. All fields and evaluation times are finite; stiffness, damping and mass are strictly positive. Undamped motion has no general sustained settle time and is rejected.
- `spring(time, description): Result<number>` evaluates position. `springState(time, description): Result<SpringState>` also evaluates analytic velocity. Before `start`, hold `from` with zero velocity; at `start`, return exactly `from` and the supplied initial velocity. The right-hand initial velocity can differ from the pre-start hold's velocity.
- Solve `m x'' + c x' + k(x-to) = 0` without integration, mutable state or caches. With `a=c/(2m)`, `w=sqrt(k/m)`, `y=from-to`, the position deviation is `(C+aS)y + S velocity`, and velocity is `-w² S y + (C-aS) velocity`.
  - Under-damped (`a<w`): `q=sqrt(w²-a²)`, `C=exp(-at) cos(qt)`, `S=exp(-at) sin(qt)/q`.
  - Critical (`a=w`): `C=exp(-at)`, `S=t exp(-at)`.
  - Over-damped (`a>w`): use the two decaying exponentials, never `exp(-at)*cosh(qt)`. Compute the slow rate as `w*(w/a)/(1+q/a)`, avoiding subtraction of nearly equal roots. `expm1` preserves the exponential difference.
- Compute `q` from a factored discriminant without squaring large rates. The near-critical path is `|q*t| < 0.001`, where the signed cosine/cosh and sinc/sinhc series through sixth order have omitted terms below binary64 precision. This is a time-scaled criterion, not a fixed damping-ratio window: small discriminants can still accumulate substantial phase over long times. Do not snap a near-critical spring to the critical solution. Near-critical real-root extrema use `atanh` rather than subtracting large modal coefficients.
- `retarget(description, atTime, { to, stiffness?, damping?, mass? }): Result<Spring>` returns a new description with the sampled position, sampled velocity and `start=atTime`. Physical parameters default to the old description's; callers cannot override the inherited initial position or velocity through this type. Nothing mutates the original.
- `springSettleTime(description, tolerance): Result<number>` returns a **duration from start**, not an absolute timestamp. Tolerance is a finite positive absolute position distance. Settling means **sustained last entry**: the earliest duration after which position stays inside `|position-to| <= tolerance`. It is not the first target crossing, a velocity criterion, or an envelope approximation. Already sustained motion returns zero. A Sequence can use the duration directly; absolute timeline evaluation uses `start + duration`.
- The settle solver is a pure numerical root search over the closed form. An analytic envelope `(|y|+|velocity+a*y|t)exp(-slow*t)` bounds the search; logarithmic evaluation avoids envelope overflow. Under-damped extrema are spaced `pi/q`, with exponentially decreasing magnitudes: select the last above-tolerance extremum directly, then bisect the last entry. No cycle scan or arbitrary duration cap is used. Critical and over-damped motion have at most one positive extremum. Bisection terminates when its endpoints are adjacent representable durations and returns the inside endpoint. Tighter tolerances cannot settle earlier. Earlier under-damped crossings may be inside the band; only the point just before the last-entry boundary must be outside.
- Invalid arguments return `motion.invalid-input`; non-representable computations return `motion.non-finite-result`. `spring` requires a finite position; `springState` and `retarget` require finite position and velocity. There is no silent NaN/Infinity result and no thrown recoverable failure. Easing remains the existing `Easing` callback type; a physical spring does not take an easing callback.

## Consequences

Random seeks and explicit target changes are Tier A value computations. Numerical evaluation uses binary64 transcendental functions: repeated evaluations and separate processes on the same Node runtime are byte-identical; cross-engine/platform last-bit identity is not promised. Very large targets can quantize small deviations, and extreme parameter/displacement combinations can exceed the representable solver range and produce a Diagnostic. A last-peak index outside the safe-integer range is also diagnosed: binary64 cannot distinguish its adjacent cycles. Tolerances should be meaningful in the output's numeric scale.

The source barrel exposes the API. As in the existing Pure Motion ADR, the `/motion` package subpath is deferred to the package-layout task (export-map entry, build wiring and consumer smoke test). No package-export change is included here.

## Alternatives

- Stateful numerical integration or a time-keyed cache: rejected because arbitrary seek order and retarget inputs must not affect a sample.
- A fixed near-critical damping threshold: rejected because it changes the physical solution and ignores elapsed time.
- Envelope-only settling: rejected because it is conservative rather than the actual last entry, and a shorter duration can already be sustained inside tolerance.
- First tolerance crossing: rejected because an under-damped spring can leave the band again.
