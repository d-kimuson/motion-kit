# A `server.watcher` listener sees stale Vite modules

## Symptom

A `change` listener on Vite's `server.watcher` reacts to a source edit immediately (for example by telling the browser to reload), and the next request for that module still returns the previous transform. The page reloads and shows the old code, intermittently.

## Workaround

Do not act on the raw watcher event. Wait until Vite has processed the change before acting:

- Poll the module graph (`server.environments.client.moduleGraph.getModulesByFile(file)`) until each module's `transformResult` is `null`, with a timeout, then act.
- A plugin's `handleHotUpdate` / `hotUpdate` hook runs after invalidation, but only when HMR is on: with `server.hmr: false`, as in every motion-kit loading session, Vite skips `handleHMRUpdate` and the hooks never run.

The preview session in `src/render/loading/server.ts` waits for invalidation before sending `reload`.

## Why Not Fixed

Vite registers its own `watcher.on("change", ...)` (`node_modules/vite/dist/node/chunks/config.js`) that first awaits every plugin's `watchChange` hook and only then calls `moduleGraph.onFileChange(file)`, which invalidates the module. A listener added by the caller runs concurrently with that handler, so whether it sees the invalidated or the stale graph depends on how long the plugins' `watchChange` hooks take. Vite exposes no "invalidated" event on the watcher; the ordering is its internal behavior.
