import { DiagnosticCodeSchema, DiagnosticSchema, LocationSchema } from '@kimuson/motion-kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const finding = { code: 'asset.load-failed', message: 'The image could not be loaded.' };

describe('Diagnostic', () => {
  it.each(['error', 'warning'] as const)('requires a hint for %s', (severity) => {
    expect(
      DiagnosticSchema.safeParse({ ...finding, severity, hint: 'Check the asset path.' }).success,
    ).toBe(true);
    expect(DiagnosticSchema.safeParse({ ...finding, severity }).success).toBe(false);
    expect(DiagnosticSchema.safeParse({ ...finding, severity, hint: '' }).success).toBe(false);
  });

  it('allows info with or without a hint', () => {
    expect(DiagnosticSchema.safeParse({ ...finding, severity: 'info' }).success).toBe(true);
    expect(
      DiagnosticSchema.safeParse({ ...finding, severity: 'info', hint: 'Check the path.' }).success,
    ).toBe(true);
  });

  it('reserves all initial codes and their namespaces', () => {
    // TASK-159 added `encode.ffmpeg-unsupported` and `encode.output-invalid` to the enum; Issue #60
    // added the three `check.*` codes the composition determinism checker reports.
    expect(DiagnosticCodeSchema.options).toHaveLength(25);
    const namespaces = [
      'cli',
      'composition',
      'motion',
      'asset',
      'render',
      'encode',
      'seek',
      'layout',
      'check',
      'internal',
    ];
    for (const code of DiagnosticCodeSchema.options) {
      expect(code).toMatch(/^[a-z]+(\.[a-z0-9-]+)+$/);
      expect(namespaces).toContain(code.split('.')[0]);
      expect(DiagnosticSchema.safeParse({ ...finding, code, severity: 'info' }).success).toBe(true);
    }
  });

  it.each([
    'asset',
    'Asset.load-failed',
    'asset.load_failed',
    'asset.',
    'plugin.load-failed',
    'asset.future-code',
  ])('rejects malformed, unreserved, or unregistered code %s', (code) => {
    expect(DiagnosticCodeSchema.safeParse(code).success).toBe(false);
    expect(DiagnosticSchema.safeParse({ ...finding, code, severity: 'info' }).success).toBe(false);
  });

  it('accepts a code iff it is in the single source enum', () => {
    fc.assert(
      fc.property(fc.string(), (code) => {
        expect(DiagnosticCodeSchema.safeParse(code).success).toBe(
          DiagnosticCodeSchema.options.some((registered) => registered === code),
        );
      }),
    );
  });

  it('allows absent, empty, partial and complete locations', () => {
    expect(LocationSchema.parse({})).toEqual({});
    expect(LocationSchema.parse({ sceneId: 'title' })).toEqual({ sceneId: 'title' });
    const location = {
      compositionId: 'Intro',
      sceneId: 'title',
      elementId: 'logo',
      file: 'src/Intro.tsx',
      line: 12,
      column: 5,
      frame: 150,
      timeSeconds: 5,
    };
    expect(DiagnosticSchema.parse({ ...finding, severity: 'info', location }).location).toEqual(
      location,
    );
  });

  it.each([{ frame: 1.5 }, { line: 0 }, { column: -1 }, { timeSeconds: Infinity }])(
    'rejects invalid location %j',
    (location) => {
      expect(LocationSchema.safeParse(location).success).toBe(false);
    },
  );

  it('allows JSON details, including serialized Zod issues, but not runtime values', () => {
    const issues = LocationSchema.safeParse({ frame: 'bad' }).error?.issues;
    const diagnostic = {
      ...finding,
      code: 'composition.props-invalid',
      severity: 'error',
      hint: 'Fix the props.',
      details: { issues },
    };
    expect(DiagnosticSchema.safeParse(diagnostic).success).toBe(true);
    expect(
      DiagnosticSchema.safeParse({ ...diagnostic, details: { callback: () => undefined } }).success,
    ).toBe(false);
    expect(DiagnosticSchema.safeParse({ ...diagnostic, stack: 'Error: bad' }).success).toBe(false);
  });
});
