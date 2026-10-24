import { expect, it } from 'vitest';

import { entrySource } from './entry-source.ts';
import { htmlShell } from './html-shell.ts';

it('emits only serialized registry/bootstrap imports and a bootstrap call, never props or Node generators', () => {
  const id = 'virtual:user-"entry\\with\ncharacters';
  expect(entrySource(id)).toBe(
    `import { compositions } from ${JSON.stringify(id)};\nimport { bootstrapComposition } from '@kimuson/motion-kit/browser';\nbootstrapComposition(compositions);\n`,
  );
  expect(entrySource(id)).not.toContain('src/render');
  expect(htmlShell()).toContain('src="/@id/virtual:motion-kit-entry"');
  expect(htmlShell()).not.toContain('props');
});
