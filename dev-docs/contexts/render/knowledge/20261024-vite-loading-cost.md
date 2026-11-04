# Vite dependency and empty-server cost probe

TASK-153 evidence, 2026-10-24 (JST). No production loader, repository dependency, or lockfile is changed by this probe. The [bundler ADR](../adr/20261024-bundled-vite.accepted.md) makes the decision; these observations do not certify user-project loading.

## Dependency checks

Queried npm metadata with `pnpm view vite@7.3.7 engines license dist.unpackedSize --json` and the version's publication time in `pnpm view vite time --json`:

- Vite 7.3.7: MIT; published **2026-10-06T05:11:19.017Z**, older than 1440 minutes; Node `^20.19.0 || >=22.12.0`; own unpacked size **2,244,268 bytes**.
- Vite 8.3.5: MIT itself, but its required `lightningcss@1.33.0` is **MPL-2.0**. A separate clean production installation failed the repository license script with `lightningcss@1.33.0: MPL-2.0`. It is not chosen; no exception is added.

For Vite 7 use a fresh directory outside the checkout with this package manifest and pnpm policy, not the directory previously used for Vite 8 (which may retain optional peers):

```json
{ "private": true, "type": "module", "dependencies": { "vite": "7.3.7" } }
```

```yaml
saveExact: true
minimumReleaseAge: 1440
allowBuilds: {}
```

Run `pnpm install --ignore-scripts`, then `pnpm licenses list --prod --json` and `node <checkout>/scripts/check-licenses.ts` from that directory. The clean Vite 7 installation passed without license exceptions. pnpm 12.9.0 was used in this isolated scratch directory (no repository `packageManager` field); repository checks use its pinned pnpm 12.15.0. No dependency lifecycle scripts were needed for empty-server startup on this platform.

Resolved platform closure, including optional native packages checked from their installed manifests:

| License      | Packages and exact observed versions                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MIT          | vite 7.3.7; esbuild and @esbuild/darwin-arm64 0.28.2; rollup and @rollup/rollup-darwin-arm64 4.65.0; @types/estree 1.0.9; fdir 6.5.0; fsevents 2.3.3; nanoid 3.3.20; picomatch 4.0.7; postcss 8.5.31; tinyglobby 0.2.17 |
| ISC          | picocolors 1.1.1                                                                                                                                                                                                        |
| BSD-3-Clause | source-map-js 1.2.2                                                                                                                                                                                                     |

`du -sk node_modules/.pnpm` reported **18,792 KiB** (~18.4 MiB) on macOS arm64. This is local allocated dependency-store size, not compressed download size or a portable incremental-install promise. It excludes the shared pnpm content store, Chromium, project plugins, and optional preprocessors; deduplication/platform/filesystem allocation change it. The implementation must install with the repository's pnpm, generate its real lockfile, and rerun its production/license/native-platform checks.

## Startup observation

Environment: macOS arm64, Node **26.12.0**, Vite **7.3.7**. Save this scratch-only measurement as `measure.mjs` in the clean directory:

```js
import { performance } from 'node:perf_hooks';
const start = performance.now();
const { createServer } = await import('vite');
const imported = performance.now();
const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'silent',
});
const ready = performance.now();
await server.close();
console.log({
  importMs: imported - start,
  createServerMs: ready - imported,
  totalMs: ready - start,
});
```

Execute five fresh processes, with scratch commands bounded and direnv disabled:

```sh
DIRENV_DISABLE=1 timeout 300 sh -c 'for i in 1 2 3 4 5; do node measure.mjs; done'
```

| Process | Dynamic import (ms) | createServer (ms) | Total (ms) |
| ------- | ------------------- | ----------------- | ---------- |
| 1       | 530.802             | 18.752            | 549.554    |
| 2       | 121.683             | 21.492            | 143.175    |
| 3       | 62.195              | 16.552            | 78.747     |
| 4       | 76.060              | 15.466            | 91.526     |
| 5       | 68.208              | 43.858            | 112.067    |

These are process-cold, filesystem-cache-uncontrolled samples after installation. Node executable startup, supervisory process/IPC, user config/plugins, dependency optimization, HTTP listening/requests, TSX graph transformation, browser launch, assets and capture are **not measured**. There is no distribution/SLA inference from five samples. The Design Doc's **0.5–3 s small-project first-load budget is an estimate**, not this table's result. TASK-157 must measure representative projects and cold/warm caches separately. The observations justify amortizing setup, not a promise that arbitrary Vite projects start under a second.
