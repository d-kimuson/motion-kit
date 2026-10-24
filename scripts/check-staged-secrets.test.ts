import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';

const script = fileURLToPath(new URL('./check-staged-secrets.sh', import.meta.url));

const scannerPath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'staged-secrets-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

const scan = (path: string) =>
  spawnSync('/bin/sh', [script], {
    env: { PATH: path },
    encoding: 'utf8',
    timeout: 10_000,
  });

describe('pre-commit secret scan', () => {
  it('wires the checked script into lefthook', () => {
    const hook = readFileSync(new URL('../lefthook.yml', import.meta.url), 'utf8');
    expect(hook).toMatch(/gitleaks:\s+run: sh scripts\/check-staged-secrets\.sh\s*$/);
  });

  it.each([
    ['clean staging area', 0],
    ['detected secret', 1],
    ['scanner error', 2],
  ] as const)('preserves the scanner exit status for a %s', (_scenario, status) => {
    const path = scannerPath();
    writeFileSync(
      join(path, 'gitleaks'),
      `#!/bin/sh\nprintf '%s\\n' "$@"\nexit ${String(status)}\n`,
      { mode: 0o755 },
    );
    const result = scan(path);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    expect(result.stdout.split('\n')).toEqual(['protect', '--staged', '--verbose', '--redact', '']);
    expect(result.stderr).toBe('');
  });

  it('warns with both install paths and succeeds when the scanner is missing', () => {
    const result = scan(scannerPath());
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Warning: gitleaks not found; skipping local secret scan. Run nix develop or brew install gitleaks.\n',
    );
  });
});
