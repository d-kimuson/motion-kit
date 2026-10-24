# Load a Composition registry with Vite and share the Composition runtime

## Goal

TASK-153 settles the loading contract for TASK-154 (Composition and registry), TASK-157 (Browser Renderer), and the future preview. Use motion-kit's bundled Vite server to load a named registry into a dedicated composition realm; both hosts drive core's Composition runtime implementation. This is a design, not a shipped API or renderer.

The [Phase 0 ADR](../../../decisions/20261024-time-control-and-frame-capture.accepted.md) is binding for time, ownership, readiness, cancellation, and capture. One shared **Composition runtime implementation and composition-loading contract**, not identical host orchestration, is the requirement. This design also follows the [CLI contract](../../agent/adr/20261024-cli-output-contract.accepted.md) and the author's read-only design.md §3.1, §4.3, §5, §8.4, §9, §10.1, and §11.

Verify the design through the accepted decisions below and the implementation acceptance matrix at the end. TASK-154/157 descriptions need the corrections returned with TASK-153; no Backlog or team-channel write is claimed here.

## Non-Goals

- Implementing the Composition runtime, renderer, registry, CLI, preview UI, or dependencies.
- Revisiting the user's Vite/registry choices or Phase 0's clock/readiness decisions.
- Untrusted rendering, trust modes, OS isolation, network policy, or TASK-176 (do not start).
- Motion/Three public APIs, production GPU-strategy optimization, distributed workers, or a persistent daemon.
- Certifying arbitrary plugins, integrations, hidden clocks, or cross-environment pixel equality.

## Design

### Accepted decisions

| Decision                                                                               | Record                                                                       |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Bundle Vite, load project config, pin Vite 7.3.7 as a production dependency            | [Bundler and version ADR](../adr/20261024-bundled-vite.accepted.md)          |
| Export a named registry; validate schema defaults and props in the page                | [Registry ADR](../../core/adr/20261024-composition-registry.accepted.md)     |
| Reuse one server per project/configuration in a CLI run                                | [Loading lifetime ADR](../adr/20261024-loading-session-lifetime.accepted.md) |
| Use promise RPC and a capture lease over the shared Composition runtime                | [Runtime protocol ADR](../adr/20261024-page-runtime-protocol.accepted.md)    |
| Keep executable browser code in core; isolate the composition realm, not host security | [Boundary ADR](../adr/20261024-composition-realm-boundary.accepted.md)       |

### Registry API and selection

The package root exports `defineComposition`, `defineCompositions`, and `Composition` from core. A CLI entry has exactly one relevant named export, `compositions`; other exports are ignored. A default React component export is not the entry contract. Registration is explicit and ordered, not a global side effect or a JSX tree to traverse.

```tsx
import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { Title } from './Title';

const titleSchema = z.object({
  title: z.string().default('Hello'),
  color: z.string().default('#fff'),
});

export const compositions = defineCompositions([
  defineComposition({
    id: 'title',
    component: Title,
    schema: titleSchema,
    width: 1920,
    height: 1080,
    fps: { numerator: 30000, denominator: 1001 },
    durationInFrames: 150,
  }),
]);
```

`defineComposition` preserves the schema's input/output types; `component` accepts its inferred output props. `defineCompositions` accepts heterogeneous definitions without erasing the type check between each component and its schema. The resulting registry is immutable; duplicate or empty ids and an empty registry are invalid. Id matching is case-sensitive and exact. Use an ordered collection plus a `Map`, not user ids as ordinary object property assignments.

Width/height are positive safe integers; FPS has positive safe integer numerator/denominator and uses Time Module normalization. `durationInFrames` is the canonical nonnegative safe integer frame count: frame validity is `[0, durationInFrames)`. A zero-length Composition can be listed but has no capturable frame. Derived duration/time use the Time Module, not a second floating-point conversion. Do not accept a conflicting `duration` in seconds. Metadata is static for a registry revision in Phase 1; props do not change resolution, FPS, or duration.

