import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** Opt-in destructive negative controls for TASK-158. Run alone; sources are restored. */
const unit = 'src/core/assets/registry.test.ts';
const mutants = [
  {
    name: 'register-after-suspend',
    file: 'src/core/assets/use-asset.ts',
    before: 'registry.retain(descriptor, owner, context)',
    after:
      "({ key: descriptor.id, status: 'pending' as const, promise: new Promise<void>(() => {}), value: undefined, attempt: 0 })",
    test: 'registers before the suspense read is observable',
  },
  {
    name: 'snapshot-promise-all',
    file: 'src/core/assets/registry.ts',
    before: 'drainUntilStable(request)',
    after:
      '(async () => { await Promise.all([...entries.values()].map((entry) => entry.done)); return { ok: true as const, value: undefined }; })()',
    test: 'drains registrations discovered after the first pending set settles',
  },
  {
    name: 'cache-key-includes-caller',
    file: 'src/core/assets/registry.ts',
    before: 'const key = assetCacheKey(descriptor);',
    after: 'const key = `${descriptor.kind}:${descriptor.id}:${owner}`;',
    test: 'shares a load for the same source and distinguishes weight and source',
  },
  {
    name: 'retry-does-not-start',
    file: 'src/core/assets/registry.ts',
    before: 'beginRetryAttempt(entry);',
    after: 'return;',
    test: 'retries a failed load as a new attempt',
  },
  {
    name: 'accept-stale-acknowledgement',
    file: 'src/core/assets/registry.ts',
    before: 'if (entry.attempt !== attempt || entry.controller?.signal.aborted === true) return;',
    after: 'if (false) return;',
    test: 'suppresses a stale load acknowledgement',
  },
  {
    name: 'skip-source-redaction',
    file: 'src/core/assets/diagnostics.ts',
    before: 'const source = redactAssetSource(asset.source);',
    after: 'const source = asset.source;',
    test: 'redacts credentials signed queries and loader exception text',
  },
  {
    name: 'copy-loader-exception',
    file: 'src/core/assets/diagnostics.ts',
    before: 'const message = loadFailedMessage(kind);',
    after:
      'const message = input.cause instanceof Error ? input.cause.message : loadFailedMessage(kind);',
    test: 'redacts credentials signed queries and loader exception text',
  },
  {
    name: 'timeout-lists-one-asset',
    file: 'src/core/assets/registry.ts',
    before: 'const assets = pendingRegistrations();',
    after: 'const assets = pendingRegistrations().slice(0, 1);',
    test: 'lists every pending registration and timeoutMs',
  },
  {
    name: 'map-load-failure-to-timeout',
    file: 'src/core/assets/diagnostics.ts',
    before: "code: 'asset.load-failed',",
    after: "code: 'asset.not-ready',",
    test: 'maps font and image load failures to asset.load-failed',
  },
];

for (const mutant of mutants) {
  const original = readFileSync(mutant.file, 'utf8');
  if (original.split(mutant.before).length !== 2)
    throw new Error(`Mutation anchor changed: ${mutant.name}`);
  try {
    writeFileSync(mutant.file, original.replace(mutant.before, mutant.after));
    const result = spawnSync(
      'pnpm',
      ['vitest', 'run', '--project', 'unit', unit, '-t', mutant.test, '--reporter=verbose'],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const output = result.stdout + result.stderr;
    if (
      result.status !== 1 ||
      !output.includes('AssertionError') ||
      !output.includes(mutant.test)
    ) {
      process.stderr.write(output);
      throw new Error(`Survivor or invalid mutation run: ${mutant.name} (exit ${result.status})`);
    }
    process.stdout.write(`KILLED ${mutant.name}: ${mutant.test}\n`);
  } finally {
    writeFileSync(mutant.file, original);
  }
}
