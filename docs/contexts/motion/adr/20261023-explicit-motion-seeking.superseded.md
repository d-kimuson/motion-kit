# Drive supported Motion paths explicitly and acknowledge rendering before capture

Status: **superseded** by the [accepted time-control and frame-capture ADR](../../../decisions/20261024-time-control-and-frame-capture.accepted.md). The proposal below is retained as history, not an unresolved decision.

## Context

[Spike A](../knowledge/spike-a-seekability.md) found 150/150 matching DOM and PNG comparisons across six controlled fixtures with Motion 14.6.0. Five paths still had stale DOM on 30/61 immediate sequential reads, including numeric `motion.div` styles committed with React `flushSync`. A Motion `frame.postRender` acknowledgement preceded successful captures. Four uncontrolled fixtures (live spring, presence, layout, autonomous animation) each differed between sequential and isolated rendering.

The design already distinguishes Pure Motion (A), controlled Motion integrations (B), and uncontrolled animation (C). It does not yet specify the supported playback-control subset or the DOM acknowledgement protocol. A successful finite experiment must not become an implicit guarantee for all Motion components.

## Decision

**Proposed, pending integration scope and readiness decisions:** retain the existing tier boundary and use explicit value/time input plus a render acknowledgement for the initial Motion integration. External MotionValue writes and numeric styles qualify only within a tested B path. Paused playback controls are an additional candidate B path only with explicit keyframes, autonomous playback disabled, and absolute time assignment; whether to include them in the initial API remains open.

A React commit is not itself the acknowledgement. The tested candidate is a one-shot public Motion `frame.postRender` callback registered after the value/time update, followed by DOM inspection/capture. Production adoption depends on Spike C's clock coordination and the renderer's asset/React readiness contract. Do not substitute an arbitrary sleep or the animation's `finished` promise.

Keep live springs, AnimatePresence and layout animation at C unless a dedicated explicit-time integration is separately verified. A freshly evaluated fixed-input spring may supply a stateless value; its Motion DOM expression remains B. Do not infer A for unknown library components.

## Consequences

The [successor ADR](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#seekability-boundary) decides the tier/acknowledgement boundary and the bounded readiness contract. Public Motion API scope remains Phase 2 work, not an unaccepted architecture proposal. Tier C emits `seek.uncontrolled` as a warning using [DiagnosticSchema](../../../../src/lib/diagnostic.ts); no spike-local Diagnostic type becomes public.

- Future integration tests can reuse the committed sequential/random/isolated comparisons and the stale-immediate-read counterexample.
- Values remain independent of browser elapsed time while the browser can service the render queue.
- The initial API scope, cancellation/timeout diagnostics, asset coordination and asynchronous React completion remain open. This proposal is not a production API implementation or an accepted extension of the guarantee.
- The broad design remains unchanged; the proposed acknowledgement and playback subset would become new implementation constraints only on acceptance.

## Alternatives

- React `flushSync` alone: rejected by the measured stale DOM reads.
- Autonomous playback or target-only updates: rejected by four history-dependent counterexamples.
- Globally virtualize browser time: defer to Spike C; this experiment does not establish its interaction with all integrations.
- Support only externally computed values initially: still a valid product choice; paused-control support need not ship because this experiment can reproduce it.
