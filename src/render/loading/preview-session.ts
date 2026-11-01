import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { loadingFailure } from './diagnostics.ts';
import { startLoadingService, type LoadingService } from './service.ts';
import { type LoadingOutcome } from './session.ts';

export type PreviewSessionOptions = {
  projectRoot: string;
  entry: string;
  /** Explicit Vite config file; omit to discover it under projectRoot. */
  viteConfig?: string;
  /** Loopback port; an ephemeral one when omitted. */
  port?: number;
  loadingTimeoutMs?: number;
  signal?: AbortSignal;
};
/** A loading service that serves the preview host to the user's own browser. */
export type PreviewSession = {
  /** The preview host page; selection travels in its query. */
  url: string;
  servicePid: number;
  /** Settles with the failure that ended the service after readiness, e.g. a Vite config change. */
  failed: Promise<Diagnostic>;
  dispose: () => Promise<Result<undefined>>;
};

const timeoutDiagnostic: Diagnostic = {
  code: 'render.page-error',
  severity: 'error',
  message: 'Loading startup timed out.',
  hint: 'Increase loadingTimeoutMs or fix blocked startup.',
};

/** Start the loading child in preview mode. No browser: the user opens the URL. */
export const openPreviewSession = async (
  options: PreviewSessionOptions,
): Promise<LoadingOutcome<PreviewSession>> => {
  if (options.signal?.aborted === true) return { ok: false, aborted: true };
  const timeoutMs = options.loadingTimeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return { ok: false, error: loadingFailure('timeout option') };
  let workspace: string;
  try {
    workspace = await mkdtemp(join(tmpdir(), 'motion-kit-preview-'));
  } catch {
    return { ok: false, error: loadingFailure('workspace creation') };
  }
  const failure = Promise.withResolvers<Diagnostic>();
  let service: LoadingService | undefined;
  let disposal: Promise<Result<undefined>> | undefined;
  const dispose = (): Promise<Result<undefined>> => {
    disposal ??= (async () => {
      options.signal?.removeEventListener('abort', onAbort);
      const cleanup = await Promise.allSettled([
        service?.terminate(),
        rm(workspace, { recursive: true, force: true }),
      ]);
      return cleanup.some((item) => item.status === 'rejected')
        ? { ok: false, error: loadingFailure('resource disposal') }
        : { ok: true, value: undefined };
    })();
    return disposal;
  };
  const aborted = Promise.withResolvers<'aborted'>();
  const onAbort = () => aborted.resolve('aborted');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let fallen: Diagnostic | undefined;
  try {
    service = startLoadingService(
      {
        projectRoot: options.projectRoot,
        entry: options.entry,
        ...(options.viteConfig === undefined ? {} : { viteConfig: options.viteConfig }),
        workspace,
        mode: 'preview',
        ...(options.port === undefined ? {} : { port: options.port }),
      },
      (diagnostic) => {
        fallen ??= diagnostic;
        failure.resolve(diagnostic);
      },
    );
  } catch {
    // `fork` throws synchronously when the child cannot be spawned at all.
    await dispose();
    return { ok: false, error: loadingFailure('service startup') };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = await Promise.race([
    service.ready.then(
      (url) => ({ url }),
      () => 'failed' as const,
    ),
    aborted.promise,
    new Promise<'timeout'>((done) => {
      timer = setTimeout(() => done('timeout'), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (typeof started === 'string') {
    await dispose();
    if (started === 'aborted') return { ok: false, aborted: true };
    return {
      ok: false,
      error: started === 'timeout' ? timeoutDiagnostic : (fallen ?? loadingFailure('startup')),
    };
  }
  const pid = service.pid;
  if (pid === undefined) {
    await dispose();
    return { ok: false, error: loadingFailure('service startup') };
  }
  return {
    ok: true,
    value: {
      url: new URL('preview/', started.url).href,
      servicePid: pid,
      failed: failure.promise,
      dispose,
    },
  };
};
