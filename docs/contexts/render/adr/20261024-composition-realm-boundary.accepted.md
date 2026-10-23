# Generate the shell in render but keep executable page code in core

## Context

The [context map](../../../CONTEXT-MAP.md) keeps Node in render/agent and optional library integrations outside core. TASK-153 requires the generated entry and HTML shell under `src/render`, while the browser bundle must never import render or CLI. Treating `src/render/**` as a mixed Node/browser directory would defeat its existing lint exception. Preview must also protect its UI scheduling clock from any composition-local compatibility behavior.

The selected Phase 1 trust model in [Phase 0](../../../decisions/20261024-time-control-and-frame-capture.accepted.md#capture-environment-and-gpu-baseline) is trusted user project code, not an untrusted rendering service.

## Decision

Keep the Node-only Vite plugin, entry-source generator and HTML-shell generator under `src/render/loading`. Their generated wrapper imports only the user registry and the browser bootstrap through `@kimuson/motion-kit/browser`, mapped to `src/core/runtime/browser-entry.ts`. This browser-only subpath exposes only the bootstrap and is never re-exported by the package root. The page graph never imports the generator files, `src/render`, `src/cli`, agent CLI modules, Vite, Playwright or Node built-ins. Shared protocol/Diagnostic data lives in `src/lib`; core never imports host code or motion/three libraries.

Keep real page behavior in checked TS/TSX under core rather than interpolated strings. The entry wrapper contains imports/bootstrap only, with serialized module specifiers and no props injection. `tsconfig.json`'s `src` include covers generator and browser sources; provide a checked virtual-entry declaration and test generated wrapper/HTML navigation. Do not use ignored `generated/` paths or `*.generated.*` filenames for source that needs lint coverage.

TASK-154/157 enforce imports of Node-only contexts from browser roots, including relative and package-subpath imports, and run a resolved import-graph test in CI from `@kimuson/motion-kit/browser` and the emitted entry, following package exports and aliases. Any transitive Node built-in, Vite, Playwright or render/cli/agent host import fails CI; negative fixtures must prove rejection of a Node import and an alias to render. The current lint rules enforce Node built-ins and Three placement, **not the complete context dependency graph**; this design does not claim those new checks already exist. Do not add an exception that permits browser modules to inherit `src/render/**`'s Node privileges.

A renderer uses a dedicated page/context; future preview embeds the same shell/bootstrap in a dedicated composition iframe, outside its UI host. The loading/registry/Composition runtime contracts are identical, but renderer and preview never share a session or Composition realm. `compositionRealm` names the page/iframe; `compositionRuntime` names its explicit-time coordinator. No ambient clock patches are added. Any future qualified shim applies only to the composition realm, never the UI host. Adapter registrations, asset state, generation and React root are owned/disposed with that realm.

Realm separation is accidental state/clock/style isolation, **not a host security boundary**. The user's Composition/config/plugins have the invoking user's privileges, like Vite or a test runner. Keep Chromium's sandbox on by default and suppress Playwright's disabling/unsafe-software defaults; container sandbox opt-out and the qualified software-WebGL flags require explicit options. Serve the normal Vite project and referenced asset scope without adding privileged page RPCs. No trust modes, OS job isolation, network policy or untrusted-rendering implementation is added; TASK-176 remains parked, do not start.

## Consequences

The physical location requirement for generated HTML/entry has no browser dependency exception: Node generates an artifact but is not imported by it. core gains a library-neutral browser bootstrap and ReactDOM dependency, while render remains Node-only. Lint plus resolved-graph negative fixtures must catch alias/transitive leaks that simple import-pattern rules can miss.

An ordinary preview needs no CDP and leaves UI clocks untouched. A same-origin iframe does not prevent hostile access to its parent, and Vite config runs trusted Node code; neither is marketed as sandboxing untrusted inputs. A loading child process exists for timeout supervision only.

## Alternatives

- Composition runtime under `src/render/client`: makes the page import a Node context and requires an exception contrary to the requested boundary.
- Hide all browser behavior in generated strings: avoids meaningful tsconfig/lint checking of executable code.
- Share preview UI globals/React root with the Composition: permits state/style/clock coupling and complicates revision disposal.
- OS/network isolation or untrusted modes in Phase 1: contrary to the selected trust model and parked TASK-176 scope.
