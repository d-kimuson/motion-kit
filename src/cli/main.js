#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

// The package ships checked sources. Native type stripping refuses .ts inside
// node_modules, so this bin is plain JS and strips only our own source tree
// before importing the typed entry. User entry code is loaded by the render
// child process, never by this hook.
//
// Node warns about that experiment on every start, in this process, whatever the
// level: it is a fact about this bin rather than about the project being rendered,
// so a default run stays "the result, the Diagnostics and the progress" (agent
// ADR: CLI stderr). `--verbose` keeps every warning, including this one. The
// loading child's own copy reaches the same policy through the renderer log.
const verbose = process.argv.slice(2).includes('--verbose');
if (!verbose) {
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...rest) => {
    const message = typeof warning === 'string' ? warning : String(warning?.message ?? '');
    if (message.includes('stripTypeScriptTypes')) return;
    emitWarning(warning, ...rest);
  };
}
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
// Ctrl-C (SIGINT), a supervisor's SIGTERM or a closed terminal (SIGHUP) cancels the run through
// one controller: it reaches the renderer and the encoder, which kills its child and removes its
// temporary file. A second signal ends the process at once, through the same synchronous covers.
const watched = watchSignals();
try {
  process.exitCode = await runCli(process.argv.slice(2), { signal: watched.signal });
} finally {
  watched.stop();
}
