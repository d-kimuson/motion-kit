import type { Plugin, PluginOption } from 'vite';

import { LoadingConfigError } from './diagnostics.ts';

// Preserve hook options, `this`, sync returns and plugin identity/properties. Vite
// annotates transform errors, but not config/configResolved/configureServer errors.
const namedHook = <T extends object>(
  hook: T,
  name: string,
  report: (error: LoadingConfigError) => void,
  unawaited = false,
): T =>
  new Proxy(hook, {
    apply(target, thisArg, args) {
      try {
        if (typeof target !== 'function') throw new Error('Expected callable plugin hook');
        const result: unknown = Reflect.apply(target, thisArg, args);
        const wrap = (value: unknown): unknown =>
          typeof value === 'function' ? namedHook(value, name, report, true) : value;
        if (result instanceof Promise) {
          const pending = result.then(wrap).catch((error: unknown) => {
            const failure =
              error instanceof LoadingConfigError ? error : new LoadingConfigError(name);
            // Awaited hooks propagate to the owning server boundary. Only a
            // detached post-configure promise needs its own reporting boundary.
            if (unawaited) report(failure);
            throw failure;
          });
          // Vite does not await post-configure callbacks. Report their failures
          // to the supervisor even when Vite ignores the returned promise.
          void pending.catch(() => {});
          return pending;
        }
        return wrap(result);
      } catch (error) {
        const failure = error instanceof LoadingConfigError ? error : new LoadingConfigError(name);
        throw failure;
      }
    },
  });
const namedPlugin = (plugin: Plugin, report: (error: LoadingConfigError) => void): Plugin =>
  new Proxy(plugin, {
    get(target, key, receiver) {
      const hook: unknown = Reflect.get(target, key, receiver);
      if (typeof hook === 'function') return namedHook(hook, plugin.name, report);
      if (
        typeof hook === 'object' &&
        hook !== null &&
        'handler' in hook &&
        typeof hook.handler === 'function'
      )
        return { ...hook, handler: namedHook(hook.handler, plugin.name, report) };
      return hook;
    },
  });
export const namedPlugins = async (
  options: readonly PluginOption[],
  report: (error: LoadingConfigError) => void,
): Promise<Plugin[]> => {
  const result: Plugin[] = [];
  for (const option of options) {
    const plugin = await option;
    if (plugin === false || plugin === undefined || plugin === null) continue;
    if (Array.isArray(plugin)) result.push(...(await namedPlugins(plugin, report)));
    else result.push(namedPlugin(plugin, report));
  }
  return result;
};
