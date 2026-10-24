import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const forbidden =
  /(?:^|[/\\])(?:src[/\\](?:render|cli|agent)|node_modules[/\\](?:vite|playwright|playwright-core|@playwright))[/\\]/;

const three = /(?:^|[/\\]node_modules[/\\])(?:three|@react-three[/\\][^/\\]+)(?:[/\\]|$)/;

/** Inspect the actually resolved browser build graph, including package exports,
 * aliases and transitive dependencies. Uses the production bundled Vite and accepts
 * the same private loading plugin used by the supervised service.
 */
export const checkBrowserGraph = async (
  entry: string,
  aliases: Readonly<Record<string, string>> = {},
  plugins: readonly Plugin[] = [],
): Promise<readonly string[]> => {
  const visited = new Set<string>();
  const check = (id: string) => {
    if (builtins.has(id.replace(/^node:/, '')) || id.includes('__vite-browser-external'))
      throw new Error(`Node built-in in browser graph: ${id}`);
    if (forbidden.test(id)) throw new Error(`Host module in browser graph: ${id}`);
    if (three.test(id)) throw new Error(`Three import in browser graph: ${id}`);
  };
  await build({
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
      ...plugins,
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve(entry), formats: ['es'], fileName: 'graph' },
    },
  });
  return [...visited];
};
