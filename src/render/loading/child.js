import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

// The package distributes checked sources. Native automatic stripping refuses
// .ts inside node_modules, so the owned child explicitly strips only our source
// tree before importing its Node entry. No user config/page code uses this hook.
const sourceRoot = new URL('../../', import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts'))
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')),
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
await import('./server.ts');
