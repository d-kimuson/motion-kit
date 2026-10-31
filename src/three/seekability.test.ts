import { describe, expect, it } from 'vitest';

import { classifyCanvas } from './seekability.ts';

describe('canvas seekability', () => {
  it('classifies a canvas with no useFrame subscriber as Tier B', () => {
    expect(classifyCanvas(0)).toBe('B');
  });

  it.each([1, 2, 64])('classifies %i useFrame subscribers as Tier C', (count) => {
    expect(classifyCanvas(count)).toBe('C');
  });
});
