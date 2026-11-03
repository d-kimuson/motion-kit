import { createInterface } from 'node:readline';
import { type Readable } from 'node:stream';

import { logChannel } from '../../lib/log.ts';
import { isKnownRendererNoise } from '../noise.ts';

/**
 * Streams a child process's output into the renderer log, one record per line (agent ADR: CLI
 * stderr). A child writes bytes, not lines: a long line arrives in several chunks, and a stateless
 * split would turn it into several records — the notices in `isKnownRendererNoise` would miss their
 * line, and a failure report would count one line as two. `readline` carries the remainder across
 * chunks, and the returned promise settles once the stream has ended and its last line is recorded.
 */
export const forwardServiceOutput = (input: Readable): Promise<void> => {
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (text) => {
    logChannel().write({ source: 'service', text, noise: isKnownRendererNoise(text) });
  });
  return new Promise((drained) => {
    lines.on('close', () => drained());
  });
};
