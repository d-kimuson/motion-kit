# Vite file watcher misses a write made right after a session opens

## Symptom

A test that opens a loading or preview session, writes a source file immediately, and waits for the module-change event times out. The same test passes when a pause precedes the write, so it is flaky rather than failing:

```
Error: Test timed out in 5000ms.
```

## Workaround

Rewrite the file until the awaited result settles instead of writing once. `writeUntil` in `src/render/loading/preview-session.test.ts` does this: it repeats the write every 500 ms until the awaited promise resolves.

## Why Not Fixed

`server.watcher.add(paths)` in `src/render/loading/server.ts` returns before the underlying watcher has scanned the paths, and Vite exposes no ready signal for added paths. A write that lands in that window is never reported. Fixing it needs a ready signal from Vite or chokidar for added paths; until then, tests rewrite. Production use is unaffected because a human edits long after the session opened.
