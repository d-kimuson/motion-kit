import { z } from 'zod';

import { DiagnosticSchema } from '../lib/diagnostic.ts';

const outputPath = z
  .string()
  .regex(/^(?:\/|[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+(?:\\|$))/, 'Expected an absolute output path');
const dimensions = { width: z.int().positive(), height: z.int().positive() };
const videoShape = {
  ...dimensions,
  fps: z.strictObject({ numerator: z.int().positive(), denominator: z.int().positive() }),
  frameCount: z.int().nonnegative(),
  durationSeconds: z.number().nonnegative(),
};

// Encoding is TASK-150/159; until it lands, `render` honestly produces a frame
// sequence into a directory plus a manifest. The `mp4` variant stays reserved
// for the encoder without bumping schemaVersion (an added value is compatible).
export const RenderDataSchema = z.discriminatedUnion('format', [
  z.strictObject({
    output: outputPath,
    format: z.literal('mp4'),
    ...videoShape,
  }),
  z.strictObject({
    output: outputPath,
    format: z.literal('frames'),
    manifest: outputPath,
    ...videoShape,
  }),
]);

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

/** The known subcommands. `command` is this enum or null, never a sentinel member. */
export const CommandSchema = z.enum(['render', 'frame', 'inspect', 'validate']);
export type Command = z.infer<typeof CommandSchema>;

/** The envelope's own reading of `command`: a known subcommand, or null when argv named none. */
export const EnvelopeCommandSchema = CommandSchema.nullable();

export const EnvelopeSchema = z
  .discriminatedUnion('command', [
    z.strictObject({ ...common, command: z.literal('render'), data: RenderDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('frame'), data: FrameDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('inspect'), data: deferredData.nullable() }),
    z.strictObject({ ...common, command: z.literal('validate'), data: deferredData.nullable() }),
    // No subcommand could be identified from argv (`motion-kit --json`, `motion-kit unknown --json`).
    // A discriminated union needs a literal per member, so this is `z.null()` rather than
    // `EnvelopeCommandSchema`; no producer can name a command that was not invoked, so `data` is
    // null too. The nullable enum is the exported type, not a fifth command.
    z.strictObject({ ...common, command: z.null(), data: z.null() }),
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
