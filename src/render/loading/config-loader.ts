import { readFileSync, realpathSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { LoadingConfigError } from './diagnostics.ts';

const require = createRequire(import.meta.url);

/** Child-process-only adapter for pinned Vite 7.3.7.
 * Stage 1 registers BEFORE externalize-deps' project lookup (also inspecting
 * absolute/relative bypasses). Stage 2 intercepts externalized ESM AND CJS.
 * The guarded in-memory patch never changes an installed package or user tree.
 */
export const installBundledVite = (workspace: string) => {
  const viteRoot = dirname(require.resolve('vite/package.json'));
  const paths: Record<string, string> = {
    vite: require.resolve('vite'),
    'vite/module-runner': require.resolve('vite/module-runner'),
    'vite/package.json': require.resolve('vite/package.json'),
  };
  let rejected: string | undefined;
  const reject = (name: string): never => {
    rejected ??= name;
    throw new LoadingConfigError(name);
  };
  const checked = new Set<string>();
  const inspectPackage = (url: string) => {
    if (!url.startsWith('file:')) return;
    let directory = dirname(fileURLToPath(url));
    try {
      directory = realpathSync(directory);
    } catch {
      return;
    }
    while (directory !== dirname(directory)) {
      if (checked.has(directory)) return;
      checked.add(directory);
      let manifest: { name?: unknown; version?: unknown };
      try {
        const parsed: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        manifest = typeof parsed === 'object' && parsed !== null ? parsed : {};
      } catch {
        directory = dirname(directory);
        continue;
      }
      // A resolved package named "vite" that is not the bundled copy is a detected
      // second Vite; reject it rather than loading two Vite runtimes.
      if (manifest.name === 'vite' && directory !== viteRoot)
        reject(`vite@${typeof manifest.version === 'string' ? manifest.version : 'unknown'}`);
      return;
    }
  };
  const bundled = (id: string) => {
    if (id !== 'vite' && !id.startsWith('vite/')) return undefined;
    return paths[id] ?? reject(id);
  };
  const symbol = 'motion-kit.config-loader.resolve';
  Object.defineProperty(globalThis, Symbol.for(symbol), {
    configurable: true,
    value: (id: string, importer: string, kind: string, isESM: boolean) => {
      const target = bundled(id);
      if (target !== undefined)
        return {
          path: isESM || kind === 'dynamic-import' ? pathToFileURL(target).href : target,
          external: true,
        };
      if (isAbsolute(id) || id.startsWith('.'))
        inspectPackage(pathToFileURL(resolve(dirname(importer), id)).href);
      return undefined;
    },
  });
  const marker = 'build$3.onResolve({ filter: /^[^.#].*/ },';
  const temporaryLookup =
    'let nodeModulesDir = typeof process.versions.deno === "string" ? void 0 : findNearestNodeModules(path.dirname(fileName));';
  const temporaryFile =
    'const tempFileName = nodeModulesDir ? path.resolve(nodeModulesDir, `.vite-temp/${path.basename(fileName)}.${hash$1}.mjs`) : `${fileName}.${hash$1}.mjs`;';
  const chunk = pathToFileURL(join(viteRoot, 'dist/node/chunks/config.js')).href;
  let intercepted = false;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const target = bundled(specifier);
      if (target !== undefined) return { url: pathToFileURL(target).href, shortCircuit: true };
      const resolved = nextResolve(specifier, context);
      inspectPackage(resolved.url);
      return resolved;
    },
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== chunk) return loaded;
      const source =
        typeof loaded.source === 'string' ? loaded.source : new TextDecoder().decode(loaded.source);
      for (const sentinel of [marker, temporaryLookup, temporaryFile])
        if (source.split(sentinel).length !== 2) reject('bundled Vite config-loader adapter');
      intercepted = true;
      return {
        ...loaded,
        source: source
          .replace(
            marker,
            `build$3.onResolve({filter: /.*/}, ({path,importer,kind}) => globalThis[Symbol.for(${JSON.stringify(symbol)})](path,importer,kind,isESM));\n${marker}`,
          )
          .replace(temporaryLookup, 'let nodeModulesDir;')
          .replace(
            temporaryFile,
            `const tempFileName = path.resolve(${JSON.stringify(workspace)}, hash$1 + ".mjs");`,
          ),
      };
    },
  });
  return {
    hooks,
    clientEntry: join(viteRoot, 'dist/client/client.mjs'),
    rejectedName: () => rejected,
    assertIntercepted: () => {
      if (!intercepted) reject('bundled Vite config-loader adapter');
    },
  };
};
