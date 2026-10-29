import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { type Diagnostic } from '../lib/diagnostic.ts';
import { type Result } from '../lib/result.ts';
import { type CheckArgs, type FrameArgs, type RenderArgs } from './args.ts';

type Flags = Pick<
  FrameArgs | RenderArgs | CheckArgs,
  'projectRoot' | 'viteConfig' | 'softwareWebgl' | 'disableSandbox'
>;
export type RendererConfig = {
  projectRoot: string;
  viteConfig?: string;
  softwareWebGL: boolean;
  disableSandbox: boolean;
};

const invalid = (hint: string): Result<never> => ({
  ok: false,
  error: {
    code: 'cli.invalid-arguments',
    severity: 'error',
    message: 'Renderer configuration is invalid.',
    hint,
  } satisfies Diagnostic,
});

/** Resolve invocation settings once, before opening any renderer. */
export const resolveRendererConfig = (
  flags: Flags,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): Result<RendererConfig> => {
  const rootInput = flags.projectRoot ?? env['MOTION_KIT_PROJECT_ROOT'] ?? cwd;
  const configInput = flags.viteConfig ?? env['MOTION_KIT_VITE_CONFIG'];
  const pathValid = (input: string, kind: 'directory' | 'file'): boolean => {
    if (input.length === 0) return false;
    try {
      const stat = statSync(resolve(cwd, input));
      return kind === 'directory' ? stat.isDirectory() : stat.isFile();
    } catch {
      return false;
    }
  };
  if (!pathValid(rootInput, 'directory'))
    return invalid(
      `Set --project-root or MOTION_KIT_PROJECT_ROOT to an existing directory (relative to the working directory).`,
    );
  if (configInput !== undefined && !pathValid(configInput, 'file'))
    return invalid(
      `Set --vite-config or MOTION_KIT_VITE_CONFIG to an existing file (relative to the working directory).`,
    );
  const boolean = (flag: boolean | undefined, name: string): Result<boolean> => {
    if (flag !== undefined) return { ok: true, value: flag };
    const value = env[name];
    if (value === undefined || value === '' || value === '0' || value === 'false')
      return { ok: true, value: false };
    if (value === '1' || value === 'true') return { ok: true, value: true };
    return invalid(`Set ${name} to 1, true, 0, false or an empty string.`);
  };
  const software = boolean(flags.softwareWebgl, 'MOTION_KIT_SOFTWARE_WEBGL');
  if (!software.ok) return software;
  const sandbox = boolean(flags.disableSandbox, 'MOTION_KIT_DISABLE_SANDBOX');
  if (!sandbox.ok) return sandbox;
  return {
    ok: true,
    value: {
      projectRoot: resolve(cwd, rootInput),
      ...(configInput === undefined ? {} : { viteConfig: resolve(cwd, configInput) }),
      softwareWebGL: software.value,
      disableSandbox: sandbox.value,
    },
  };
};
