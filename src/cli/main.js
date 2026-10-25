#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

// The package ships checked sources. Native type stripping refuses .ts inside
// node_modules, so this bin is plain JS and strips only our own source tree
// before importing the typed entry. User entry code is loaded by the render
// child process, never by this hook.
const sourceRoot = new URL('../', import.meta.url).href;
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
const { runCli, watchSignals } = await import('./cli.ts');
// Ctrl-C (SIGINT) or a supervisor's SIGTERM cancels the run through one controller: it reaches
// the renderer and the encoder, which kills its child and removes its temporary file.
const watched = watchSignals();
try {
  process.exitCode = await runCli(process.argv.slice(2), { signal: watched.signal });
} finally {
  watched.stop();
}