`Composition` is the Composition runtime provider/root, not a registry discovery component. The page wraps the selected component in `<Composition definition={definition} compositionRuntime={compositionRuntime}>…</Composition>` after validation, supplying validated props only to that component. `compositionRuntime` is the realm-local explicit-time coordinator; `compositionRealm` is the owning page/iframe, not that coordinator. React elements/components, Zod objects, and integration handles never cross to Node. Nested Composition roots are not a replacement for Sequence.

`listCompositions()` evaluates the entry and returns ordered plain descriptors `{ id, width, height, fps, durationInFrames }`; it does not mount any component. A schema and component stay associated with each descriptor in the page's registry. `inspect` can enumerate the descriptors without a selection. Its broader output/schema metadata remains its own task, not an invented CLI envelope here.

For operations that mount one Composition:

1. An explicit `--composition <id>` selects exactly that id. An unknown id is `cli.composition-not-found` (exit 2).
2. An omitted id selects the sole entry only. Multiple entries without a selection are `cli.invalid-arguments` (exit 2), with a hint listing the available ids. Enumeration by `inspect` does not require an id.
3. An empty/duplicate/malformed registry is an authoring failure, not a missing-id invocation: `render.page-error` (exit 1), with a sanitized message and a corrective hint. Invalid duration uses `composition.duration-invalid`; invalid width, height or FPS uses `render.page-error`. Reserve `composition.props-invalid` for the props schema. TASK-154 must convert a `createFrameRate` failure at the metadata boundary to `render.page-error`, not forward that helper's `composition.props-invalid`; TASK-157 must preserve this mapping through transport. Do not change the Time Module or invent diagnostic codes/details in this design task.

### Props validation before mounting

The schema is the sole defaults authority; there is no parallel `defaultProps` declaration. Reject non-empty component `defaultProps` at declaration, including class statics, inherited defaults and function properties. Return `render.page-error` naming the component and stating that schema defaults are the only defaults authority. Inspect descriptors to reject unreadable/accessor defaults without invoking getters: repeated declarations must keep getter calls at zero, both for throwing getters and getters returning empty defaults. Absent, null/undefined or empty data defaults are allowed; inherited enumerable keys inside the defaults object are non-empty. Validate defaults on each wrapper and recursively unwrap `memo` to its inner component and `forwardRef` to its render function. Reject `lazy` at declaration even when nested in a wrapper; never resolve or execute its payload. Return `render.page-error` naming the `component` field and explaining that a lazy component cannot be validated before it resolves, with a hint to lazy-load inside the component instead of the registry entry. A registered schema accepts a JSON object and must successfully parse `{}` into JSON-valued object defaults. Defaults/refinements must not depend on wall time, randomness, or mutable external state. Non-JSON React nodes, functions, and library objects belong inside the component's code, not the CLI props boundary.

The CLI parses JSON syntax and requires an object before opening a renderer; malformed JSON or a non-object input yields `cli.invalid-arguments`. Omitted props mean `{}`. It sends the raw JSON value through Playwright serialization, never interpolation into HTML, a URL, or a JS source string. The page validates defaults when loading the registry and validates the selected raw props with `schema.safeParseAsync` before creating any React root for that selection. Cache successful defaults per registry revision; share in-flight checks but evict failed/expired checks so retrying with a corrected budget starts fresh. Parse a supplied props object once per mount/props revision, never per frame. Restart a fresh 30-second loading timeout for every defaults or supplied-props parse, including later mounts after initial loading; a hung `safeParseAsync` fails with `render.page-error`, not an abort or a frame timeout. The exact timed steps are defined below.

