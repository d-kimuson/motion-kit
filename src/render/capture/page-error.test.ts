import { describe, expect, it } from 'vitest';

import { pageErrorCause } from './page-error.ts';

const reported = (text: string): string | undefined => pageErrorCause(new Error(text))?.message;

/**
 * One redaction case: the message an engine or a transport actually throws, and the
 * reported `cause.message`. A secret in `input` must never appear in `expected`.
 */
const CASES: readonly { label: string; input: string; expected: string }[] = [
  {
    label: 'reduces a file: URL to the basename of its machine-specific path',
    input: 'net::ERR_FILE_NOT_FOUND at file:///tmp/mk-frame-8442/index.html',
    expected: 'net::ERR_FILE_NOT_FOUND at [path]/index.html',
  },
  {
    label: 'keeps a URL whose path holds parentheses and redacts its query',
    input: 'see https://cdn.example/x(1).js?token=s3cret here',
    expected: 'see https://cdn.example/x(1).js (+1 query parameter, redacted) here',
  },
  {
    label: 'strips userinfo from a protocol-relative URL',
    input: 'fetch //user:pw@cdn.example/path/frame.js failed',
    expected: 'fetch /path/frame.js failed',
  },
  {
    label: 'redacts the query of a protocol-relative URL',
    input: 'net::ERR_FAILED at //cdn.example/path.js?token=s3cret',
    expected: 'net::ERR_FAILED at /path.js (+1 query parameter, redacted)',
  },
  {
    label: 'redacts the query of a relative URL',
    input: 'failed to fetch /api/render?token=s3cret&sig=abc123',
    expected: 'failed to fetch /api/render (+2 query parameters, redacted)',
  },
  {
    label: 'leaves a frame out of a total and a frame rate alone',
    input: 'Frame 431/6660 capture failed after 115s at 30/1 fps',
    expected: 'Frame 431/6660 capture failed after 115s at 30/1 fps',
  },
  {
    label: 'reduces an absolute path under a known root, spaces in a directory included',
    input: 'open /Users/kaito/Motion Kit/out.png failed',
    expected: 'open [path]/out.png failed',
  },
  {
    label: 'reduces a temporary path under a known root',
    input: 'cannot decode /var/folders/tp/mk-frame-12/out.png',
    expected: 'cannot decode [path]/out.png',
  },
  {
    label: 'reduces a Windows drive path',
    input: 'cannot write C:\\Users\\kaito\\out.png',
    expected: 'cannot write [path]/out.png',
  },
  {
    label: 'keeps the existing URL and absolute-path case',
    input:
      'net::ERR_FAILED at https://user:s3cret@cdn.example/path/frame.js?token=abc and open /var/folders/tp/mk-frame-12/out.png',
    expected:
      'net::ERR_FAILED at https://cdn.example/path/frame.js (+1 query parameter, redacted) and open [path]/out.png',
  },
];

describe('page error cause', () => {
  it.each(CASES)('$label', ({ input, expected }) => {
    expect(reported(input)).toBe(expected);
  });
  it('leaves no secret, address or machine-specific directory in the reported cause', () => {
    const serialized = JSON.stringify(CASES.map(({ input }) => pageErrorCause(new Error(input))));
    for (const secret of ['s3cret', 'abc123', 'user:pw', 'X-Amz', '/tmp/', '/Users/', '/var/'])
      expect(serialized).not.toContain(secret);
  });
  it('keeps a bracketed path inside a URL that balances', () => {
    expect(reported('https://cdn.example/wiki/Foo_(bar) broke')).toBe(
      'https://cdn.example/wiki/Foo_(bar) broke',
    );
    expect(reported('(see https://cdn.example/a.js?token=abc).')).toBe(
      '(see https://cdn.example/a.js (+1 query parameter, redacted)).',
    );
  });
});
