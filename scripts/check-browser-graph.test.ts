import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { entrySource } from '../src/render/loading/entry-source.ts';
import { loadingPlugin } from '../src/render/loading/resolution.ts';
import { checkBrowserGraph } from './check-browser-graph.ts';

describe('resolved package-root browser graph', () => {
  it('resolves the public package export and its transitive runtime dependencies without host modules', async () => {
    const graph = await checkBrowserGraph(
      new URL('./fixtures/browser-root.ts', import.meta.url).pathname,
    );
    expect(graph.some((file) => file.endsWith('/react/index.js'))).toBe(true);
    expect(graph.some((file) => file.endsWith('/composition.tsx'))).toBe(true);
  });

  it('checks the browser subpath export and emitted wrapper using production loading resolution', async () => {
    const graph = await checkBrowserGraph(
      new URL('./fixtures/browser-bootstrap.ts', import.meta.url).pathname,
    );
    expect(graph.some((file) => file.endsWith('/browser-entry.ts'))).toBe(true);
    const directory = mkdtempSync(join(tmpdir(), 'motion-kit-emitted-'));
    try {
      const entry = join(directory, 'entry.ts');
      writeFileSync(entry, entrySource('virtual:motion-kit-user-entry'));
      const emitted = await checkBrowserGraph(entry, {}, [
        loadingPlugin(new URL('./fixtures/loading-registry.ts', import.meta.url).pathname),
      ]);
      expect(emitted.some((file) => file.endsWith('/browser-entry.ts'))).toBe(true);
      expect(emitted.some((file) => file.includes('/src/render/'))).toBe(false);
      writeFileSync(
        join(directory, 'bad.ts'),
        "import 'node:fs';export const compositions=undefined;",
      );
      await expect(
        checkBrowserGraph(entry, {}, [loadingPlugin(join(directory, 'bad.ts'))]),
      ).rejects.toThrow('Node built-in');
      mkdirSync(join(directory, 'src/render/loading'), { recursive: true });
      const host = join(directory, 'src/render/loading/host.ts');
      writeFileSync(host, 'export const compositions=undefined;');
      await expect(
        checkBrowserGraph(entry, { 'virtual:motion-kit-user-entry': host }, [loadingPlugin(host)]),
      ).rejects.toThrow('Host module');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects transitive Node built-ins and a host module reached through an alias', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-kit-graph-'));
    try {
      const entry = join(directory, 'entry.ts');
      writeFileSync(entry, "import './indirect.ts';");
      writeFileSync(join(directory, 'indirect.ts'), "import 'node:fs';");
      await expect(checkBrowserGraph(entry)).rejects.toThrow('Node built-in');
      mkdirSync(join(directory, 'src/render'), { recursive: true });
      const host = join(directory, 'src/render/host.ts');
      writeFileSync(host, 'export const host = true;');
      writeFileSync(entry, "import 'host-alias';");
      await expect(checkBrowserGraph(entry, { 'host-alias': host })).rejects.toThrow('Host module');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
