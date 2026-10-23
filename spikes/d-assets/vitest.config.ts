import { playwright } from '@vitest/browser-playwright';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Otherwise Playwright secretly waits for document.fonts.ready, invalidating the font control.
process.env['PW_TEST_SCREENSHOT_NO_FONTS_READY'] = '1';
const assets = {
  font: {
    type: 'font/ttf',
    body: readFileSync(new URL('./assets/Abel-Regular.ttf', import.meta.url)),
  },
  image: {
    type: 'image/svg+xml',
    body: readFileSync(new URL('./assets/checker.svg', import.meta.url)),
  },
  gltf: {
    type: 'model/gltf+json',
    body: readFileSync(new URL('./assets/triangle.gltf', import.meta.url)),
  },
  texture: { type: 'text/plain', body: Buffer.from('upload permitted') },
};
const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const gate = (id: string) => {
  let value = gates.get(id);
  if (value === undefined) {
    value = Promise.withResolvers<void>();
    gates.set(id, value);
  }
  return value;
};

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', 'three', 'three/addons/loaders/GLTFLoader.js'] },
  plugins: [
    {
      name: 'spike-assets-gates',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (url.pathname !== '/spike-assets') return next();
          const id = url.searchParams.get('id') ?? '';
          if (url.searchParams.get('release') === '1') {
            gate(id).resolve();
            res.end('released');
            return;
          }
          const kind = url.searchParams.get('kind');
          if (kind !== 'font' && kind !== 'image' && kind !== 'gltf' && kind !== 'texture') {
            res.statusCode = 400;
            res.end('unknown fixture');
            return;
          }
          const asset = assets[kind];
          const mode = url.searchParams.get('mode');
          const send = () => {
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', asset.type);
            if (mode === 'fail') {
              res.statusCode = kind === 'gltf' ? 200 : 404;
              res.end(kind === 'gltf' ? '{corrupt gltf' : 'missing asset');
            } else res.end(asset.body);
          };
          if (mode === 'delayed' || mode === 'stalled') {
            // Only the test driver releases the response, after it has captured wrong pixels.
            const safety = setTimeout(() => {
              res.destroy();
              gates.delete(id);
            }, 15_000);
            void gate(id).promise.then(() => {
              clearTimeout(safety);
              gates.delete(id);
              send();
            });
          } else send();
        });
      },
    },
  ],
  test: {
    include: ['spikes/d-assets/**/*.browser.test.ts'],
    testTimeout: 30_000,
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
});
