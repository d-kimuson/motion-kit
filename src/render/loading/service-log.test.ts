import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createLogChannel, setLogChannel } from '../../lib/log.ts';
import { forwardServiceOutput } from './service-log.ts';

/** Feeds `chunks` through the forwarder and returns what the channel kept for a failure report. */
const collect = async (chunks: readonly string[]): Promise<readonly string[]> => {
  const channel = createLogChannel({ level: 'normal', write: () => {} });
  const restore = setLogChannel(channel);
  try {
    const input = new PassThrough();
    const drained = forwardServiceOutput(input);
    for (const chunk of chunks) input.write(chunk);
    input.end();
    await drained;
    return channel.recent().map((record) => record.text);
  } finally {
    restore();
  }
};

describe('forwardServiceOutput', () => {
  it('records one entry per line', async () => {
    expect(await collect(['first\nsecond\n'])).toEqual(['first', 'second']);
  });

  it('carries a line split across chunks, so an anchored notice still matches', async () => {
    // The handshake notice is dropped at the default level only when its line matches as a whole.
    expect(await collect(['[vite] conn', 'ecting...\n'])).toEqual([]);
  });

  it('keeps a page-relevant line whole when it arrives in pieces', async () => {
    expect(await collect(['Error: failed to resolve ', 'import "./missing.tsx"\n'])).toEqual([
      'Error: failed to resolve import "./missing.tsx"',
    ]);
  });

  it('flushes a last line that has no newline', async () => {
    expect(await collect(['no trailing newline'])).toEqual(['no trailing newline']);
  });
});
