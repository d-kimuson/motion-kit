import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkBrowserGraph } from './check-browser-graph.ts';

describe('resolved package-root browser graph', () => {
  it('resolves the public package export and its transitive runtime dependencies without host modules', async () => {
    const graph = await checkBrowserGraph(
      new URL('./fixtures/browser-root.ts', import.meta.url).pathname,
    );
    expect(graph.some((file) => file.endsWith('/react/index.js'))).toBe(true);
    expect(graph.some((file) => file.endsWith('/composition.tsx'))).toBe(true);
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
