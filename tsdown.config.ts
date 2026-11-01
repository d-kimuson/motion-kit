import { defineConfig } from 'tsdown';

const vendor = (name: string) => new URL(`src/preview/vendor/${name}.ts`, import.meta.url).pathname;

// One entry per public subpath. Adding a subpath touches four places: an entry
// here, a condition block in `package.json#exports`, an alias line in
// `vitest.config.ts`, and a `paths` entry in `tsconfig.json` (see
// docs/contexts/render/CONTEXT.md).
export default defineConfig([
  {
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
  },
  {
    // The preview host page's bundle, served by the loading server in preview mode. React and
    // Zod stay external, so the user's Vite resolves the realm's own copies; the UI libraries are
    // devDependencies and are bundled into it.
    entry: { preview: 'src/preview/host.tsx' },
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    outDir: 'dist',
    sourcemap: false,
    fixedExtension: false,
    // Base UI imports the CommonJS shims of use-sync-external-store, whose `require("react")`
    // has no answer in the browser; these ESM modules stand in for them.
    inputOptions: {
      // Base UI and lucide mark their modules "use client", which only a server-components bundler
      // reads; the host page renders on the client alone.
      onLog(level, log, handler) {
        if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
      },
    },
    alias: {
      'use-sync-external-store/shim/with-selector': vendor('use-sync-external-store-with-selector'),
      'use-sync-external-store/shim': vendor('use-sync-external-store-shim'),
    },
  },
]);