Pass the raw object straight to Zod: no manual shallow/deep merge with parsed defaults. Missing fields acquire the schema's defaults; explicit null is validated normally; unknown-key handling is the schema's policy. The schema's output must also be a JSON-valued object, checked before reserved-name validation: null, undefined, array and primitive roots fail with `composition.props-invalid`, not `render.page-error`. Reject cycles, exotic objects, accessors, symbol/non-enumerable keys, bigint anywhere and non-index array properties. Accept ordinary and null-prototype objects at the root and nested; preserve their data through rebuilding, not their prototype. Rebuild and validate every own data descriptor into the prepared JSON tree, preserving nested own `__proto__` data rather than trusting a record validator that skips keys. At the real component boundary the values are deep-equal to that checked tree and nested references are shared; top-level identity is not promised because React constructs a new props object. Reject top-level own `key`, `ref`, `__self`, `__source` and `__proto__` with `composition.props-invalid` and a message/hint naming the field: React consumes or copies these names and cannot deliver them faithfully. Nested occurrences remain accepted JSON data. Schema refinements/transforms execute in the page, not via a generated JSON Schema validator in Node. Later `inspect` JSON Schema is descriptive and cannot replace this authoritative parse.

Failure returns `composition.props-invalid`, with `details.issues` containing JSON-serialized Zod issues and known `location.compositionId`. Sanitize custom issue messages and omit raw input values/secrets/stacks before transport. Reject non-JSON output using a producer-created custom Zod issue at the relevant path. A user refinement that throws rather than returning validation failure becomes a sanitized `render.page-error`. No failed parse mounts a fallback/default scene. Changing props disposes the old realm and starts a new composition instance; it is not an in-flight frame mutation.

### Vite configuration and entry loading

`src/render/loading` owns a Node HTTP server on loopback and an ephemeral port, with Vite in middleware mode (`appType: 'custom'`). Use motion-kit's own import of the exact production dependency `vite@7.3.7`; never select the user's installed Vite or spawn their CLI. Vite is not an optional peer. The [dependency evidence](../knowledge/20261024-vite-loading-cost.md) explains why Vite 8 is not selected: its mandatory Lightning CSS dependency fails the current license allowlist.

The caller supplies the entry and project root (CLI default: invocation working directory). Resolve the entry relative to that directory before Vite config loading. Use `loadConfigFromFile` with that project root and the shared serve/development environment for Vite's normal `vite.config.*` discovery, including function/async configs and plugin resolution relative to the user's project. Before calling it, install Node module-resolution interception in the loading child for both ESM imports and CommonJS require: bare `vite` and supported public `vite/*` imports from the config and its plugin dependency graph resolve only to motion-kit's bundled 7.3.7. The loading-service config-loader adapter must intercept Vite's config-bundling/externalization resolver before its project-relative lookup, aliasing these specifiers to the bundled package, as well as intercept subsequent Node loads of externalized modules. Unmodified `loadConfigFromFile`, `resolve.dedupe` or Node hooks installed only after bundling do not provide this guarantee. A config importing `defineConfig` works with no project Vite installed. Do not rewrite the user's dependency tree. This does not adapt Vite 8 APIs, private/absolute-path Vite imports, plugin-spawned processes or arbitrary custom loaders; those bypasses are unsupported and detected bypasses fail rather than selecting a second Vite. Load once, merge the returned config with controlled settings, then call `createServer` with `configFile: false` to avoid evaluating it twice. Track the returned config-file/dependency paths for session restart. No config is required. An explicit config `root`, aliases, plugins, CSS settings, `publicDir`, environment handling, and asset resolution apply; the entry's absolute identity does not change when config changes root. Use `command: 'serve'`, `mode: 'development'` for both hosts, so config branches and `import.meta.env` do not silently select different scene code. Rendering is not a production Vite build.

