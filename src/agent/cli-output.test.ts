// Exercise the package export, rather than making the contract a private deep import.
import {
  EnvelopeSchema,
  FrameDataSchema,
  RenderDataSchema,
  type Envelope,
} from '@kimuson/motion-kit/agent';
import { Ajv2020 } from 'ajv/dist/2020.js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { DiagnosticCodeSchema } from '../index.ts';
import { createCliOutputJsonSchema } from './cli-output-json-schema.ts';

const jsonSchema = createCliOutputJsonSchema();
// Conditional constraints apply to a root union, not a root object type.
const validateJson = new Ajv2020({ strictTypes: false }).compile(jsonSchema);

const renderData = {
  output: '/tmp/intro.mp4',
  format: 'mp4',
  width: 1920,
  height: 1080,
  fps: { numerator: 30, denominator: 1 },
  frameCount: 300,
  durationSeconds: 10,
};
const frameData = {
  output: '/tmp/intro.png',
  format: 'png',
  frame: 150,
  timeSeconds: 5,
  width: 1920,
  height: 1080,
};
const base = {
  schemaVersion: 1,
  command: 'render',
  ok: true,
  data: renderData,
  diagnostics: [],
  durationMs: 1234,
};
const error = {
  code: 'asset.load-failed',
  severity: 'error',
  message: 'The image could not be loaded.',
  hint: 'Check the path.',
};

const diagnosticArbitrary = fc.record({
  code: fc.constantFrom(...DiagnosticCodeSchema.options),
  severity: fc.constantFrom('error', 'warning', 'info'),
  message: fc.string({ minLength: 1 }),
  hint: fc.string({ minLength: 1 }),
});

describe('CLI output v1', () => {
  it('keeps the committed JSON Schema in sync with Zod', () => {
    expect(committedSchema).toEqual(jsonSchema);
  });

  it.each([
    ['render', renderData],
    ['frame', frameData],
    ['inspect', {}],
    ['validate', { future: ['data'] }],
  ])('accepts the %s command data', (command, data) => {
    const payload = { ...base, command, data };
    expect(EnvelopeSchema.safeParse(payload).success).toBe(true);
    expect(validateJson(payload)).toBe(true);
  });

  it('infers command-specific data from the envelope', () => {
    const parsed: Envelope = EnvelopeSchema.parse(base);
    expect(parsed.command === 'render' && parsed.data?.fps).toEqual({
      numerator: 30,
      denominator: 1,
    });
    expect(RenderDataSchema.parse(renderData)).toEqual(renderData);
    expect(FrameDataSchema.parse(frameData)).toEqual(frameData);
  });

  it('requires ok to agree with every generated diagnostic list', () => {
    fc.assert(
      fc.property(fc.array(diagnosticArbitrary), (diagnostics) => {
        const ok = diagnostics.every((diagnostic) => diagnostic.severity !== 'error');
        const payload = { ...base, diagnostics, ok };
        expect(EnvelopeSchema.safeParse(payload).success).toBe(true);
        expect(validateJson(payload)).toBe(true);
        expect(EnvelopeSchema.safeParse({ ...payload, ok: !ok }).success).toBe(false);
        expect(validateJson({ ...payload, ok: !ok })).toBe(false);
      }),
    );
  });

  it.each([
    { ...base, diagnostics: [{ ...error, severity: 'warning' }] },
    {
      ...base,
      diagnostics: [
        { code: 'seek.uncontrolled', severity: 'info', message: 'An integration is unused.' },
      ],
    },
    { ...base, ok: false, diagnostics: [error], data: null },
    { ...base, ok: false, diagnostics: [error] },
    { ...base, data: { ...renderData, fps: { numerator: 30000, denominator: 1001 } } },
    { ...base, data: { ...renderData, output: 'C:\\videos\\intro.mp4' } },
    { ...base, data: { ...renderData, output: '\\\\server\\share\\intro.mp4' } },
  ])('accepts warnings, infos, partial failures and rational fps: %j', (payload) => {
    expect(EnvelopeSchema.safeParse(payload).success).toBe(true);
    expect(validateJson(payload)).toBe(true);
  });

  it.each([
    { ...base, ok: false },
    { ...base, diagnostics: [error] },
    { ...base, data: null },
    { ...base, data: undefined },
    { ...base, schemaVersion: 2 },
    { ...base, command: 'preview' },
    { ...base, durationMs: -1 },
    { ...base, data: frameData },
    { ...base, command: 'frame' },
    { ...base, command: 'inspect', data: [] },
    { ...base, data: { ...renderData, fps: 30 } },
    { ...base, data: { ...renderData, fps: { numerator: 30, denominator: 0 } } },
    { ...base, data: { ...renderData, fps: { numerator: 29.97, denominator: 1 } } },
    { ...base, data: { ...renderData, width: 0 } },
    { ...base, data: { ...renderData, frameCount: 1.5 } },
    { ...base, data: { ...renderData, output: './intro.mp4' } },
    { ...base, data: { ...renderData, output: 'C:relative.mp4' } },
    { ...base, command: 'frame', data: { ...frameData, frame: 1.5 } },
    { ...base, command: 'frame', data: { ...frameData, format: 'jpeg' } },
    { ...base, diagnostics: [{ ...error, severity: 'warning', hint: undefined }] },
    { ...base, ok: false, diagnostics: [{ ...error, hint: undefined }] },
    { ...base, ok: false, diagnostics: [{ ...error, code: 'asset.load_failed' }] },
    { ...base, ok: false, diagnostics: [{ ...error, code: 'plugin.load-failed' }] },
    { ...base, ok: false, diagnostics: [{ ...error, code: 'asset.future-code' }] },
    { ...base, ok: false, diagnostics: [{ ...error, location: { frame: 1.5 } }] },
    { ...base, stack: 'Error: bug' },
  ])('rejects an invalid contract in both validators: %j', (payload) => {
    expect(EnvelopeSchema.safeParse(payload).success).toBe(false);
    expect(validateJson(payload)).toBe(false);
  });
});
