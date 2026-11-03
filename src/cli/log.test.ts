import { describe, expect, it } from 'vitest';

import { type LogRecord } from '../lib/log.ts';
import { failureLogBlock, logFlagsSchema } from './log.ts';

const record = (text: string, source: LogRecord['source'] = 'browser'): LogRecord => ({
  source,
  text,
  noise: false,
});

describe('logFlagsSchema', () => {
  it('defaults to the level that hides the renderer log', () => {
    expect(logFlagsSchema.parse({ verbose: false, quiet: false })).toBe('normal');
  });

  it('reads each flag as its level', () => {
    expect(logFlagsSchema.parse({ verbose: true, quiet: false })).toBe('verbose');
    expect(logFlagsSchema.parse({ verbose: false, quiet: true })).toBe('quiet');
  });

  it('refuses both flags at once', () => {
    const parsed = logFlagsSchema.safeParse({ verbose: true, quiet: true });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain('--verbose or --quiet');
  });

  it('refuses an unknown flag shape', () => {
    expect(logFlagsSchema.safeParse({ verbose: true }).success).toBe(false);
  });
});

describe('failureLogBlock', () => {
  it('says nothing when no line was kept', () => {
    expect(failureLogBlock([])).toBe('');
  });

  it('names the block and its control flags, then quotes the lines', () => {
    expect(failureLogBlock([record('page error: boom'), record('[vite] ok', 'service')])).toBe(
      [
        'renderer log (2 lines; --verbose streams them as they arrive):',
        '  page error: boom',
        '  [vite] ok',
        '',
      ].join('\n'),
    );
  });

  it('keeps a multi-line record readable', () => {
    expect(failureLogBlock([record('first\nsecond')])).toBe(
      [
        'renderer log (1 line; --verbose streams it as it arrives):',
        '  first',
        '  second',
        '',
      ].join('\n'),
    );
  });
});
