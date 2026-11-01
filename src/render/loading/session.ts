import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';

import { type Diagnostic } from '../../lib/diagnostic.ts';
import { ownershipSchema, type Ownership } from '../../lib/frame-protocol.ts';
import {
  descriptorSchema,
  loadingProtocolVersion,
  mountReceiptSchema,
  resultSchema,
  type LoadingDescriptor,
  type MountReceipt,
} from '../../lib/loading-protocol.ts';
import { type Result } from '../../lib/result.ts';
import { launchBrowser, type BrowserOptions, type OwnedBrowser } from '../browser/launch.ts';
import { loadingFailure } from './diagnostics.ts';
import { startLoadingService, type LoadingService } from './service.ts';

export type LoadingSessionOptions = BrowserOptions & {
  projectRoot: string;
  entry: string;
  /** Explicit Vite config file; omit to discover it under projectRoot. */
  viteConfig?: string;
  loadingTimeoutMs?: number;
  signal?: AbortSignal;
  frameTimeoutMs?: number;
  queueTimeoutMs?: number;
  /** Internal transport callback, installed before any realm navigation. */
  acquire?: (ownership: Ownership) => boolean;
};
/** Caller cancellation is control flow, never a Diagnostic. */
export type LoadingOutcome<T> = Result<T> | { ok: false; aborted: true };
export type Selection = {
  compositionId?: string;
  props?: Record<string, z.infer<ReturnType<typeof z.json>>>;
};
export type LoadingSession = {
  compositions: readonly LoadingDescriptor[];
  servicePid: number;
  browserPid: number;
  workspace: string;
  url: string;
  select: (selection: Selection) => Promise<LoadingOutcome<MountReceipt>>;
  dispose: () => Promise<Result<undefined>>;
  browserConnected: () => boolean;
  /** Internal supervisor access; not exported from the public Renderer. */
  page: () => Page;
};
class LoadingAborted extends Error {}
class LoadingError extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}
const timeoutDiagnostic = (operation: string): Diagnostic => ({
  code: 'render.page-error',
  severity: 'error',
  message: `Loading ${operation} timed out.`,
  hint: `Increase loadingTimeoutMs or fix blocked ${operation}; no late result will be mounted.`,
});

