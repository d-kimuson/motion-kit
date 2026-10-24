import type { Plugin, PluginOption } from 'vite';

import { LoadingConfigError } from './diagnostics.ts';

// Preserve hook options, `this`, sync returns and plugin identity/properties. Vite
// annotates transform errors, but not config/configResolved/configureServer errors.
const namedHook = <T extends object>(hook: T, name: string): T =>
  new Proxy(hook, {
    apply(target, thisArg, args) {
      try {
        if (typeof target !== 'function') throw new Error('Expected callable plugin hook');
        const result: unknown = Reflect.apply(target, thisArg, args);
        if (result instanceof Promise)
          return result.catch((error: unknown) => {
            throw error instanceof LoadingConfigError ? error : new LoadingConfigError(name);
          });
        return result;
      } catch (error) {
        throw error instanceof LoadingConfigError ? error : new LoadingConfigError(name);
      }
    },
  });
const namedPlugin = (plugin: Plugin): Plugin =>
  new Proxy(plugin, {
    get(target, key, receiver) {
      const hook: unknown = Reflect.get(target, key, receiver);
      if (typeof hook === 'function') return namedHook(hook, plugin.name);
      if (
        typeof hook === 'object' &&
        hook !== null &&
        'handler' in hook &&
        typeof hook.handler === 'function'
      )
        return { ...hook, handler: namedHook(hook.handler, plugin.name) };
      return hook;
    },
  });
export const namedPlugins = async (options: readonly PluginOption[]): Promise<Plugin[]> => {
  const result: Plugin[] = [];
  for (const option of options) {
    const plugin = await option;
    if (plugin === false || plugin === undefined || plugin === null) continue;
    if (Array.isArray(plugin)) result.push(...(await namedPlugins(plugin)));
    else result.push(namedPlugin(plugin));
  }
  return result;
};
