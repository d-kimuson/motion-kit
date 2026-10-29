import { describe, expect, it } from 'vitest';

import {
  checkComparisonDiagnostic,
  compareCaptures,
  comparePng,
  type CheckComparison,
} from './compare.ts';
import { encodePng } from './png-fixture.ts';

const pixelsComparison: CheckComparison = {
  mode: 'pixels',
  channelTolerance: 32,
  maxChangedRatio: 0.002,
  alpha: 'ignore',
};

const rgb = (width: number, height: number, fill = 0): Uint8Array =>
  new Uint8Array(width * height * 3).fill(fill);

const rgba = (width: number, height: number, fill = 0): Uint8Array =>
  new Uint8Array(width * height * 4).fill(fill);

const rgbPng = (width: number, height: number, pixels: Uint8Array): Uint8Array =>
  encodePng({ width, height, colorType: 2, pixels });

const rgbaPng = (width: number, height: number, pixels: Uint8Array): Uint8Array =>
  encodePng({ width, height, colorType: 6, pixels });

const setChannel = (pixels: Uint8Array, pixel: number, channel: number, value: number): void => {
  pixels[pixel * 3 + channel] = value;
};

describe('comparePng exact mode', () => {
  it('reports byte identity without decoding', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(comparePng(bytes, bytes, { mode: 'exact' })).toEqual({
      status: 'identical',
      difference: {
        mode: 'exact',
        differentBytes: 0,
        referenceBytes: 4,
        actualBytes: 4,
      },
    });
  });

  it('reports differing bytes and lengths', () => {
    expect(
      comparePng(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]), { mode: 'exact' }),
    ).toEqual({
      status: 'differs',
      difference: {
        mode: 'exact',
        differentBytes: 1,
        referenceBytes: 3,
        actualBytes: 3,
      },
    });
    expect(
      comparePng(new Uint8Array([1]), new Uint8Array([1, 2]), { mode: 'exact' }),
    ).toMatchObject({
      status: 'differs',
      difference: { mode: 'exact', differentBytes: 1, referenceBytes: 2, actualBytes: 1 },
    });
  });
});

describe('comparePng pixel mode', () => {
  it('treats a delta equal to channelTolerance as unchanged', () => {
    const reference = rgbPng(1, 1, rgb(1, 1, 100));
    const actualPixels = rgb(1, 1, 100);
    setChannel(actualPixels, 0, 0, 132);
    const actual = rgbPng(1, 1, actualPixels);
    expect(comparePng(actual, reference, pixelsComparison)).toEqual({
      status: 'identical',
      difference: {
        mode: 'pixels',
        totalPixels: 1,
        changedPixels: 0,
        changedRatio: 0,
        maxChannelDelta: 32,
      },
    });
  });

  it('treats a delta of channelTolerance + 1 as changed', () => {
    const reference = rgbPng(1, 1, rgb(1, 1, 100));
    const actualPixels = rgb(1, 1, 100);
    setChannel(actualPixels, 0, 0, 133);
    const actual = rgbPng(1, 1, actualPixels);
    expect(comparePng(actual, reference, pixelsComparison)).toEqual({
      status: 'differs',
      difference: {
        mode: 'pixels',
        totalPixels: 1,
        changedPixels: 1,
        changedRatio: 1,
        maxChannelDelta: 33,
      },
    });
  });

  it('accepts changedRatio equal to maxChangedRatio and rejects one pixel more', () => {
    const reference = rgbPng(500, 1, rgb(500, 1));
    const atBoundaryPixels = rgb(500, 1);
    setChannel(atBoundaryPixels, 10, 1, 40);
    const atBoundary = rgbPng(500, 1, atBoundaryPixels);
    expect(comparePng(atBoundary, reference, pixelsComparison)).toEqual({
      status: 'within-tolerance',
      difference: {
        mode: 'pixels',
        totalPixels: 500,
        changedPixels: 1,
        changedRatio: 0.002,
        maxChannelDelta: 40,
      },
    });
    const beyondBoundaryPixels = rgb(500, 1);
    setChannel(beyondBoundaryPixels, 10, 1, 40);
    setChannel(beyondBoundaryPixels, 20, 1, 40);
    const beyondBoundary = rgbPng(500, 1, beyondBoundaryPixels);
    expect(comparePng(beyondBoundary, reference, pixelsComparison)).toEqual({
      status: 'differs',
      difference: {
        mode: 'pixels',
        totalPixels: 500,
        changedPixels: 2,
        changedRatio: 0.004,
        maxChannelDelta: 40,
      },
    });
  });

  it('reports maxChannelDelta even within tolerance', () => {
    const reference = rgbPng(2, 1, rgb(2, 1, 100));
    const actualPixels = rgb(2, 1, 100);
    setChannel(actualPixels, 0, 0, 120);
    setChannel(actualPixels, 1, 2, 125);
    const actual = rgbPng(2, 1, actualPixels);
    expect(comparePng(actual, reference, pixelsComparison)).toMatchObject({
      status: 'identical',
      difference: { mode: 'pixels', changedPixels: 0, maxChannelDelta: 25 },
    });
  });

  it('ignores the alpha channel', () => {
    const reference = rgbaPng(1, 1, rgba(1, 1, 0));
    const actualPixels = rgba(1, 1, 0);
    actualPixels[0] = 10;
    actualPixels[1] = 20;
    actualPixels[2] = 30;
    actualPixels[3] = 255;
    const actual = rgbaPng(1, 1, actualPixels);
    expect(comparePng(actual, reference, pixelsComparison)).toEqual({
      status: 'identical',
      difference: {
        mode: 'pixels',
        totalPixels: 1,
        changedPixels: 0,
        changedRatio: 0,
        maxChannelDelta: 30,
      },
    });
  });

  it('reports a dimension mismatch as its own difference mode', () => {
    expect(comparePng(rgbPng(1, 2, rgb(1, 2)), rgbPng(2, 1, rgb(2, 1)), pixelsComparison)).toEqual({
      status: 'differs',
      difference: {
        mode: 'dimensions',
        reference: { width: 2, height: 1 },
        actual: { width: 1, height: 2 },
      },
    });
  });

  it('compares RGB channels when only one capture stores alpha', () => {
    const reference = rgbaPng(1, 1, new Uint8Array([10, 20, 30, 40]));
    const actual = rgbPng(1, 1, new Uint8Array([10, 20, 30]));
    expect(comparePng(actual, reference, pixelsComparison)).toMatchObject({
      status: 'identical',
      difference: { mode: 'pixels', totalPixels: 1, changedPixels: 0, maxChannelDelta: 0 },
    });
  });
});

