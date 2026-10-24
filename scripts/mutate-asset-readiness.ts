import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** Opt-in destructive negative controls for TASK-158. Run alone; sources are restored. */
const unit = ['src/core/assets/registry.test.ts'];
const frame = ['src/render/capture/frame.test.ts'];
type Mutant = {
  name: string;
  file: string;
  before: string;
  after: string;
  test: string;
  project?: string;
  files?: readonly string[];
};
const mutants: Mutant[] = [
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
  {
    name: 'keep-userinfo',
    file: 'src/core/assets/diagnostics.ts',
    before: "url.username = '';\n    url.password = '';",
    after: '/* userinfo retained */',
    test: 'redacts credentials signed queries and loader exception text',
  },
  {
    name: 'image-key-ignores-source',
    file: 'src/core/assets/registry.ts',
    before: "if (descriptor.kind === 'image') return `image\\u0000${descriptor.source}`;",
    after: "if (descriptor.kind === 'image') return 'image';",
    test: 'shares a load for the same source and distinguishes weight and source',
  },
  {
    name: 'confirm-ignores-new-pending',
    file: 'src/core/assets/registry.ts',
    before:
      "revision === confirmedRevision &&\n            liveEntries().every((entry) => entry.status === 'ready')",
    after: 'revision === confirmedRevision',
    test: 'keeps the barrier waiting when a registration appears during confirmation',
  },
  {
    name: 'timeout-before-failure',
    file: 'src/core/assets/registry.ts',
    before:
      'const failed = failedEntries();\n        // A sibling still loading must land before this returns, or the first\n        // rejection publishes a partial set and the boundary cannot add it later.\n        if (failed.length > 0 && (pendingRegistrations().length === 0 || timedOut))\n          return failureResult(request, failed);\n        if (timedOut) return timeoutResult(request);',
    after:
      'if (timedOut) return timeoutResult(request);\n        const failed = failedEntries();\n        if (failed.length > 0 && (pendingRegistrations().length === 0 || timedOut))\n          return failureResult(request, failed);',
    test: 'prefers asset.load-failed when the deadline flag and a rejection are both visible',
  },
  {
    name: 'pending-includes-failed',
    file: 'src/core/assets/registry.ts',
    before:
      "const pendingRegistrations = (): PendingAsset[] =>\n    liveEntries()\n      .filter((entry) => entry.status === 'pending' || entry.status === 'idle')",
    after:
      "const pendingRegistrations = (): PendingAsset[] =>\n    liveEntries()\n      .filter((entry) => entry.status !== 'ready')",
    test: 'reports load-failed when a rejection and a still-pending registration coexist',
  },
  {
    name: 'publish-first-diagnostic',
    file: 'src/render/capture/frame.ts',
    before: 'finish({ ok: false, error: settled.diagnostics });',
    after: 'finish({ ok: false, error: [settled.diagnostics[0]] });',
    project: 'frame-transport',
    files: frame,
    test: 'publishes every asset diagnostic from a failed settlement',
  },
  {
    name: 'restore-query-parameter-names',
    file: 'src/core/assets/diagnostics.ts',
    before: "url.search = '';",
    after: '/* query parameter names retained */',
    test: 'redacts query values under unrelated parameter names',
  },
  {
    name: 'redact-marker-twice',
    file: 'src/core/assets/diagnostics.ts',
    before: 'if (alreadyRedacted(source)) return source;',
    after: '/* idempotence guard removed */',
    test: 'returns an already-redacted source unchanged',
  },
  {
    name: 'boundary-drops-registered-failures',
    file: 'src/core/runtime/composition-runtime.ts',
    before: 'mergeFailureDiagnostics(thrown, registry.failures(locationFor(request)))',
    after: 'thrown[0] === undefined ? undefined : [thrown[0]]',
    files: ['src/core/runtime/composition-runtime.test.ts'],
    test: 'publishes every failed registration when the boundary fails',
  },
];
/** Removed because it is equivalent to the attempt counter. Not a survivor. */
const equivalent = [
  {
    name: 'drop-entry-identity-stale-check',
    reason:
      'release, retry and dispose bump attempt before a replacement can settle; no path replaces the entry object without that bump',
  },
];

for (const row of equivalent) process.stdout.write(`EQUIVALENT ${row.name}: ${row.reason}\n`);

for (const mutant of mutants) {
  const original = readFileSync(mutant.file, 'utf8');
  if (original.split(mutant.before).length !== 2)
    throw new Error(`Mutation anchor changed: ${mutant.name}`);
  try {
    writeFileSync(mutant.file, original.replace(mutant.before, mutant.after));
    const result = spawnSync(
      'pnpm',
      [
        'vitest',
        'run',
        '--project',
        mutant.project ?? 'unit',
        ...(mutant.files ?? unit),
        '-t',
        mutant.test,
        '--reporter=verbose',
      ],
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
