import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { markSvg } from './brand.ts';

describe('markSvg', () => {
  test('is the document in .github/assets/mark.svg', async () => {
    const file = await readFile(new URL('../../.github/assets/mark.svg', import.meta.url), 'utf8');
    expect(file).toBe(markSvg);
  });
});
