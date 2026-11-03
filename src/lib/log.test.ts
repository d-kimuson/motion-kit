import { describe, expect, it } from 'vitest';

import { createLogChannel, logChannel, logDecision, setLogChannel, type LogRecord } from './log.ts';

const browser = (text: string, noise = false): LogRecord => ({ source: 'browser', text, noise });
const service = (text: string): LogRecord => ({ source: 'service', text, noise: false });

describe('logDecision', () => {
  it('streams and keeps everything at the verbose level', () => {
    expect(logDecision('verbose', browser('page error: boom'))).toEqual({
      stream: true,
      keep: true,
    });
    expect(logDecision('verbose', browser('SwiftShader', true))).toEqual({
      stream: true,
      keep: true,
    });
  });

  it('keeps the default level quiet on the live stream but ready for a failure report', () => {
    expect(logDecision('normal', browser('page error: boom'))).toEqual({
      stream: false,
      keep: true,
    });
  });

  it('drops known environmental noise at the default level instead of buffering it', () => {
    expect(logDecision('normal', browser('SwiftShader fallback', true))).toEqual({
      stream: false,
      keep: false,
    });
  });

  it('writes nothing at all at the quiet level', () => {
    expect(logDecision('quiet', browser('page error: boom'))).toEqual({
      stream: false,
      keep: false,
    });
    expect(logDecision('quiet', browser('SwiftShader fallback', true))).toEqual({
      stream: false,
      keep: false,
    });
  });
});

describe('createLogChannel', () => {
  it('has no level of its own unless the caller names one', () => {
    expect(createLogChannel({ write: () => {} }).level()).toBe('verbose');
  });

  it('streams to the sink only when the level allows it', () => {
    const written: string[] = [];
    const channel = createLogChannel({ level: 'verbose', write: (text) => written.push(text) });
    channel.write(browser('first'));
    channel.write(service('second'));
    expect(written).toEqual(['first', 'second']);
    expect(channel.recent().map((record) => record.text)).toEqual(['first', 'second']);
  });

  it('does not stream at the default level', () => {
    const written: string[] = [];
    const channel = createLogChannel({ level: 'normal', write: (text) => written.push(text) });
    channel.write(browser('hidden'));
    expect(written).toEqual([]);
    expect(channel.recent().map((record) => record.text)).toEqual(['hidden']);
  });

  it('keeps the buffer bounded, oldest first', () => {
    const channel = createLogChannel({ level: 'normal', capacity: 3, write: () => {} });
    for (const text of ['a', 'b', 'c', 'd', 'e']) channel.write(browser(text));
    expect(channel.recent().map((record) => record.text)).toEqual(['c', 'd', 'e']);
  });

  it('bounds one record so a chatty page cannot flood a failure report', () => {
    const channel = createLogChannel({ level: 'normal', write: () => {} });
    channel.write(browser('x'.repeat(5_000)));
    expect(channel.recent()[0]?.text.length).toBe(500);
    expect(channel.recent()[0]?.text.endsWith('…')).toBe(true);
  });

  it('drops a line that is only whitespace', () => {
    const channel = createLogChannel({ level: 'verbose', write: () => {} });
    channel.write(browser('   \n'));
    expect(channel.recent()).toEqual([]);
  });

  it('follows a level change made after it was created', () => {
    const written: string[] = [];
    const channel = createLogChannel({ level: 'normal', write: (text) => written.push(text) });
    channel.setLevel('verbose');
    channel.write(browser('now shown'));
    expect(written).toEqual(['now shown']);
  });
});

describe('logChannel', () => {
  it('installs a channel for the process and restores the previous one', () => {
    const written: string[] = [];
    const restore = setLogChannel(
      createLogChannel({ level: 'normal', write: (text) => written.push(text) }),
    );
    try {
      logChannel().write(browser('buffered'));
      expect(logChannel().level()).toBe('normal');
      expect(
        logChannel()
          .recent()
          .map((record) => record.text),
      ).toEqual(['buffered']);
      expect(written).toEqual([]);
    } finally {
      restore();
    }
    // The channel a library consumer sees by default is the one that streams everything.
    expect(logChannel().level()).toBe('verbose');
    expect(logChannel().recent()).toEqual([]);
  });
});
