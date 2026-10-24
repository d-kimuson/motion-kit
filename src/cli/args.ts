import { z } from 'zod';

// The argument contract is schema-first: commander only tokenizes argv, and
// these schemas validate and normalize every command invocation. The closed
// command enum matches the TASK-164 envelope (`inspect`/`validate` are later
// tasks and are not accepted here yet).

const jsonObject = z.record(z.string(), z.json());

const propsText = z
  .string()
  .transform((source, context) => {
    try {
      return JSON.parse(source) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: '--props must be a JSON object string.' });
      return z.NEVER;
    }
  })
  .pipe(jsonObject);

const entry = z.string().min(1);
const composition = z.string().min(1).optional();
const out = z.string().min(1);
const json = z.boolean();

export const RenderArgsSchema = z.strictObject({
  command: z.literal('render'),
  entry,
  composition,
  out,
  props: propsText.optional(),
  json,
});

export const FrameArgsSchema = z.strictObject({
  command: z.literal('frame'),
  entry,
  composition,
  out,
  frame: z.coerce.number().int().nonnegative(),
  json,
});

export const CliArgsSchema = z.discriminatedUnion('command', [RenderArgsSchema, FrameArgsSchema]);

export type RenderArgs = z.infer<typeof RenderArgsSchema>;
export type FrameArgs = z.infer<typeof FrameArgsSchema>;
export type CliArgs = z.infer<typeof CliArgsSchema>;
