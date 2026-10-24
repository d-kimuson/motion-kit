import type { ResolvedConfig } from 'vite';

import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { installBundledVite } from './config-loader.ts';
import {
  configFailure,
  LoadingConfigError,
  loadingFailure,
  preprocessorFailure,
  viteOptimizerFailure,
} from './diagnostics.ts';
import { htmlShell } from './html-shell.ts';
import { namedPlugins } from './plugins.ts';
import { loadingPlugin, reactResolution, reservedAliases } from './resolution.ts';

const input = z
  .object({ projectRoot: z.string(), entry: z.string(), workspace: z.string() })
  .parse(JSON.parse(process.argv[2] ?? '{}'));
const entry = resolve(input.projectRoot, input.entry);
// Only React membership is owned; keep each environment's project policy/order.
// Normalize again after Vite's array merges and all project hooks have finished.
const withReactDedupe = (dedupe: readonly string[]) => [
  ...new Set([
    ...dedupe.filter((name) => name !== 'react' && name !== 'react-dom'),
    'react',
    'react-dom',
  ]),
];
// Diagnostic location before evaluation; discovery/evaluation still belongs to Vite.
let configPath =
  ['js', 'mjs', 'ts', 'cjs', 'mts', 'cts']
    .map((extension) => join(input.projectRoot, `vite.config.${extension}`))
    .find(existsSync) ?? join(input.projectRoot, 'vite.config.ts');
const adapter = installBundledVite(input.workspace);
const send = (message: unknown, callback?: (error: Error | null) => void) =>
  callback === undefined ? process.send?.(message) : process.send?.(message, callback);
/** A producer-authored name for a failure, if the cause is known precisely. Vite's own
 * plugins are not project plugins, so their names never reach the Diagnostic. */
const failureName = (error: unknown): string | undefined => {
  const rejected = adapter.rejectedName();
  if (rejected !== undefined) return rejected;
  const preprocessor = preprocessorFailure(error);
  if (preprocessor !== undefined) return preprocessor;
  if (error instanceof LoadingConfigError) return error.key;
  if (typeof error !== 'object' || error === null || !('plugin' in error)) return undefined;
  const name = error.plugin;
  return typeof name === 'string' && !name.startsWith('vite:') ? name : undefined;
};
/** Only the project's config and plugin resolution is a configuration failure; anything
 * else (server creation, the shell, the loopback bind) keeps the plain loading failure.
 * The phase alone cannot decide it: Vite surfaces the same failure from the try below,
 * from the custom logger, or as an unhandled rejection, before or after `ready`, so every
 * path classifies through this one function. */