Merge project settings first, then apply a small documented set of motion-kit-owned settings: middleware/custom HTML handling; loopback listener; bootstrap entry routes; no auto-open; host-specific HMR; React/ReactDOM and Composition runtime singleton resolution; and a logger targeting stderr. Honor the user's `base` when constructing the shell/module URLs. Preserve plugins and aliases; the reserved motion-kit bootstrap/entry ids are prepended as exact-match aliases ahead of the project's aliases (Vite's alias plugin runs before `enforce: 'pre'` plugins, so the loading plugin's own `resolveId` cannot win on its own) and therefore override any conflicting project alias rather than running two Composition runtimes. Resolve React/ReactDOM once from the project and use that same installation for the bootstrap and user's tree. Bootstrap package resolution is fixed to the invoking motion-kit installation; qualify this deduplication with linked/workspace packages.

Basic TSX uses Vite's built-in transform with React's automatic JSX runtime; no additional React plugin is required. User React plugins may supply transforms/HMR, but composition refresh uses the reset semantics below, not retained Fast Refresh state. A user's separate Vite major can coexist in the dependency tree but is never loaded as the config's Vite. Before server creation, the loaded user config is passed to the bundled Vite unchanged, except motion-kit's reserved settings, which are overridden after resolution per the precedence above: middleware/custom `appType`, the loopback listener, entry routes, no `open`, host-controlled HMR, React/runtime singleton resolution, the stderr logger, and `configFile: false`. Which keys Vite still applies in middleware serve mode, and how a config or plugin throw is reported, are recorded in the [bundled-Vite ADR](../adr/20261024-bundled-vite.accepted.md); motion-kit never rejects a key and never maintains a key list.

A private Vite plugin resolves a generated entry id to a tiny module which imports the user's named registry and calls core's browser bootstrap. The generator and HTML shell live at `src/render/loading/entry-source.ts` and `src/render/loading/html-shell.ts`; the browser implementation lives at `src/core/runtime/browser-entry.ts`. The generated module imports the bootstrap through the browser-only subpath `@kimuson/motion-kit/browser`; this subpath exposes only the bootstrap and is never re-exported by the package root. The generated module does **not** import either generator, any `src/render` module, or `src/cli`. Entry paths are serialized as module string literals; props are never embedded. The shell contains only the root and boot module plus Vite's normal client injection where enabled. Use `transformIndexHtml` so user HTML/plugin transforms and Vite facilities apply. Do not serve the user's application index or mount its application router.

Create the HTTP/Vite service, install host callbacks/error listeners, then navigate to the shell. A protocol-version handshake precedes registry enumeration and selection. On selection validate props, establish the fixed-size root/viewport, and register the root's expected content acknowledgement. `mount` prepares the instance/root but does not render the user's content without an owned time snapshot: the first frame operation performs the initial content render, commit/discovery/settlement. A successful mount is not frame readiness. A module import or schema error must complete the loading operation as a Diagnostic, not leave the host waiting forever for a global.

### Loading lifetime and cost

A loading session is one Vite module graph/configuration and HTTP listener for one project root, entry, and host mode (`renderer` or `preview`). Reuse it across every frame and across composition selections within one CLI run; switching compositions creates a fresh page/context, not another Vite server. A different project/configuration/mode needs a different session; a session and a Composition realm are never shared between renderer and preview. There is no process-global daemon or reuse across independent invocations. Reuse the mounted page across frames of one composition instance when it remains healthy.

The isolated Vite 7.3.7 probe on Node 26.12.0/macOS arm64 measured five fresh processes: **549.55, 143.17, 78.75, 91.53, 112.07 ms** from dynamic import through an empty middleware server; `createServer` alone took **15.47–43.86 ms**. These are warm-filesystem/process-cold observations, not a user-project cold-start benchmark. Config/plugins, dependency optimization, TSX graph transformation, Chromium launch, assets, and first-frame settlement are excluded. Budget an initial **0.5–3 s estimate** for Vite/config/first module load in a small project; plugins and cold caches can exceed it. TASK-157 measures representative first-load cost before publishing performance claims.

Repeating even the empty startup per output frame is wasteful and would discard module/transform caches; reusing a server per run is both simpler and cheaper. Startup is outside the per-frame budget. Use three independently configurable **30-second timeout** defaults:

