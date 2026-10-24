import { describe, expect, it } from 'vitest';

import { isBuiltOutput } from './resolution.ts';

describe('isBuiltOutput', () => {
  it('recognises the built dist layout and rejects the source tree', () => {
    expect(isBuiltOutput('file:///repo/dist/render.js')).toBe(true);
    expect(isBuiltOutput('/repo/node_modules/@kimuson/motion-kit/dist/index.js')).toBe(true);
    expect(isBuiltOutput('file:///repo/src/render/loading/resolution.ts')).toBe(false);
    expect(isBuiltOutput('/repo/node_modules/@kimuson/motion-kit/src/index.ts')).toBe(false);
  });
});
