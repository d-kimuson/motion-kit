import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createCliOutputJsonSchema } from '../src/agent/cli-output-json-schema.ts';

const schemaPath = fileURLToPath(
  new URL('../dev-docs/contexts/agent/schema/cli-output.v1.schema.json', import.meta.url),
);
const oxfmtPath = fileURLToPath(new URL('../node_modules/.bin/oxfmt', import.meta.url));

writeFileSync(schemaPath, `${JSON.stringify(createCliOutputJsonSchema(), null, 2)}\n`);

// The committed schema is formatted by oxfmt (`pnpm lint` checks it), which does not match
// `JSON.stringify` output; format the written file so regenerating leaves no formatting-only diff.
execFileSync(oxfmtPath, [schemaPath], { stdio: 'inherit' });