- **Loading:** the initial deadline starts before service/config startup and covers config evaluation, server creation, navigation/module import, protocol-version handshake, registry evaluation and metadata validation. Finish it before defaults parsing. Restart a full loading timeout immediately before each defaults or supplied-props parse, including parses in later mounts: it covers `safeParseAsync`, JSON-output validation, issue/error conversion and, for the selected props, root/viewport preparation and the mount acknowledgement. A defaults parse ends on its validation result. Parsing is sequential, with no unbounded gap between these supervised operations. Loading expiry returns a failed outcome with `render.page-error` and an operation-specific hint; late results cannot mount or publish.
- **Caller/queue:** a fresh deadline starts when each `settleFrame` request is submitted and covers transport, queue residence and the complete ownership-grant handshake, even on an already mounted page. It stops at confirmed ownership acquisition. Expiry aborts that request with no Diagnostic or frame; revoke any pending grant and ignore late acknowledgements. It is not the loading timeout.
- **Frame:** the external host records its deadline at confirmed ownership grant/dequeue, before authorizing page mutation, and keeps it through settlement, screenshot and final validation. The grant handshake must finish under the caller/queue deadline before this transition; no frame budget runs while queued. Frame expiry follows the Phase 0 asset/frame Diagnostic mapping below, never a fresh budget after readiness.

These are finite policy defaults, not measured service-level guarantees. Enforce loading timeout from a supervising Node process: run user config/plugins and Vite in a child Node process so a synchronous plugin cannot block that supervisor. This is lifecycle supervision of trusted code, not OS security isolation. On failure/cancellation terminate the loading process and close HTTP/HMR listeners, pages/contexts, and browser resources owned by the session. Do not kill a caller-owned external resource.

Render disables HMR application. Source/config edits during a render are unsupported; detected changes fail the invocation with `render.page-error`, discard incomplete output, and require a fresh session rather than mixing revisions. This is not a filesystem snapshot guarantee against every external change. Preview keeps Vite HMR transport but resets the Composition realm and its Composition runtime on relevant module/style changes instead of retaining scene state. Host UI remains outside the reloaded realm. Config changes restart the preview loading session and replace its realm. Preview updates affect only preview-owned sessions/realms, never renderer-owned leases. Renderer and preview always use separate sessions and realms even when they load the same entry.

### Runtime protocol and capture lease

The conceptual page API is an internal, versioned protocol, not a new CLI envelope or a second Renderer API:

```ts
// All arguments/results are plain serializable data.
type HostSource = 'renderer' | 'preview';
type SettleFrameResult =
  | { status: 'ready'; lease: CaptureLease }
  | { status: 'failed'; diagnostics: [Diagnostic, ...Diagnostic[]] }
  | { status: 'aborted' };

// CaptureLease is the plain identity defined below; Diagnostic is from src/lib.
interface PageSettlement {
  settleFrame(
    frame: number,
    request: { source: HostSource; requestId: string },
  ): Promise<SettleFrameResult>;
}

window.__motionKit.protocolVersion; // 1
window.__motionKit.listCompositions();
window.__motionKit.mount({ compositionId, props, revision });
window.__motionKit.settleFrame(n, { source, requestId }); // Promise<SettleFrameResult>
window.__motionKit.validateCapture({ lease, resourceVersions });
window.__motionKit.completeCapture({ lease, resourceVersions });
window.__motionKit.cancel({ requestId });
window.__motionKit.dispose();
```

`settleFrame(n)` is the exposed page-side seek/commit/settle operation, distinct from the host's `renderer.renderFrame({ frame })` capture operation. The host supplies `source: 'renderer' | 'preview'` and a transport request id; the id only correlates RPCs and is **not** another frame-generation counter. Results distinguish ready, failed, and aborted outcomes. Failed carries Diagnostics; aborted carries no Diagnostic or frame. Ready carries a lease identifying the owning `source`, composition instance/revision, core's monotonically increasing per-realm frame generation, Global Frame, rational FPS, derived Presentation Time, and the settled resource versions. A disposed realm gets a new instance identity even if its counter restarts. Check the lease source against the realm's fixed host mode and deduplicate claims by `(source, instance, revision, generation)`; reject cross-source or duplicate ownership/completion claims.

