import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('keeps Node and loading-session imports forbidden in core browser sources', () => {
  const directory = mkdtempSync(
    new URL('../src/core/runtime/boundary-fixture-', import.meta.url).pathname,
  );
  try {
    const file = join(directory, 'entry.ts');
    writeFileSync(
      file,
      "import 'node:fs';import '../../../render/loading/session.ts';import 'motion-kit/render/loading';",
    );
    // GitHub's auto-selected formatter omits the rule's corrective help text.
    const result = spawnSync('pnpm', ['exec', 'oxlint', '--format', 'default', file], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Node.js APIs are used only');
    expect(output).toContain('Browser core depends only');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
