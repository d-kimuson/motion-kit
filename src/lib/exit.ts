// Synchronous last-resort cleanup for work the process exits under.
//
// A cancelled run cleans up after itself: it kills the children it started, removes the
// temporary files they wrote and reports one line. That cleanup is asynchronous, and another
// library in the same process can end the process from inside its own signal handler —
// `playwright-core`'s `addProcessHandlerIfNeeded` adds a `SIGINT` listener on browser launch
// whose handler exits `130` in the same signal dispatch as the caller's handler, before any
// pending promise resolves. `process.on('exit')` is the only hook that still runs there, so the
// work a run promises to be observable is registered here as well and performed synchronously
// on the way out. Nothing here may allocate work: a cover runs once, synchronously, and cannot
// await.

type ExitCover = () => void;

const covers = new Set<ExitCover>();

const runCovers = (): void => {
  const pending = Array.from(covers);
  covers.clear();
  for (const cover of pending) {
    try {
      cover();
    } catch {
      // An exiting process has nowhere to report; the remaining covers still have to run.
    }
  }
};

process.on('exit', runCovers);

/**
 * Registers `cover` to run if the process exits before the returned release does. Covers run in
 * registration order, and one that throws does not stop the others.
 */
export const coverOnExit = (cover: ExitCover): (() => void) => {
  covers.add(cover);
  return () => {
    covers.delete(cover);
  };
};

/**
 * Performs every pending cover now and ends the process with `code`. A signal the process handles
 * can still leave through `process.exit` and reuse the `exit` listener, but a signal it does not
 * handle — the second one, once the caller has already asked to stop — is a fatal termination
 * that runs no listener at all, so the caller that decides to leave has to run the covers itself
 * before the signal takes the process away.
 */
export const exitThroughCovers = (code: number): never => {
  runCovers();
  process.exit(code);
};
