import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from 'vitest';

const script = fileURLToPath(new URL('./check-staged-secrets.sh', import.meta.url));

const fixture = () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'staged-secrets-')));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'bin');
  const repository = join(directory, 'repository');
  const nested = join(repository, 'nested');
  mkdirSync(path);
  mkdirSync(nested, { recursive: true });
  const git = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  expect(git.status).toBe(0);
  symlinkSync(git.stdout.trim(), join(path, 'git'));
  const init = spawnSync('git', ['init', repository], { encoding: 'utf8' });
  expect(init.status).toBe(0);
  return { directory, path, repository, nested };
};

const scan = (path: string, cwd: string) =>
  spawnSync('/bin/sh', [script], {
    cwd,
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
    const { path, repository } = fixture();
    writeFileSync(
      join(path, 'gitleaks'),
      `#!/bin/sh\nprintf '%s\\n' "$@"\nexit ${String(status)}\n`,
      { mode: 0o755 },
    );
    const result = scan(path, repository);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(status);
    expect(result.stdout.split('\n')).toEqual(['protect', '--staged', '--verbose', '--redact', '']);
    expect(result.stderr).toBe('');
  });

  it('runs the scanner at the repository root from a nested directory', () => {
    const { path, repository, nested } = fixture();
    writeFileSync(join(path, 'gitleaks'), '#!/bin/sh\nprintf \'%s\\n\' "$PWD"\nexit 1\n', {
      mode: 0o755,
    });
    const result = scan(path, nested);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${repository}\n`);
    expect(result.stderr).toBe('');
  });

  it.each([true, false])('rejects non-repository callers (scanner available: %s)', (available) => {
    const { path, directory } = fixture();
    if (available) {
      writeFileSync(join(path, 'gitleaks'), '#!/bin/sh\necho scanner-must-not-run\n', {
        mode: 0o755,
      });
    }
    const result = scan(path, directory);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Error: staged secret scan must run inside a Git working tree.\n');
  });

  it.each([
    ['missing execute permission', '#!/bin/sh\nexit 0\n', 0o644, [126]],
    ['broken interpreter', '#!/nonexistent/gitleaks-interpreter\n', 0o755, [126, 127]],
  ] as const)('fails for a scanner with %s', (_scenario, content, mode, statuses) => {
    const { path, nested } = fixture();
    const scanner = join(path, 'gitleaks');
    writeFileSync(scanner, content, { mode });
    const result = scan(path, nested);
    expect(result.error).toBeUndefined();
    expect(statuses).toContain(result.status);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      `Error: gitleaks scanner is present but unrunnable: ${scanner}\n`,
    );
    expect(result.stderr).not.toContain('gitleaks not found');
  });

  it('warns with both install paths and succeeds when the scanner is missing', () => {
    const { path, nested } = fixture();
    const result = scan(path, nested);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Warning: gitleaks not found; skipping local secret scan. Run nix develop or brew install gitleaks.\n',
    );
  });
});
