import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Development resolution: tests import the public package name and must resolve it to src/
// (not the built dist/) so that symbol-branded types and module-level singletons are the same
// instance as the relative src imports they are mixed with. scripts/check-browser-graph.test.ts
// resolves the real `package.json#exports` (dist) through its own Vite build and import.meta.resolve.
const srcEntry = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@kimuson\/motion-kit\/render$/, replacement: srcEntry('./src/render/index.ts') },
      { find: /^@kimuson\/motion-kit\/agent$/, replacement: srcEntry('./src/agent/cli-output.ts') },
      { find: /^@kimuson\/motion-kit\/three$/, replacement: srcEntry('./src/three/index.ts') },
      { find: /^@kimuson\/motion-kit$/, replacement: srcEntry('./src/index.ts') },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          isolate: false,
          // A reference example's data is unit-tested next to it (the explainer's script and its
          // timing helpers); only its `*.smoke.test.ts` renders, and that belongs to the `cli`
          // project below.
          include: [
            'src/**/*.test.{ts,tsx}',
            'scripts/**/*.test.ts',
            '.agents/**/*.test.ts',
            'examples/**/*.test.ts',
          ],
          exclude: [
            'examples/**/*.smoke.test.ts',
            'src/**/*.browser.test.tsx',
            'src/render/**/*.test.ts',
            'src/cli/**/*.test.ts',
            'src/**/*.determinism.test.ts',
          ],
          setupFiles: ['configs/vitest/time.setup.ts'],
          // A Lean differential case or a React DOM case can miss Vitest's 5 s default when other
          // work saturates the machine; 30 s still fails a real hang.
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'cli',
          // The reference examples' smoke tests render through the built CLI and assert the MP4
          // (docs/design-doc/20261025-reference-examples.md, "CI policy").
          include: ['src/cli/**/*.test.ts', 'examples/**/*.smoke.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'loading',
          include: ['src/render/loading/**/*.test.ts', 'src/render/browser/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'frame-transport',
          include: [
            'src/render/renderer.test.ts',
            'src/render/pool.test.ts',
            'src/render/pool-scheduling.test.ts',
            'src/render/render-video.test.ts',
            'src/render/capture/**/*.test.ts',
            'src/render/check/**/*.test.ts',
            // Later contexts register reference Compositions as *.determinism.test.ts.
            'src/**/*.determinism.test.ts',
          ],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        // The Encoder port spawns the system FFmpeg; every case needs the binary, and a
        // missing one must fail here rather than skip.
        extends: true,
        test: {
          name: 'encoding',
          include: ['src/render/encoding/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 20_000,
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'],
        },
        test: {
          name: 'composition-dom',
          include: [
            'src/core/composition/**/*.browser.test.tsx',
            'src/core/runtime/**/*.browser.test.tsx',
            'src/core/assets/**/*.browser.test.tsx',
          ],
          setupFiles: ['configs/vitest/time.setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 640, height: 480 },
            screenshotFailures: false,
          },
        },
      },
      {
        // WebGL needs its own Chromium profile: the scene is rendered on SwiftShader so the
        // result does not depend on the host GPU, and the R3F second reconciler has to share
        // the renderer's React instance (pnpm's global virtual store).
        extends: true,
        resolve: { dedupe: ['react', 'react-dom'] },
        optimizeDeps: {
          include: ['@react-three/fiber', 'react', 'react-dom', 'react-dom/client', 'three'],
        },
        test: {
          name: 'three-dom',
          include: ['src/three/**/*.browser.test.tsx'],
          setupFiles: ['configs/vitest/time.setup.ts'],
          testTimeout: 120_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
              },
            }),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 640, height: 480 },
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
