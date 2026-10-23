import { writeFileSync } from 'node:fs';

import { createCliOutputJsonSchema } from '../src/agent/cli-output-json-schema.ts';

writeFileSync(
  new URL('../docs/contexts/agent/schema/cli-output.v1.schema.json', import.meta.url),
  `${JSON.stringify(createCliOutputJsonSchema(), null, 2)}\n`,
);
