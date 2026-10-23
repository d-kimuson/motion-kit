export type Diagnostic = {
  code: 'ASSET_LOAD_FAILED' | 'ASSET_TIMEOUT';
  asset: string;
  message: string;
};
export type ReadyResult = { ok: true } | { ok: false; diagnostics: Diagnostic[] };

// Experiment only: register before rendering, not in an effect that Suspense can prevent.
export const createRegistry = () => {
  const pending = new Set<string>();
  const failures: Diagnostic[] = [];
  const work: Promise<void>[] = [];
  const register = (asset: string, promise: Promise<void>) => {
    pending.add(asset);
    const observed = promise.then(
      () => {
        pending.delete(asset);
      },
      (error: unknown) => {
        pending.delete(asset);
        failures.push({
          code: 'ASSET_LOAD_FAILED',
          asset,
          message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      },
    );
    work.push(observed);
    return observed;
  };
  const awaitReady = async (timeoutMs = 5000): Promise<ReadyResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    try {
      const result = await Promise.race([Promise.all(work), timeout]);
      if (result === 'timeout')
        return {
          ok: false,
          diagnostics: [
            ...failures,
            ...[...pending].map((asset): Diagnostic => ({
              code: 'ASSET_TIMEOUT',
              asset,
              message: `Readiness exceeded ${timeoutMs} ms`,
            })),
          ],
        };
      return failures.length === 0 ? { ok: true } : { ok: false, diagnostics: [...failures] };
    } finally {
      clearTimeout(timer);
    }
  };
  return { register, awaitReady, pending: () => [...pending] };
};