Node calls page methods with `page.evaluate`. Before navigation it installs a Playwright `page.exposeFunction` callback for lifecycle events, ownership handshakes, and Diagnostics; do not use a raw CDP binding or CDP virtual time. Ordinary preview uses the same protocol through a `MessageChannel` to its iframe, correlating requests and checking source/origin during initial channel setup. Only plain protocol values cross this channel; it exposes no filesystem, process, or arbitrary-evaluation API. Neither adapter is the time source. The callback is transport, not a readiness signal: a returned ready lease is authoritative. Validate protocol version, shape, instance, and generation on both sides; ignore stale events and deduplicate Diagnostics received through both events and operation results.

The ownership sequence implements, rather than replaces, Phase 0:

1. core's realm coordinator allocates the shared frame generation and queues requests. Renderer requests never supersede anything. A new preview request cancels older preview work only, preserves active/queued renderer work, and joins behind survivors. Queue residence uses the separate 30-second caller/queue timeout or cancellation, not a loading or started frame budget. The coordinator retains the source-aware Phase 0 policy defensively, but cross-mode requests to a realm fail protocol validation; hosts do not share realms.
2. When the ready realm can dequeue, the coordinator asks the external host to grant ownership. The host records its monotonic start/deadline at the confirmed grant; **this is ownership acquisition/dequeue**, before authorizing page mutation. A request waiting for grant confirmation is still queued. Node's deadline cannot depend on a subsequently received in-page timestamp or readiness event. For preview, the separate UI host performs the grant using its unpatched clock. Failure to finish the ownership-grant handshake remains subject to the separate 30-second caller/queue timeout and aborts without a Diagnostic; the earlier protocol-version handshake is loading work and its loading expiry fails with `render.page-error`.
3. Hold Presentation Time derived by the Time Module fixed. Discover assets before suspension; await all required generation-tagged content layout-effect acknowledgements and versioned asset/integration work. Drain until stable under the same generation/deadline. A Suspense fallback or root-only layout effect cannot acknowledge suspended required content.
4. Return a ready lease **without releasing ownership**. For a renderer, Node validates that lease/resource versions immediately before screenshot, captures with the same fixed viewport/crop/DPR and `animations: 'allow'`, then calls `completeCapture`. That method atomically rechecks versions/generation, accepts publication, and releases ownership. Node publishes PNG bytes only after acceptance. A changed resource version returns a re-settle outcome: discard bytes, retain ownership/generation/original deadline, repeat settlement and capture. `validateCapture` can likewise request re-settlement before a screenshot starts.
5. Cancellation, disposal, or preview supersession aborts that generation; discard bytes rather than retry it. Release only when old work cannot mutate the realm; otherwise close/recycle it. A normal preview host completes the lease after the settled frame is presented without taking a screenshot. It does not make a capture-completion claim.

The external host keeps the deadline through screenshot RPC completion and final validation; a screenshot promise does not get a new budget. Timeout/hung GPU/RPC causes the host to invalidate the lease, discard late results, close/recycle the page/context, and terminate the browser if necessary. Reusing Vite does not justify reusing a poisoned realm. Preview shares the successful settlement and cancellation semantics but does not promise Node's ability to terminate an unresponsive browser process; replacing an iframe is not hard isolation against a blocked browser main thread.

### Adapter registration and Diagnostics

core supplies realm-local `registerIntegration` with a stable registration identity/version, capability metadata, absolute-time seek/settle callbacks, and disposal. Integration modules opt in through their own mounted consumers; no global import-time singleton registration. Each registration belongs to a composition instance and associates its completion with the active frame generation and source versions. New registrations invalidate the settled resource set and participate in the same drain. Unregister/dispose detaches callbacks; a late callback cannot satisfy a later frame. Runtime teardown attempts every integration disposer and clears registrations/listeners even when a disposer throws. Its `Result<undefined>` reports a sanitized `render.page-error`; the host must check that result. Repeated disposal returns the recorded result without re-running cleanup.