let resolvingConfig = true;
const failed = (error: unknown) => {
  const name = failureName(error);
  return resolvingConfig || name !== undefined || viteOptimizerFailure(error)
    ? configFailure(name ?? 'configuration', configPath)
    : loadingFailure('configuration');
};
const report = (error: unknown) => send({ type: 'failure', error: failed(error) });
// A project setting can crash Vite inside its own async context (the dependency
// optimizer, for example) without ever reaching the try below. The listeners below stop
// Node from printing the cause and exiting, so print it to the inherited stderr and
// report it: the caller would otherwise only see the generic service-exit Diagnostic.
// The guard covers the child's whole life, so configuration attribution needs a real
// marker — the config phase, the optimizer's banner, a plugin name or a config key —
// and any other crash keeps the plain loading Diagnostic.
const crashed = (error: unknown) => {
  console.error(error);
  send({ type: 'failure', error: failed(error) }, () => process.disconnect?.());
};
process.on('uncaughtException', crashed);
process.on('unhandledRejection', crashed);
try {
  const vite = await import('vite');
  adapter.assertIntercepted();
  const logger = vite.createLogger('warn', {
    customLogger: {
      info: (message) => console.error(message),
      warn: (message) => console.error(message),
      warnOnce: (message) => console.error(message),
      error: (message, options) => {
        console.error(message);
        if (options?.error !== undefined) report(options.error);
      },
      clearScreen: () => {},
      hasErrorLogged: () => false,
      hasWarned: false,
    },
  });
  const loaded = await vite.loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    undefined,
    input.projectRoot,
    'silent',
    logger,
  );
  configPath = loaded?.path ?? configPath;
  const config = loaded?.config ?? {};
  let enforceOwned: (() => void) | undefined;
  const resolved = await vite.resolveConfig(
    {
      ...config,
      configFile: false,
      root: resolve(input.projectRoot, config.root ?? '.'),
      mode: 'development',
      plugins: [
        loadingPlugin(entry),
        ...(await namedPlugins(config.plugins ?? [], report)),
        {
          name: 'motion-kit-loading-policy',
          enforce: 'post',
          // Runs after project config hooks, before Vite creates its middleware server.
          config: {
            order: 'post',
            handler(final) {
              const react = reactResolution(input.projectRoot, final);
              const root = resolve(input.projectRoot, final.root ?? '.');
              return {
                root,
                mode: 'development',
                cacheDir: join(input.workspace, 'cache'),
                appType: 'custom',
                customLogger: logger,
                clearScreen: false,
                esbuild: { jsx: 'automatic', ...final.esbuild },
                resolve: {
                  ...final.resolve,
                  alias: [...reservedAliases(entry), ...react.aliases],
                  dedupe: withReactDedupe(final.resolve?.dedupe ?? []),
                },
                optimizeDeps: { ...final.optimizeDeps, entries: [entry], include: react.include },
                server: {
                  ...final.server,
                  middlewareMode: true,
                  hmr: false,
                  // Vite 7 still opens its default WebSocket listener with hmr:false.
                  ws: false,
                  open: false,
                  host: '127.0.0.1',
                  fs: {
                    ...final.server?.fs,
                    allow: [
                      ...(final.server?.fs?.allow ?? [vite.searchForWorkspaceRoot(root)]),
                      input.projectRoot,
                      fileURLToPath(new URL('../../../', import.meta.url)),
                      ...react.directories,
                    ],
                  },
                },
              };
            },
          },
          transform: {
            order: 'pre',
            handler(code, id) {
              // Vite 7's CSS helpers share the HMR client, which connects even
              // with hmr:false/ws:false. Keep those helpers, not its transport.
              if (id === vite.normalizePath(adapter.clientEntry)) {
                const connect = 'transport.connect(createHMRHandler(handleMessage));';
                if (code.split(connect).length !== 2)
                  throw new LoadingConfigError('bundled Vite client adapter');
                return code.replace(connect, '');
              }
              return undefined;
            },
          },
        },
      ],
    },
    'serve',
    'development',
    'development',
    false,
    (resolved: ResolvedConfig) => {
      // Snapshot normalized owned values before project configResolved hooks.
      // Vite awaits those hooks concurrently, so a last/post hook is NOT a barrier.
      const owned = {
        root: resolved.root,
        mode: resolved.mode,
        cacheDir: resolved.cacheDir,
        appType: resolved.appType,
        logger: resolved.logger,
        customLogger: resolved.customLogger,
        clearScreen: resolved.clearScreen,
      };
      const environmentNames = Object.keys(resolved.environments);
      const aliases = resolved.resolve.alias.map((alias) => ({ ...alias }));
      const allow = [...resolved.server.fs.allow];
      const include = [...(resolved.optimizeDeps.include ?? [])];
      enforceOwned = () => {
        Object.assign(resolved, owned);
        Object.assign(resolved.server, {
          middlewareMode: true,
          hmr: false,
          ws: false,
          open: false,
          host: '127.0.0.1',
        });
        resolved.server.fs.allow = allow;
        resolved.resolve.alias = aliases;
        resolved.resolve.dedupe = withReactDedupe(resolved.resolve.dedupe);
        resolved.optimizeDeps.entries = [entry];
        resolved.optimizeDeps.include = include;
        // Vite has already forked environment options. The optimizer and module
        // resolver consume these, not just the top-level compatibility fields.
        if (
          Object.keys(resolved.environments).length !== environmentNames.length ||
          environmentNames.some((name) => resolved.environments[name] === undefined)
        )
          throw new LoadingConfigError('environments');
        for (const environment of Object.values(resolved.environments)) {
          Object.assign(environment.resolve, {
            alias: aliases,
            dedupe: withReactDedupe(environment.resolve.dedupe),
          });
        }
        const client = resolved.environments['client'];
        if (client !== undefined) {
          client.optimizeDeps.entries = [entry];
          client.optimizeDeps.include = include;
        }
      };
    },
  );
  // Public Vite API accepts an already-resolved configuration without rerunning
  // hooks. Enforce before it creates HTTP/WebSocket servers or middleware.
  enforceOwned?.();
  // Config and plugin resolution is over; a plugin hook that still throws is named
  // precisely, but an unnamed later failure is no longer a configuration failure.
  resolvingConfig = false;
  const server = await vite.createServer(resolved);
  const base = server.config.base;
  const http = createHttpServer((request, response) => {
    if (request.url?.split('?')[0] === `${base}__motion-kit/`) {
      void server.transformIndexHtml(`${base}__motion-kit/`, htmlShell()).then(
        (html) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(html);
        },
        (error: unknown) => {
          report(error);
          response.statusCode = 500;
          response.end('Composition shell failed.');
        },
      );
    } else
      server.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
  });
  await new Promise<void>((done, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', done);
  });
  const address = http.address();
  if (address === null || typeof address === 'string') throw new Error('Missing loopback address');
  server.watcher.add([
    entry,
    ...(loaded?.dependencies ?? []),
    ...(loaded === null ? [] : [loaded.path]),
  ]);
  const sourceFiles = new Set(
    [entry, ...(loaded?.dependencies ?? []), ...(loaded === null ? [] : [loaded.path])].map(
      (path) => vite.normalizePath(path),
    ),
  );
  const isSource = (path: unknown): boolean => {
    if (typeof path !== 'string') return false;
    const normalized = vite.normalizePath(path);
    return (
      sourceFiles.has(normalized) || server.moduleGraph.getModulesByFile(normalized) !== undefined
    );
  };
  for (const event of ['change', 'unlink', 'add'] as const)
    server.watcher.on(event, (path) => {
      if (isSource(path))
        send({ type: 'failure', error: loadingFailure('source changed; start a fresh session') });
    });
  process.on('message', (message) => {
    if (message === 'dispose')
      void (async () => {
        await server.close();
        http.closeAllConnections();
        await new Promise<void>((done) => http.close(() => done()));
        process.disconnect?.();
      })();
  });
  send({
    type: 'ready',
    url: `http://127.0.0.1:${address.port}${base}__motion-kit/`,
    configPath,
    dependencies: loaded?.dependencies ?? [],
  });
} catch (error) {
  report(error);
  process.disconnect?.();
}
