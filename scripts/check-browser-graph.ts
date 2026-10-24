import { builtinModules, createRequire } from 'node:module';
import { resolve } from 'node:path';
import { type Vite } from 'vitest/node';
import { z } from 'zod';

const require = createRequire(import.meta.resolve('vitest/node'));
const bundlerSchema = z.object({
  build: z.custom<typeof Vite.build>((value) => typeof value === 'function'),
});

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const forbidden =
  /(?:^|[/\\])(?:src[/\\](?:render|cli|agent)|node_modules[/\\](?:vite|playwright|playwright-core|@playwright))[/\\]/;

/** Inspect the actually resolved browser build graph, including package exports,
 * aliases and transitive dependencies. This uses Vitest's existing dev bundler,
 * not TASK-157's production loading service. That task adds its generated entry.
 */
export const checkBrowserGraph = async (
  entry: string,
  aliases: Readonly<Record<string, string>> = {},
): Promise<readonly string[]> => {
  const visited = new Set<string>();
  const check = (id: string) => {
    if (builtins.has(id.replace(/^node:/, '')) || id.includes('__vite-browser-external'))
      throw new Error(`Node built-in in browser graph: ${id}`);
    if (forbidden.test(id)) throw new Error(`Host module in browser graph: ${id}`);
  };
  const imported: unknown = await import(require.resolve('vite'));
  const bundler = bundlerSchema.parse(imported);
  await bundler.build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { ...aliases } },
    plugins: [
      {
        name: 'motion-kit-browser-boundary',
        enforce: 'pre',
        async resolveId(source, importer, options) {
          check(source);
          const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
          if (resolved !== null) check(resolved.id);
          return resolved;
        },
        transform(_source, id) {
          check(id);
          visited.add(id);
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(entry), formats: ['es'], fileName: 'graph' },
    },
  });
  return [...visited];
};
