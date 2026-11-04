import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

import { DocsTopicSchema } from '../agent/cli-output.ts';

// The published skill sends agents to `docs <topic>`: a renamed or dropped topic must fail here
// rather than in an agent's run.
const skill = readFileSync(new URL('../../skills/motion-kit/SKILL.md', import.meta.url), 'utf8');

it('names only docs topics the CLI knows in skills/motion-kit/SKILL.md', () => {
  const topics = [...skill.matchAll(/`docs ([a-z][a-z-]*)`/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  expect(topics.length).toBeGreaterThan(0);
  for (const topic of topics) expect(DocsTopicSchema.options).toContain(topic);
});
