import { fork } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';

const require = createRequire(import.meta.url);
it('boots the supervised source package from node_modules rather than relying on native automatic TS stripping', async () => {
  const root = mkdtempSync(join(tmpdir(), 'motion-kit-installed-'));
  const installed = join(root, 'node_modules/@kimuson/motion-kit');
  const workspace = join(root, 'workspace');
  mkdirSync(installed, { recursive: true });
  mkdirSync(workspace);
  cpSync(new URL('../../', import.meta.url), join(installed, 'src'), { recursive: true });
  writeFileSync(join(installed, 'package.json'), '{"name":"@kimuson/motion-kit","type":"module"}');
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['react', 'react-dom', 'zod', 'vite', 'semver'])
    symlinkSync(dirname(require.resolve(`${name}/package.json`)), join(root, 'node_modules', name));
  writeFileSync(join(root, 'entry.tsx'), 'export const compositions=undefined;');
  const child = fork(
    join(installed, 'src/render/loading/child.js'),
    [JSON.stringify({ projectRoot: root, entry: join(root, 'entry.tsx'), workspace })],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: true, execArgv: [] },
  );
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const message = await new Promise<unknown>((done, reject) => {
      child.on('message', done);
      child.on('error', reject);
      child.once('exit', () => reject(new Error('Child exited before ready')));
      timer = setTimeout(() => reject(new Error('Installed child timed out')), 10_000);
    });
    expect(z.object({ type: z.literal('ready'), url: z.url() }).safeParse(message).success).toBe(
      true,
    );
  } finally {
    clearTimeout(timer);
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
});
