import type { Result } from '../lib/result.ts';

export const invalidInput = (message: string, hint: string): Result<never> => {
  return { ok: false, error: { code: 'motion.invalid-input', severity: 'error', message, hint } };
};

export const finiteResult = (value: number): Result<number> => {
  return Number.isFinite(value)
    ? { ok: true, value }
    : {
        ok: false,
        error: {
          code: 'motion.non-finite-result',
          severity: 'error',
          message: 'Motion evaluation produced a non-finite value.',
          hint: 'Reduce the range magnitudes or extrapolation distance and use an easing that returns finite values.',
        },
      };
};
