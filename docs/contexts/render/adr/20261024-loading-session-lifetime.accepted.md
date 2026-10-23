# Reuse a supervised Vite loading session throughout one CLI run

## Context

A render can request many frames and select several registry entries without changing the project/configuration. Vite setup and module transformation are not frame work. The [Phase 0 contract](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#readiness-barrier-contract) starts a frame deadline only at exclusive ownership acquisition, excludes launch/queue time, and prohibits reuse of a poisoned realm.

The [cost probe](../knowledge/20261024-vite-loading-cost.md) measured Vite 7.3.7 import plus empty middleware initialization in five fresh Node processes at 78.75–549.55 ms, excluding config/plugins, optimization, browser startup, TSX/assets, and capture. It is not a production cold-start benchmark.

## Decision

Reuse one Vite module graph and loopback HTTP service for each project/root, entry, resolved configuration, and host profile **within one CLI invocation**. Reuse across frames and composition selections; create a fresh composition realm for a selection/props revision, not a fresh Vite server. Keep a healthy mounted realm across its frame requests. Different configurations/profiles use different sessions. No cross-invocation daemon or global registry cache is introduced.

Budget **0.5–3 seconds as an estimate** for small-project Vite/config/first-module loading, with slower plugins/cold caches explicitly outside that estimate's assurance. Measure representative startup separately in TASK-157. Do not multiply setup by frame count or hide it in a frame timing number.

Run Vite and trusted user config/plugins in a child Node process supervised by the renderer host. This preserves a bounded loading timeout even if config blocks synchronously; it is lifecycle supervision, not a security boundary. A configurable **30-second loading timeout** bounds service startup and registry/schema initialization; a separate configurable **30-second per-frame timeout** starts only at dequeue/ownership grant and includes capture/final validation. These finite defaults are policy choices, not derived from Spike D or service-level guarantees. Caller timeout/cancellation handles queue residence.

Render disables HMR application; detected source/config changes fail the invocation and discard incomplete output instead of mixing revisions. Editing inputs during a run is unsupported, not made immutable by Vite. Preview uses HMR transport to replace its composition realm, never preserve scene state across revisions or patch a renderer-owned frame. Config changes replace the session. The [Design Doc](../design-doc/20261024-composition-loading.md#loading-lifetime-and-cost) defines cleanup and profile behavior.

Dispose listeners, Vite/watchers, child process, owned browser/context/page resources and outstanding requests on normal completion, failure, or caller abort. Cancel/dispose old work before transferring realm ownership; recycle/terminate an unresponsive realm, while retaining a healthy loading service when safe. Do not terminate caller-owned resources.

## Consequences

Transform caches and server initialization amortize across an entire render without retaining application state across unrelated compositions. A new CLI invocation still pays cold setup. The child process adds startup/IPC overhead not measured by the empty-server probe; TASK-157 must measure it and verify termination of blocked plugins and hung browser RPCs.

A development-server loading contract is not a frozen filesystem artifact. Users must not edit render inputs concurrently. General resource/cache limit qualification remains Phase 0's existing risk handoff, not a new daemon design.

## Alternatives

- Server per frame or composition: repeats setup and discards reusable module/transform caches without improving realm state isolation.
- Persistent daemon across CLI invocations: introduces configuration identity, invalidation, user-process lifetime, and ownership complexity before measurements justify it.
- Reuse the same React realm across different compositions/props: leaks state/callbacks and weakens revision isolation.
- In-process promise timeout around user plugins: cannot bound a synchronous Node event-loop stall; the supervisory process must remain responsive.
