import { describe, expect, it } from 'vitest';

import { isKnownRendererNoise } from './noise.ts';

// The lines these cases quote were observed on a macOS arm64 render of a ThreeCanvas
// (docs/contexts/agent/knowledge/20261029-swiftshader-warning.md). A page console message carries
// its arguments in front of the text, which is why the SwiftShader line starts with `[]`.
describe('isKnownRendererNoise', () => {
  it.each([
    '[]Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader flag to opt in to lower security guarantees for trusted content.',
    '[.WebGL-0x12c00443200]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels',
    '%cDownload the React DevTools for a better development experience: https://react.dev/link/react-devtools font-weight:bold',
    '[vite] connecting...',
    '✨ new dependencies optimized: zod, @react-three/fiber, three',
    '✨ optimized dependencies changed. reloading',
    '(node:9804) ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time',
    '(Use `node --trace-warnings ...` to show where the warning was created)',
  ])('recognises the environmental notice %#', (line) => {
    expect(isKnownRendererNoise(line)).toBe(true);
  });

  it.each([
    // The page's own output is what a failure report exists to show.
    'Error: the composition threw during mount',
    'console.error: props.text is missing',
    // A dependency's deprecation warning is a finding about the project, not about this machine.
    'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
    // A Vite error is not the handshake.
    '[vite] Internal server error: failed to resolve import "./missing.tsx"',
  ])('leaves the page and service output %# alone', (line) => {
    expect(isKnownRendererNoise(line)).toBe(false);
  });
});