/** One owned renderer service/browser, with replaceable contexts. No frame API. */
export const openLoadingSession = async (
  options: LoadingSessionOptions,
): Promise<LoadingOutcome<LoadingSession>> => {
  if (options.signal?.aborted === true) return { ok: false, aborted: true };
  const timeoutMs = options.loadingTimeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return { ok: false, error: loadingFailure('timeout option') };
  let workspace: string | undefined;
  let creatingWorkspace: Promise<string> | undefined;
  let service: LoadingService | undefined;
  let owned: OwnedBrowser | undefined;
  let launching: ReturnType<typeof launchBrowser> | undefined;
  let published = false;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let disposed = false;
  let disposal: Promise<Result<undefined>> | undefined;
  let terminal: Diagnostic | undefined;
  let selecting = false;
  let aborted = false;
  const failure = Promise.withResolvers<never>();
  // The rejection is also consumed when it arrives between operations.
  void failure.promise.catch(() => {});
  const fail = (diagnostic: Diagnostic) => {
    terminal ??= diagnostic;
    failure.reject(new LoadingError(diagnostic));
    if (published) void dispose();
  };
  const deadline = async <T>(operation: string, work: () => Promise<T>): Promise<T> => {
    if (aborted) throw new LoadingAborted();
    if (terminal !== undefined) throw new LoadingError(terminal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        failure.promise,
        work(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new LoadingError(timeoutDiagnostic(operation))),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  // Internal failure cleanup must preserve its Diagnostic; only the public
  // disposal entry point is caller cancellation.
  const dispose = (): Promise<Result<undefined>> => {
    disposal ??= (async () => {
      disposed = true;
      options.signal?.removeEventListener('abort', onAbort);
      let result: Result<undefined> = { ok: true, value: undefined };
      if (page !== undefined && !page.isClosed()) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const value: unknown = await Promise.race([
            page.evaluate(() => window.__motionKit?.dispose()),
            new Promise<never>((_r, reject) => {
              timer = setTimeout(() => reject(new Error('dispose deadline')), 500);
            }),
          ]);
          result = resultSchema(z.undefined()).parse(value);
        } catch {
          result = { ok: false, error: loadingFailure('realm disposal') };
        } finally {
          clearTimeout(timer);
        }
      }
      // Kill the owned browser even when its page main thread cannot answer.
      const cleanup = await Promise.allSettled([
        (async () => {
          const launched = await launching;
          const browser = owned ?? (launched?.ok === true ? launched.value : undefined);
          await browser?.server.kill();
        })(),
        service?.terminate(),
      ]);
      try {
        const directory = workspace ?? (await creatingWorkspace);
        if (directory !== undefined) await rm(directory, { recursive: true, force: true });
      } catch {
        result = { ok: false, error: loadingFailure('temporary directory disposal') };
      }
      if (cleanup.some((item) => item.status === 'rejected'))
        result = { ok: false, error: loadingFailure('resource disposal') };
      return result;
    })();
    return disposal;
  };
  const onAbort = () => {
    aborted = true;
    failure.reject(new LoadingAborted());
    if (published) void dispose();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const loadRealm = async (url: string) => {
    if (owned === undefined) throw new Error('Browser ownership missing');
    context = await owned.browser.newContext({
      viewport: { width: 1, height: 1 },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    page.on('console', (message) => process.stderr.write(`${message.text()}\n`));
    page.on('pageerror', () => fail(loadingFailure('page bootstrap')));
    const handshake = Promise.withResolvers<void>();
    await page.exposeFunction('__motionKitLoadingEvent', (event: unknown) => {
      const value = z
        .object({ protocolVersion: z.literal(loadingProtocolVersion) })
        .safeParse(event);
      if (!value.success) fail(loadingFailure('protocol handshake'));
      else handshake.resolve();
    });
    await page.exposeFunction('__motionKitOwnership', (event: unknown) => {
      const checked = ownershipSchema.safeParse(event);
      return !disposed && !aborted && terminal === undefined && checked.success
        ? (options.acquire?.(checked.data) ?? false)
        : false;
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });
    await handshake.promise;
    const value: unknown = await page.evaluate(() => window.__motionKit?.listCompositions());
    const result = resultSchema(z.array(descriptorSchema)).parse(value);
    if (!result.ok) throw new LoadingError(result.error);
    return result.value;
  };
  try {
    const started = process.hrtime.bigint();
    const initial = await deadline('startup', async () => {
      creatingWorkspace = mkdtemp(join(tmpdir(), 'motion-kit-loading-'));
      workspace = await creatingWorkspace;
      if (disposed) {
        await rm(workspace, { recursive: true, force: true });
        throw new Error('Disposed');
      }
      service = startLoadingService(
        {
          projectRoot: options.projectRoot,
          entry: options.entry,
          ...(options.viteConfig === undefined ? {} : { viteConfig: options.viteConfig }),
          workspace,
        },
        fail,
      );
      const url = await service.ready;
      if (disposed) throw new Error('Disposed');
      launching = launchBrowser(
        options,
        Math.max(1, timeoutMs - Number(process.hrtime.bigint() - started) / 1e6),
      );
      const launched = await launching;
      if (!launched.ok) throw new LoadingError(launched.error);
      owned = launched.value;
      if (disposed) {
        await owned.server.kill();
        throw new Error('Disposed');
      }
      const compositions = await loadRealm(url);
      return { url, compositions };
    });
    const revision = randomUUID();
    const pid = service?.pid;
    if (pid === undefined || workspace === undefined) throw new Error('Service ownership missing');
    const browserPid = owned?.server.process().pid;
    if (browserPid === undefined) throw new Error('Browser process ownership missing');
    published = true;
    return {
      ok: true,
      value: {
        ...initial,
        browserPid,
        servicePid: pid,
        workspace,
        browserConnected: () => owned?.browser.isConnected() ?? false,
        page: () => {
          if (page === undefined || disposed || terminal !== undefined || aborted)
            throw new Error('Realm unavailable');
          return page;
        },
        dispose: () => {
          onAbort();
          return dispose();
        },
        select: async (selection) => {
          if (aborted) return { ok: false, aborted: true };
          if (disposed || selecting || terminal !== undefined)
            return { ok: false, error: terminal ?? loadingFailure('selection state') };
          selecting = true;
          try {
            await deadline('realm replacement', async () => {
              const value: unknown = await page?.evaluate(() => window.__motionKit?.dispose());
              const result = resultSchema(z.undefined()).parse(value);
              if (!result.ok) throw new LoadingError(result.error);
              await context?.close();
              return loadRealm(initial.url);
            });
            const instance = randomUUID();
            const receipt = await deadline('props parse and mount', async () => {
              const value: unknown = await page?.evaluate(
                (request: unknown) => window.__motionKit?.mount(request),
                {
                  ...selection,
                  props: selection.props ?? {},
                  revision,
                  instance,
                  loadingTimeoutMs: timeoutMs,
                  frameTimeoutMs: options.frameTimeoutMs ?? 30_000,
                  queueTimeoutMs: options.queueTimeoutMs ?? 30_000,
                } as unknown,
              );
              const result = resultSchema(mountReceiptSchema).parse(value);
              if (!result.ok) return result;
              await page?.setViewportSize({
                width: result.value.descriptor.width,
                height: result.value.descriptor.height,
              });
              return result;
            });
            return receipt;
          } catch (error) {
            const diagnostic =
              error instanceof LoadingError ? error.diagnostic : loadingFailure('selection');
            await dispose();
            return error instanceof LoadingAborted
              ? { ok: false, aborted: true }
              : { ok: false, error: diagnostic };
          } finally {
            selecting = false;
          }
        },
      },
    };
  } catch (error) {
    const diagnostic = error instanceof LoadingError ? error.diagnostic : loadingFailure('startup');
    await dispose();
    return error instanceof LoadingAborted
      ? { ok: false, aborted: true }
      : { ok: false, error: diagnostic };
  }
};
