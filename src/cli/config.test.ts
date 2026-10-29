import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveRendererConfig } from './config.ts';

const root = mkdtempSync(join(tmpdir(), 'motion-kit-config-'));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('renderer configuration', () => {
  it('resolves paths, flags before environment, and explicit boolean overrides', () => {
    mkdirSync(join(root, 'project'));
    writeFileSync(join(root, 'custom.ts'), '');
    expect(
      resolveRendererConfig(
        {
          projectRoot: 'project',
          viteConfig: 'custom.ts',
          softwareWebgl: true,
          disableSandbox: true,
        },
        {
          MOTION_KIT_PROJECT_ROOT: 'missing',
          MOTION_KIT_VITE_CONFIG: 'missing',
          MOTION_KIT_SOFTWARE_WEBGL: 'invalid',
          MOTION_KIT_DISABLE_SANDBOX: '0',
        },
        root,
      ),
    ).toEqual({
      ok: true,
      value: {
        projectRoot: join(root, 'project'),
        viteConfig: join(root, 'custom.ts'),
        softwareWebGL: true,
        disableSandbox: true,
      },
    });
  });
  it.each(['', '0', 'false', '1', 'true'])('parses environment boolean %s', (value) => {
    mkdirSync(root, { recursive: true });
    const result = resolveRendererConfig(
      {},
      { MOTION_KIT_SOFTWARE_WEBGL: value, MOTION_KIT_DISABLE_SANDBOX: value },
      root,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        softwareWebGL: value === '1' || value === 'true',
        disableSandbox: value === '1' || value === 'true',
      },
    });
  });
  it.each(['MOTION_KIT_SOFTWARE_WEBGL', 'MOTION_KIT_DISABLE_SANDBOX'])(
    'names invalid %s',
    (name) => {
      mkdirSync(root, { recursive: true });
      const result = resolveRendererConfig({}, { [name]: 'yes' }, root);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected invalid configuration');
      expect(result.error.code).toBe('cli.invalid-arguments');
      expect(result.error.hint).toContain(name);
    },
  );
  it('rejects missing paths and wrong kinds with actionable hints', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'file'), '');
    for (const [flags, name] of [
      [{ projectRoot: 'file' }, '--project-root'],
      [{ viteConfig: '.' }, '--vite-config'],
      [{ projectRoot: '' }, '--project-root'],
    ] as const) {
      const result = resolveRendererConfig(flags, {}, root);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Expected invalid configuration');
      expect(result.error.code).toBe('cli.invalid-arguments');
      expect(result.error.hint).toContain(name);
    }
    const result = resolveRendererConfig({}, { MOTION_KIT_PROJECT_ROOT: 'missing' }, root);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected invalid configuration');
    expect(result.error.hint).toContain('MOTION_KIT_PROJECT_ROOT');
  });
  it('uses defaults and environment paths when flags are absent', () => {
    mkdirSync(join(root, 'project'), { recursive: true });
    writeFileSync(join(root, 'config.ts'), '');
    expect(resolveRendererConfig({}, {}, root)).toEqual({
      ok: true,
      value: { projectRoot: root, softwareWebGL: false, disableSandbox: false },
    });
    expect(
      resolveRendererConfig(
        {},
        { MOTION_KIT_PROJECT_ROOT: 'project', MOTION_KIT_VITE_CONFIG: 'config.ts' },
        root,
      ),
    ).toMatchObject({
      ok: true,
      value: { projectRoot: join(root, 'project'), viteConfig: join(root, 'config.ts') },
    });
  });
});
