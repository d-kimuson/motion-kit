# Bundle Vite 7 as a production dependency and load the user's configuration

## Context

TASK-153 records the user's accepted decision of 2026-10-24: motion-kit supplies Vite, runs it in middleware mode from `src/render`, and loads the project's `vite.config.*` when present. Users need neither a Vite installation nor a second bundler configuration. HMR and the shared preview/render loading contract motivate this choice; this ADR does not reopen it.

The open version/install-policy question must respect [local development](../../../guidelines/local-dev.md), including exact pins, the 1440-minute release-age floor, and the production [license allowlist](../../../../scripts/check-licenses.ts). See the [isolated dependency evidence](../knowledge/20261024-vite-loading-cost.md).

## Decision

Use **Vite major 7**, initially **`vite: "7.3.7"` in production dependencies** when TASK-157 implements loading. Import that dependency from the Node-only loading service. It is neither an optional peer nor a root browser export. No package/lockfile changes are required in this design-only task: isolated installation verifies the decision without shipping unused code/dependencies.

Vite 7.3.7 is MIT, published 2026-10-06, older than the release-age floor at this decision. Its clean platform-resolved production closure passes the existing license checker without exceptions. Node's supported range is `^20.19.0 || >=22.12.0`, compatible with the repository's Node 26. Vite 8.3.5 is not chosen: its mandatory `lightningcss@1.33.0` is MPL-2.0 and the isolated closure fails the current allowlist. Do not add a licensing exception or substitute an unreviewed major to obtain a newer server.

The user's own Vite, including a different major, can coexist in their dependency tree. Never replace it, override all Vite versions, or select it as motion-kit's server. Load their config/plugins through the bundled server's config loader; user plugin packages resolve from the project. Those plugins must support the bundled Vite 7 API. Report incompatibilities with the version/config location and a corrective hint, rather than drop plugins silently. Preview and rendering both use serve/development semantics; differences in host supervision/HMR do not choose a second scene build.

Follow the [Design Doc's configuration precedence](../design-doc/20261024-composition-loading.md#vite-configuration-and-entry-loading): retain user aliases/plugins, CSS/assets/root/base, but reserve the runtime bootstrap, singleton resolution, middleware/listener, logging, and host-controlled HMR. Built-in TSX transformation suffices without requiring a React plugin.

Patch/minor changes are deliberate exact-pin updates with lockfile, license and loading/compatibility tests; a major upgrade requires revisiting this ADR and publishing its compatibility impact. Preserve `minimumReleaseAge: 1440`; do not bypass it for the implementation install.

## Consequences

Users install a working renderer toolchain without installing/configuring Vite. Browser consumers do not import Vite, but installing the single package still pays its production dependency cost; an export boundary is not an installation-size boundary. The clean macOS arm64 probe occupies **18,792 KiB (~18.4 MiB)** for the platform-resolved dependency store, excluding pnpm's shared store, browser binaries, user plugins, and optional preprocessors. Vite's own npm unpacked size is **2,244,268 bytes (~2.14 MiB)**. Other platforms and package-manager deduplication change the incremental cost; a different user Vite can increase duplication.

The future implementation must rerun the production license check on its actual lockfile/platform closure and qualify user-plugin interoperability, linked-package React deduplication, and config root/base behavior. A maintained older major is a deliberate licensing/compatibility tradeoff, not a claim that all Vite 8 projects work unchanged. Inform the user through the team-channel draft accompanying TASK-153, including Vite 7 and the plugin compatibility requirement.

## Alternatives

- Custom bundler: already rejected by the user as duplicating mature bundler/configuration/HMR functionality.
- Mandatory user-managed Vite or optional peer: conflicts with the user's no-setup decision and makes the ordinary CLI path installation-dependent.
- Dynamically choose the project's major: makes the protocol's server behavior vary by project and transfers compatibility obligations to every caller.
- Vite 8.3.5: mandatory MPL-2.0 dependency fails the current allowlist; a license exception is not part of TASK-153.