Foundation implements only the neutral protocol, React content acknowledgement and basic asset cooperation with TASK-158. Future motion/three adapters implement their own library-specific work; core/render never import their libraries or receive scene objects. The root does not import `/three` merely to discover adapters. Capability identification can emit `seek.uncontrolled`; unknown code is never inferred A/B. Detection is not universal instrumentation of arbitrary user JavaScript.

Use `src/lib/diagnostic.ts`, not a dependency on agent. The [Phase 0 failure table](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#failure-diagnostics) is authoritative:

- Known pending assets at deadline: `asset.not-ready`, with all pending registrations and configured `timeoutMs`.
- No known pending assets, or an unresponsive page: `render.frame-timeout`; never invent an asset inventory from stale host state.
- Required load/decode/upload/context-loss failure: `asset.load-failed`.
- Detected Tier C: `seek.uncontrolled` warning; independent readiness failures still prevent output.
- Launch failure: `render.browser-launch-failed`; module/registry/config/page exception: `render.page-error`; implementation bug: `internal.unexpected`.
- Cancellation/supersession or caller/queue timeout (including an unfinished ownership grant): aborted control flow, no Diagnostic or frame. Startup/loading expiry, including any restarted props-parse timeout, fails with `render.page-error` and an operation-specific hint, not `render.frame-timeout`.

Keep latest pending-asset observations for troubleshooting, but classify asset timeout only when the coordinator can confirm the current inventory. Include known location fields; redact credentials/query secrets and exception stacks. Vite logs and user Node/browser console output are routed to stderr by the host (including the loading child process); only the CLI emits the single JSON envelope on stdout. A stack is never inserted into a Diagnostic.

### Source and realm boundaries

| Location (planned)                                          | Executes in                         | Allowed role                                                                     |
| ----------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `src/render/loading/{server,entry-source,html-shell}.ts`    | Node loading process                | Vite/config/HTTP and generation of a tiny entry and shell                        |
| `src/render/browser`, `src/render/capture`                  | Node supervisor                     | Playwright, lifecycle, deadlines, capture; no Composition runtime implementation |
| `src/core/composition`, `src/core/runtime/browser-entry.ts` | Browser                             | Registry/provider and bootstrap, shared Composition runtime implementation       |
| `src/lib` protocol/Diagnostic types                         | Either                              | Plain data/schema only, no runtime host imports                                  |
| Future preview host                                         | Browser, outside composition iframe | UI and rAF scheduling, MessageChannel host adapter                               |

The render page is a dedicated top-level page/context containing only the Composition; preview embeds the same shell/bootstrap in a dedicated iframe. They share the loading contract and Composition runtime implementation, never a loading session or mutable Composition realm. Native UI clocks remain untouched. No ambient clock shims are introduced; any future qualified compatibility shim is restricted to the composition realm. Page/iframe separation prevents accidental clock/style/state coupling, **not hostile same-origin access or host compromise**.

The generated entry and HTML are Node-owned generator modules under `src/render`, already covered by `tsconfig.json`'s `src` include. Keep browser logic in checked TS/TSX rather than opaque generated strings. TASK-157 adds a checked declaration for the virtual user-entry import and tests the emitted wrapper/shell, avoiding `*.generated.*` and `generated/` names that oxlint currently ignores. HTML itself is tested by navigation, not claimed to be TypeScript-checked.

Existing lint blocks Node built-ins outside render/CLI/tooling and Three imports outside three, but it does **not** enforce the entire context graph. TASK-154/157 must add restrictions for imports of render/cli/agent from browser roots (including relative paths and package subpaths), keep core free of motion/three/presets dependencies, and add a resolved-browser-graph assertion for transitive Node built-ins/Vite/Playwright/render/cli imports. Type-only imports also use shared protocol modules rather than Node barrels. Run the resolved-browser-graph assertion in CI from `@kimuson/motion-kit/browser` and the emitted entry, including package-export resolution; any transitive Node built-in or host import fails CI. Negative fixtures for a Node built-in and render through an alias must fail; string generation must not bypass this check. No broad browser exception under `src/render/**` is permitted. These are future implementation checks, not a claim that a documentation change enforces them today.

The trust model is the user's own project code with the invoking user's privileges, like Vite or a test runner. User config/plugins run in Node and may access those privileges. Keep Chromium's sandbox on by default, suppress Playwright defaults that disable it or enable unsafe software WebGL, and expose container sandbox opt-out/software-WebGL opt-in explicitly as required by Phase 0. Serve the normal Vite project/asset scope, not an added filesystem/process API. Do not present that scope or an iframe as an access-control guarantee. No untrusted mode, OS job sandbox, or network policy is implemented in Phase 1.

### Implementation acceptance matrix

| Owner               | Required evidence                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TASK-154            | Typed heterogeneous registry; duplicate/empty ids and malformed metadata; rational FPS and zero-duration/range rules; schema defaults, invalid/custom/async props, no per-frame parse, no component mount on failure; Composition runtime and generation-tagged content acknowledgement; duration vs width/height/FPS vs props Diagnostic mapping                                                         |
| TASK-157 loading    | No-config TSX; config aliases/plugins/CSS/public assets/base/root; config imports bundled Vite with user Vite absent or major 8 installed; pass through plugins and non-serve keys; surface thrown config/plugin errors by name; one server across frames/selections; fresh realm on selection/props change; bounded startup including blocked plugin and restarted later props parses; complete teardown |
| TASK-157 transport  | Version handshake and import failure; exact selection diagnostics; ready is not release; capture/version re-settlement; stale callbacks and late screenshots; queued renderer/preview precedence; 30-second caller/queue expiry aborts, loading/parse expiry fails; stalled later grant; source/duplicate lease rejection; hung GPU/RPC termination; one clean JSON stdout                                |
| TASK-154/157/158    | Phase 0 sequential/random/reverse/repeated/fresh/held comparisons, nonconstant frames, delayed/nested Suspense and assets, source changes, current layout-effect acknowledgements, exact failure mapping                                                                                                                                                                                                  |
| TASK-157 boundaries | tsconfig coverage of generator and browser source; negative lint/import-graph fixtures; no Node runtime in page; no preview CDP requirement or host clock patch; explicit sandbox/GPU defaults                                                                                                                                                                                                            |
| Future preview      | Same entry/bootstrap/registry and settlement via MessageChannel; native UI rAF outside iframe; HMR resets revision/state and cannot mutate a renderer-owned lease                                                                                                                                                                                                                                         |

Current validation is documentation review plus the repository feedback loop and isolated dependency/startup probe, not implementation of this matrix. Remaining uncertainty is qualification cost/plugin compatibility and representative cold starts, not an undecided loading architecture.

## Alternatives

- Custom bundler or mandatory user-managed Vite: rejected by the user's decision; duplicates configuration and HMR work.
- Single default-exported Composition: rejected by the user's decision; prevents useful enumeration without meaningful Phase 1 savings.
- Optional-peer Vite or dynamically selecting the project's Vite: saves some install bytes but makes a normal CLI invocation depend on user setup and varying server semantics.
- Server per frame/Composition, or a persistent daemon: the former repeats setup/cache work, the latter adds cross-invocation configuration and disposal complexity before measurements justify it.
- Node-import the TSX registry or serialize React/Zod objects: introduces a second execution/resolution path or non-data boundaries; page validation uses the real schema.
- Raw CDP readiness binding or shared UI/composition global: ordinary preview cannot use CDP, and sharing globals defeats clock/style isolation.
