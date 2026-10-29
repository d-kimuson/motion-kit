import { z } from 'zod';

import { docsTopicIds, docsTopicsHint, isDocsTopic } from './docs.ts';

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
  /** Renderers capturing at once; half the machine's parallelism when omitted. */
  concurrency: z.coerce.number().int().positive().optional(),
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

const docsTopic = z.string().min(1).optional();

export const DocsArgsSchema = z
  .strictObject({
    command: z.literal('docs'),
    topic: docsTopic,
    list: z.boolean(),
    json,
  })
  .superRefine((args, context) => {
    if (args.topic !== undefined && !isDocsTopic(args.topic))
      context.addIssue({
        code: 'custom',
        path: ['topic'],
        message: `Unknown docs topic; choose one of: ${docsTopicIds.join(', ')}.`,
      });
    if (args.list && args.topic !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['topic'],
        message: `--list takes no topic; drop it to list the topics. ${docsTopicsHint()}`,
      });
  });

export const CliArgsSchema = z.discriminatedUnion('command', [
  RenderArgsSchema,
  FrameArgsSchema,
  DocsArgsSchema,
]);

export type RenderArgs = z.infer<typeof RenderArgsSchema>;
export type FrameArgs = z.infer<typeof FrameArgsSchema>;
export type DocsArgs = z.infer<typeof DocsArgsSchema>;
export type CliArgs = z.infer<typeof CliArgsSchema>;
