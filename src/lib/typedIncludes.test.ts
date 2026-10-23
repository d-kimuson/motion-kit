import { describe, expect, it } from 'vitest';

import { typedIncludes } from './typedIncludes.ts';

describe('typedIncludes', () => {
  it('narrows the value type when the array contains the value', () => {
    const directions = ['up', 'down'] as const;
    const value: unknown = 'up';
    let narrowed: 'up' | 'down' | undefined;

    if (typedIncludes(directions, value)) {
      narrowed = value;
    }

    expect(narrowed).toBe('up');
  });

  it('returns false when the array does not contain the value', () => {
    const directions = ['up', 'down'] as const;

    expect(typedIncludes(directions, 'left')).toBe(false);
  });
});