describe('compareCaptures', () => {
  it('converts an undecodable capture to internal.unexpected in pixel mode', () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    const result = compareCaptures(garbage, rgbPng(1, 1, rgb(1, 1)), pixelsComparison);
    expect(result).toMatchObject({
      ok: false,
      error: [{ code: 'internal.unexpected', severity: 'error' }],
    });
    if (result.ok) throw new Error('The garbage capture was compared');
    expect(result.error[0]?.message).toBe('The checker could not compare two captures.');
    expect(result.error[0]?.hint).toContain('Report this as a motion-kit bug');
  });

  it('compares a valid PNG like comparePng', () => {
    const reference = rgbPng(1, 1, rgb(1, 1, 100));
    const actual = rgbPng(1, 1, rgb(1, 1, 100));
    expect(compareCaptures(actual, reference, pixelsComparison)).toEqual({
      ok: true,
      value: comparePng(actual, reference, pixelsComparison),
    });
  });

  it('never decodes in exact mode', () => {
    const garbage = new Uint8Array([1, 2, 3, 4]);
    expect(compareCaptures(garbage, garbage, { mode: 'exact' })).toMatchObject({
      ok: true,
      value: { status: 'identical', difference: { mode: 'exact', differentBytes: 0 } },
    });
    expect(compareCaptures(new Uint8Array([9]), garbage, { mode: 'exact' })).toMatchObject({
      ok: true,
      value: { status: 'differs', difference: { mode: 'exact', differentBytes: 4 } },
    });
  });
});

describe('checkComparisonDiagnostic', () => {
  it('accepts both valid comparison modes', () => {
    expect(checkComparisonDiagnostic({ mode: 'exact' })).toBeUndefined();
    expect(checkComparisonDiagnostic(pixelsComparison)).toBeUndefined();
    expect(
      checkComparisonDiagnostic({
        mode: 'pixels',
        channelTolerance: 0,
        maxChangedRatio: 1,
        alpha: 'ignore',
      }),
    ).toBeUndefined();
  });

  it('rejects out-of-range channel tolerances and ratios', () => {
    for (const channelTolerance of [-1, 256, 1.5, Number.NaN])
      expect(
        checkComparisonDiagnostic({
          mode: 'pixels',
          channelTolerance,
          maxChangedRatio: 0.5,
          alpha: 'ignore',
        }),
      ).toMatchObject({ code: 'cli.invalid-arguments' });
    for (const maxChangedRatio of [-0.1, 1.1, Number.NaN])
      expect(
        checkComparisonDiagnostic({
          mode: 'pixels',
          channelTolerance: 32,
          maxChangedRatio,
          alpha: 'ignore',
        }),
      ).toMatchObject({ code: 'cli.invalid-arguments' });
  });
});
