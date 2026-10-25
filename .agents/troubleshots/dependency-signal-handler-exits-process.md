# A dependency's SIGINT handler exits the process before your cleanup finishes

## Symptom

`motion-kit render --out out.mp4` interrupted with `SIGINT` mid-render exits `130` but prints no
`render aborted` line and leaves the encoder's hidden `.part` sibling in the output directory.
`SIGTERM` at the same point is correct (exit `143`, line printed, no sibling). `NODE_OPTIONS=--trace-exit`
shows the process leaving through `playwright-core/lib/bootstrap.js` → `processExit(130)`. A test that
sends `SIGINT` to the CLI and asserts the cleanup usually passes, because the race is a race.

Also worth knowing before trying to fix it with listener bookkeeping: `process.removeAllListeners('SIGINT')`
inside a `SIGINT` handler does **not** stop the other listeners registered for that same signal. Node's
`EventEmitter.emit` snapshots the listener array, so every handler registered at dispatch time runs:

```sh
node -e "process.on('SIGINT',()=>{console.log('a');process.removeAllListeners('SIGINT')});process.on('SIGINT',()=>{console.log('b');process.exit(7)});setInterval(()=>{},1e3)" &
# prints a AND b
```

Note also that a background job of a non-interactive shell inherits `SIGINT` ignored, so such a repro
never fires the handler at all; spawn the CLI as a direct child from Node instead.

## Workaround

1. Turn the launcher's own signal handling off where the browser is launched:
   `chromium.launchServer({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false })`.
   Playwright's `addProcessHandlerIfNeeded` then never installs `sigintHandler`, while its unconditional
   `exit` handler still kills the processes it tracks.
2. Do not rely on that alone: register the observable part of a cancelled run as a synchronous guard on
   `process.on('exit')` (`coverOnExit` in `src/lib/exit.ts`) — kill the encoder with `SIGKILL`, remove its
   temporary sibling, kill the loading service's process group and write the aborted line. `process.exit`
   runs `exit` listeners synchronously, so this holds whichever listener ended the process.
3. Pin it with a child-process test: a preload registers a second `SIGINT` listener after the CLI's
   (via `process.on('newListener')` + `nextTick`) that writes a marker and calls `process.exit(130)`.

## Why Not Fixed

Fixed at the root for Playwright (step 1), but the generic case cannot be: any dependency may install a
`SIGINT` listener that exits, and listener removal cannot cancel a handler that is already dispatching.
Node offers no "run my async cleanup before the process exits" hook, so the exit guard (step 2) is the
only deterministic place for it.
