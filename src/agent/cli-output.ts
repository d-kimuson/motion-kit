import { z } from 'zod';

import { DiagnosticSchema } from '../lib/diagnostic.ts';

const outputPath = z
  .string()
  .regex(/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+(?:\\|$))/, 'Expected an absolute output path');
const dimensions = { width: z.int().positive(), height: z.int().positive() };

export const RenderDataSchema = z.strictObject({
  output: outputPath,
  format: z.literal('mp4'),
  ...dimensions,
  fps: z.strictObject({ numerator: z.int().positive(), denominator: z.int().positive() }),
  frameCount: z.int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
});

export const FrameDataSchema = z.strictObject({
  output: outputPath,
  format: z.literal('png'),
  frame: z.int().nonnegative(),
  timeSeconds: z.number().nonnegative(),
  ...dimensions,
});

const common = {
  schemaVersion: z.literal(1),
  ok: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  durationMs: z.number().nonnegative(),
};

// Inspect and validate own their future data contracts; only JSON objects are reserved here.
const deferredData = z.record(z.string(), z.json());

export const EnvelopeSchema = z
  .discriminatedUnion('command', [
    z.strictObject({ ...common, command: z.literal('render'), data: RenderDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('frame'), data: FrameDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('inspect'), data: deferredData.nullable() }),
    z.strictObject({ ...common, command: z.literal('validate'), data: deferredData.nullable() }),
  ])
  .superRefine((envelope, context) => {
    if (
      envelope.ok !== envelope.diagnostics.every((diagnostic) => diagnostic.severity !== 'error')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ok'],
        message: 'ok must be true iff no diagnostic has severity error',
      });
    }
    if (envelope.ok && envelope.data === null) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'Successful commands must produce data',
      });
    }
  });

export type RenderData = z.infer<typeof RenderDataSchema>;
export type FrameData = z.infer<typeof FrameDataSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
