import type { ResolvedConfig } from 'vite';

import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { installBundledVite } from './config-loader.ts';
import {
  checkPreprocessorFile,
  environmentConfigValidator,
  preprocessorFailure,
  resolvedConfigValidator,
  validateConfig,
} from './config-validation.ts';
import { configFailure, LoadingConfigError, loadingFailure } from './diagnostics.ts';
import { htmlShell } from './html-shell.ts';
import { namedPlugins } from './plugins.ts';
import { loadingPlugin, reactResolution } from './resolution.ts';

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
const adapter = installBundledVite(input.workspace, input.projectRoot);
const send = (message: unknown) => process.send?.(message);
const report = (error: unknown) => {
  const name =
    adapter.rejectedName() ??
    preprocessorFailure(error) ??
    (error instanceof LoadingConfigError
      ? error.key
      : typeof error === 'object' &&
          error !== null &&
          'plugin' in error &&
          typeof error.plugin === 'string'
        ? error.plugin
        : undefined);
  send({
    type: 'failure',
    error: name === undefined ? loadingFailure('configuration') : configFailure(name, configPath),
  });
};
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
  validateConfig(config, input.projectRoot);
  let enforceOwned: (() => void) | undefined;
  const validateEnvironments = new Map<string, ReturnType<typeof environmentConfigValidator>>();
  const resolved = await vite.resolveConfig(
    {
      ...config,
      configFile: false,
      root: resolve(input.projectRoot, config.root ?? '.'),
      mode: 'development',
      plugins: [
        {
          name: 'motion-kit-loading-environment-baseline',
          enforce: 'pre',
          configEnvironment: {
            order: 'pre',
            handler(name, environment) {
              validateEnvironments.set(
                name,
                environmentConfigValidator(environment, input.projectRoot),
              );
            },
          },
        },
        loadingPlugin(entry),
        ...(await namedPlugins(config.plugins ?? [], report)),
        {
          name: 'motion-kit-loading-policy',
          enforce: 'post',
          // Runs after project config hooks, before Vite creates its middleware server.
          config: {
            order: 'post',
            handler(final) {
              validateConfig(final, input.projectRoot);
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
                  alias: react.aliases,
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
          configEnvironment: {
            order: 'post',
            handler(name, environment) {
              const validate = validateEnvironments.get(name);
              if (validate === undefined) throw new LoadingConfigError('environments');
              validate(environment);
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
              try {
                checkPreprocessorFile(id, input.projectRoot);
              } catch (error) {
                report(error);
                throw error;
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
      const validateResolved = resolvedConfigValidator(resolved, input.projectRoot);
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
        validateResolved();
      };
    },
  );
  // Public Vite API accepts an already-resolved configuration without rerunning
  // hooks. Enforce before it creates HTTP/WebSocket servers or middleware.
  enforceOwned?.();
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
  for (const event of ['change', 'unlink', 'add'] as const)
    server.watcher.on(event, () =>
      send({ type: 'failure', error: loadingFailure('source changed; start a fresh session') }),
    );
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
