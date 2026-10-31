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

const frameShape = {
  output: outputPath,
  frame: z.int().nonnegative(),
  timeSeconds: z.number().nonnegative(),
  ...dimensions,
};

export const FrameDataSchema = z.discriminatedUnion('format', [
  z.strictObject({ ...frameShape, format: z.literal('png') }),
  z.strictObject({
    output: outputPath,
    format: z.literal('png-sequence'),
    frames: z.array(z.strictObject(frameShape)),
  }),
]);

// The shipped guides, addressed by file stem. `index` is `docs/index.md`; every other id is
// `docs/guide/<id>.md`. The order is the one `docs --list` prints and the error hint repeats.
export const DocsTopicSchema = z.enum([
  'index',
  'getting-started',
  'cli',
  'authoring',
  'three',
  'determinism',
  'examples',
  'troubleshooting',
]);
export type DocsTopic = z.infer<typeof DocsTopicSchema>;

export const DocsDataSchema = z.discriminatedUnion('format', [
  z.strictObject({
    format: z.literal('markdown'),
    topic: DocsTopicSchema,
    content: z.string(),
  }),
  z.strictObject({
    format: z.literal('list'),
    topics: z.array(z.strictObject({ id: DocsTopicSchema, summary: z.string().min(1) })),
  }),
]);

const checkComparison = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('exact') }),
  z.strictObject({
    mode: z.literal('pixels'),
    channelTolerance: z.int().min(0).max(255),
    maxChangedRatio: z.number().min(0).max(1),
    alpha: z.literal('ignore'),
  }),
]);

const checkDifference = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('exact'),
    differentBytes: z.int().nonnegative(),
    referenceBytes: z.int().nonnegative(),
    actualBytes: z.int().nonnegative(),
  }),
  z.strictObject({
    mode: z.literal('pixels'),
    totalPixels: z.int().nonnegative(),
    changedPixels: z.int().nonnegative(),
    changedRatio: z.number().min(0).max(1),
    maxChannelDelta: z.int().nonnegative(),
  }),
  z.strictObject({
    mode: z.literal('dimensions'),
    reference: z.strictObject(dimensions),
    actual: z.strictObject(dimensions),
  }),
]);

const checkHistory = z.enum(['cold', 'after-earlier', 'after-later', 'pool']);

export const CheckDataSchema = z.strictObject({
  format: z.literal('check'),
  composition: z.string().min(1),
  ...dimensions,
  fps: z.strictObject({ numerator: z.int().positive(), denominator: z.int().positive() }),
  frameCount: z.int().nonnegative(),
  comparison: checkComparison,
  samples: z.array(
    z.strictObject({
      frame: z.int().nonnegative(),
      ...dimensions,
      histories: z.array(
        z.strictObject({
          history: checkHistory,
          predecessor: z.int().nonnegative().nullable(),
          ...dimensions,
          status: z.enum(['reference', 'identical', 'within-tolerance', 'differs']),
          difference: checkDifference.nullable(),
        }),
      ),
    }),
  ),
});

/** `motion-kit preview` writes this once the preview host is listening; it then serves until stopped. */
export const PreviewDataSchema = z.strictObject({
  format: z.literal('preview'),
  /** The preview host page, its selection (Composition, props, preview fps) in the query. */
  url: z.string().min(1),
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
export const CommandSchema = z.enum([
  'render',
  'frame',
  'docs',
  'check',
  'preview',
  'inspect',
  'validate',
]);
export type Command = z.infer<typeof CommandSchema>;

/** The envelope's own reading of `command`: a known subcommand, or null when argv named none. */
export const EnvelopeCommandSchema = CommandSchema.nullable();

export const EnvelopeSchema = z
  .discriminatedUnion('command', [
    z.strictObject({ ...common, command: z.literal('render'), data: RenderDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('frame'), data: FrameDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('docs'), data: DocsDataSchema.nullable() }),
    z.strictObject({ ...common, command: z.literal('check'), data: CheckDataSchema.nullable() }),
    z.strictObject({
      ...common,
      command: z.literal('preview'),
      data: PreviewDataSchema.nullable(),
    }),
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
export type DocsData = z.infer<typeof DocsDataSchema>;
export type CheckData = z.infer<typeof CheckDataSchema>;
export type PreviewData = z.infer<typeof PreviewDataSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
