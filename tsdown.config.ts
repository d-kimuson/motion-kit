import { defineConfig } from 'tsdown';

// One entry per public subpath. Adding a subpath touches four places: an entry
// here, a condition block in `package.json#exports`, an alias line in
// `vitest.config.ts`, and a `paths` entry in `tsconfig.json` (see
// docs/contexts/render/CONTEXT.md).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    render: 'src/render/index.ts',
    agent: 'src/agent/cli-output.ts',
    three: 'src/three/index.ts',
    cli: 'src/cli/main.js',
    // Private build outputs referenced by the renderer's loading pipeline at
    // runtime; `./browser` becomes a public subpath with TASK-190.
    child: 'src/render/loading/child.js',
    browser: 'src/core/runtime/browser-entry.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: false,
  fixedExtension: false,
  // `package.json#sideEffects: false` lets the bundler drop side-effect-only
  // modules; the loading server is forked for its side effects, so keep it.
  treeshake: {
    moduleSideEffects: (id) => id.includes('render/loading/server'),
  },
});
