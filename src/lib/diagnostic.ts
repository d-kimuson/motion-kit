import { z } from 'zod';

// Adding a code is compatible; renaming or removing one requires a schemaVersion bump.
export const DiagnosticCodeSchema = z.enum([
  'cli.invalid-arguments',
  'cli.entry-not-found',
  'cli.composition-not-found',
  'composition.props-invalid',
  'composition.duration-invalid',
  'motion.invalid-input',
  'motion.non-finite-result',
  'asset.load-failed',
  'asset.not-ready',
  'render.browser-launch-failed',
  'render.frame-timeout',
  'render.page-error',
  'encode.ffmpeg-not-found',
  'encode.ffmpeg-unsupported',
  'encode.ffmpeg-failed',
  'encode.output-invalid',
  'seek.uncontrolled',
  'layout.overflow',
  'layout.out-of-frame',
  'layout.unexpected-scroll',
  'layout.font-not-loaded',
  'check.frame-differs',
  'check.history-not-run',
  'check.uncontrolled-time',
  'internal.unexpected',
]);

export const LocationSchema = z.strictObject({
  compositionId: z.string().optional(),
  sceneId: z.string().optional(),
  elementId: z.string().optional(),
  file: z.string().optional(),
  line: z.int().positive().optional(),
  column: z.int().positive().optional(),
  frame: z.int().optional(),
  timeSeconds: z.number().optional(),
});

const finding = {
  code: DiagnosticCodeSchema,
  message: z.string().min(1).describe('One sentence describing the finding; never a stack trace.'),
  location: LocationSchema.optional(),
  details: z.record(z.string(), z.json()).optional(),
};

// A discriminated union keeps the hint requirement in both the type and JSON Schema.
export const DiagnosticSchema = z.discriminatedUnion('severity', [
  z.strictObject({ ...finding, severity: z.literal('error'), hint: z.string().min(1) }),
  z.strictObject({ ...finding, severity: z.literal('warning'), hint: z.string().min(1) }),
  z.strictObject({ ...finding, severity: z.literal('info'), hint: z.string().min(1).optional() }),
]);

export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
