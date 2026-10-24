import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { entrySource } from '../src/render/loading/entry-source.ts';
import { loadingPlugin } from '../src/render/loading/resolution.ts';
import { checkBrowserGraph } from './check-browser-graph.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const parsedPackage: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const packageExports =
  isRecord(parsedPackage) && isRecord(parsedPackage['exports'])
    ? parsedPackage['exports']
    : undefined;

describe('resolved package-root browser graph', () => {
  it('resolves the public package export and its transitive runtime dependencies without host modules', async () => {
    const graph = await checkBrowserGraph(
      new URL('./fixtures/browser-root.ts', import.meta.url).pathname,
    );
    expect(graph.some((file) => file.endsWith('/react/index.js'))).toBe(true);
    // The root entry resolves to the built authoring surface, never the Node renderer or CLI.
    expect(graph.some((file) => file.endsWith('/dist/index.js'))).toBe(true);
    expect(graph.some((file) => file.includes('/dist/render.js'))).toBe(false);
    expect(graph.some((file) => file.includes('/dist/cli.js'))).toBe(false);
    expect(graph.some((file) => file.includes('/dist/agent.js'))).toBe(false);
  }, 60_000);

  it('checks the internal browser entry and emitted wrapper using production loading resolution', async () => {
    const graph = await checkBrowserGraph(
      new URL('./fixtures/browser-bootstrap.ts', import.meta.url).pathname,
    );
    expect(graph.some((file) => file.endsWith('/browser-entry.ts'))).toBe(true);
    expect(graph.some((file) => file.includes('/src/render/'))).toBe(false);
    const directory = mkdtempSync(join(tmpdir(), 'motion-kit-emitted-'));
    try {
      const entry = join(directory, 'entry.ts');
      writeFileSync(entry, entrySource('virtual:motion-kit-user-entry'));
      const emitted = await checkBrowserGraph(entry, {}, [
        loadingPlugin(new URL('./fixtures/loading-registry.ts', import.meta.url).pathname),
      ]);
      expect(emitted.some((file) => file.endsWith('/dist/browser.js'))).toBe(true);
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
  }, 60_000);

  it('rejects transitive Node built-ins, Three imports and a host module reached through an alias', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'motion-kit-graph-'));
    try {
      const entry = join(directory, 'entry.ts');
      writeFileSync(entry, "import './indirect.ts';");
      writeFileSync(join(directory, 'indirect.ts'), "import 'node:fs';");
      await expect(checkBrowserGraph(entry)).rejects.toThrow('Node built-in');
      for (const id of ['three', 'three/webgpu', '@react-three/fiber', '@react-three/drei']) {
        writeFileSync(join(directory, 'indirect.ts'), `import '${id}';`);
        await expect(checkBrowserGraph(entry)).rejects.toThrow('Three import');
      }
      mkdirSync(join(directory, 'src/render'), { recursive: true });
      const host = join(directory, 'src/render/host.ts');
      writeFileSync(host, 'export const host = true;');
      writeFileSync(entry, "import 'host-alias';");
      await expect(checkBrowserGraph(entry, { 'host-alias': host })).rejects.toThrow('Host module');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('package layout and dist resolution', () => {
  it('pins types and import to dist for ., ./render and ./agent', () => {
    expect(packageExports?.['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
    expect(packageExports?.['./render']).toEqual({
      types: './dist/render.d.ts',
      import: './dist/render.js',
    });
    expect(packageExports?.['./agent']).toEqual({
      types: './dist/agent.d.ts',
      import: './dist/agent.js',
    });
  });

  it('resolves the root and ./render to dist from Node', () => {
    expect(import.meta.resolve('@kimuson/motion-kit')).toMatch(/[/\\]dist[/\\]index\.js$/);
    expect(import.meta.resolve('@kimuson/motion-kit/render')).toMatch(/[/\\]dist[/\\]render\.js$/);
  });
});
