import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** Opt-in destructive negative controls. Run alone in a clean, disposable worktree;
 * every source is restored in finally. A survivor or a test infrastructure error fails.
 */
const host = 'src/render/capture/frame.ts';
const hostTests = 'src/render/capture/frame.test.ts';
const browserTests = 'src/render/renderer.test.ts';
const mutants = [
  {
    name: 'capture-before-barrier',
    file: host,
    before: 'let settled = await driver.settle(frame, requestId);',
    after:
      'await driver.capture(receipt.descriptor.width, receipt.descriptor.height); let settled = await driver.settle(frame, requestId);',
    test: 'awaits readiness and validates both sides of dimensioned capture',
    suite: hostTests,
  },
  {
    name: 'skip-pre-capture-validation',
    file: host,
    before: 'const validation = await driver.validate(lease);',
    after: "const validation = { status: 'valid' as const };",
    test: 'awaits readiness and validates both sides of dimensioned capture',
    suite: hostTests,
  },
  {
    name: 'start-frame-budget-in-queue',
    file: host,
    before: 'timer = setTimeout(cancel, options.queueTimeoutMs);',
    after: 'timer = setTimeout(cancel, options.frameTimeoutMs);',
    test: 'does not charge queue residence to the frame budget',
    suite: hostTests,
  },
  {
    name: 'ignore-generation',
    file: host,
    before: 'lease.generation !== ownership.generation ||',
    after: '',
    test: 'suppresses a stale generation before screenshot',
    suite: hostTests,
  },
  {
    name: 'wrong-capture-crop',
    file: 'src/render/capture/transport.ts',
    before: 'clip: { x: 0, y: 0, width, height },',
    after: 'clip: { x: 0, y: 0, width: width - 1, height },',
    test: 'captures exact DOM CSS SVG Canvas pixels at the composition crop',
    suite: browserTests,
  },
  {
    name: 'ignore-caller-cancellation',
    file: host,
    before: 'const cancel = () => finish(aborted);',
    after: 'const cancel = () => {};',
    test: 'suppresses a canceled generation even when screenshot finishes late',
    suite: hostTests,
  },
  {
    name: 'publish-without-completion',
    file: host,
    before: 'const completion = await driver.complete(lease);',
    after: "const completion = { status: 'accepted' as const };",
    test: 'discards changed-version pixels then publishes only accepted replacement bytes',
    suite: hostTests,
  },
  {
    name: 'constant-frame-negative-control',
    file: 'src/core/runtime/fixtures/capture.tsx',
    before: 'const frame = useFrame();',
    after: 'const frame = 0;',
    test: 'matches sequential single random reverse repeated fresh-realm and held-session bytes with nonconstant frames',
    suite: browserTests,
  },
];
mutants.push({
  name: 'history-dependent-output',
  file: 'src/core/runtime/fixtures/capture.tsx',
  before: 'const frame = useFrame();',
  after:
    "const frame = useFrame() + Number(document.body.dataset['visits'] ?? 0); document.body.dataset['visits'] = String(frame + 1);",
  test: 'matches sequential single random reverse repeated fresh-realm and held-session bytes with nonconstant frames',
  suite: browserTests,
});
for (const mutant of mutants) {
  const original = readFileSync(mutant.file, 'utf8');
  if (original.split(mutant.before).length !== 2)
    throw new Error(`Mutation anchor changed: ${mutant.name}`);
  try {
    writeFileSync(mutant.file, original.replace(mutant.before, mutant.after));
    const result = spawnSync(
      'pnpm',
      ['vitest', 'run', mutant.suite, '-t', mutant.test, '--reporter=verbose'],
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
