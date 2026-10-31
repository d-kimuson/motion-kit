import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';

import { DiagnosticSchema, type Diagnostic } from '../../lib/diagnostic.ts';
import { coverOnExit } from '../../lib/exit.ts';
import { loadingFailure } from './diagnostics.ts';

export type LoadingServiceOptions = {
  projectRoot: string;
  entry: string;
  viteConfig?: string;
  workspace: string;
  mode?: 'render' | 'preview';
  port?: number;
};
/** The forked Vite loading child (server.ts); one per session. */
export type LoadingService = {
  pid: number | undefined;
  /** The composition shell URL once the child listens. */
  ready: Promise<string>;
  /** Ask the child to close, then kill its process group; resolves once it has exited. */
  terminate: () => Promise<void>;
};
const childMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    url: z.url(),
    configPath: z.string(),
    dependencies: z.array(z.string()),
  }),
  z.object({ type: z.literal('failure'), error: DiagnosticSchema }),
]);

const killGroup = (child: ChildProcess) => {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
};

/**
 * Fork the loading child. `fail` receives every failure the child reports or causes, including
 * an exit before `terminate`; the caller decides what a failure ends.
 */
export const startLoadingService = (
  options: LoadingServiceOptions,
  fail: (diagnostic: Diagnostic) => void,
): LoadingService => {
  let terminating = false;
  const child = fork(
    new URL('./child.js', import.meta.url),
    [
      JSON.stringify({
        projectRoot: resolve(options.projectRoot),
        entry: resolve(options.projectRoot, options.entry),
        ...(options.viteConfig === undefined ? {} : { viteConfig: resolve(options.viteConfig) }),
        workspace: options.workspace,
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.port === undefined ? {} : { port: options.port }),
      }),
    ],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] },
  );
  // The service is its own process-group leader, so it outlives an abrupt exit unless it is
  // killed on the way out; disposal is asynchronous and cannot be the only owner (lib/exit.ts).
  const releaseCover = coverOnExit(() => killGroup(child));
  child.stdout?.pipe(process.stderr, { end: false });
  child.stderr?.pipe(process.stderr, { end: false });
  const ready = Promise.withResolvers<string>();
  // A failure before readiness also reaches the caller through `fail`.
  void ready.promise.catch(() => {});
  // `fail` first: a caller racing its own failure signal against `ready` sees the Diagnostic.
  const failed = (diagnostic: Diagnostic) => {
    fail(diagnostic);
    ready.reject(new Error(diagnostic.message));
  };
  child.on('message', (message: unknown) => {
    const parsed = childMessage.safeParse(message);
    if (!parsed.success) failed(loadingFailure('service protocol'));
    else if (parsed.data.type === 'failure') failed(parsed.data.error);
    else ready.resolve(parsed.data.url);
  });
  child.on('error', () => failed(loadingFailure('service startup')));
  child.on('exit', () => {
    if (!terminating) failed(loadingFailure('service exited'));
  });
  const terminate = async () => {
    terminating = true;
    if (child.pid !== undefined) {
      const exited =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((done) => child.once('close', () => done()));
      if (child.connected) {
        child.send('dispose');
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          exited,
          new Promise<void>((done) => {
            timer = setTimeout(done, 250);
          }),
        ]);
        clearTimeout(timer);
      }
      killGroup(child);
      await exited;
    }
    // The service is gone, so the exit guard has nothing left to do.
    releaseCover();
  };
  return { pid: child.pid, ready: ready.promise, terminate };
};
