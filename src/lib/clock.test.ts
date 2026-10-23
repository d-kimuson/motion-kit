import { describe, expect, it } from 'vitest';

import { createFixedClock, currentDate, currentTimestamp, dateFromIsoString } from '../index.ts';
import { resetClockForTest, setFixedDateForTest } from './clock.ts';

describe('clock boundary', () => {
  it('uses the fixed default date installed by the test setup', () => {
    expect(currentTimestamp()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('resets to the default date without exposing mutable clock state', () => {
    currentDate().setUTCFullYear(2030);
    expect(currentTimestamp()).toBe('2026-01-01T00:00:00.000Z');

    setFixedDateForTest(dateFromIsoString('2000-01-01T00:00:00.000Z'));
    expect(currentTimestamp()).toBe('2000-01-01T00:00:00.000Z');

    resetClockForTest();

    expect(currentTimestamp()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps explicit fixed clocks independent of their input and returned dates', () => {
    const date = dateFromIsoString('2026-02-03T04:05:06.000Z');
    const clock = createFixedClock(date);
    date.setUTCFullYear(2030);
    clock.now().setUTCFullYear(2040);

    expect(clock.now().toISOString()).toBe('2026-02-03T04:05:06.000Z');
  });
});
