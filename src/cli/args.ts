import { z } from 'zod';

import { checkHistories, type CheckHistory } from '../render/check/history.ts';
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
const rendererConfig = {
  projectRoot: z.string().optional(),
  viteConfig: z.string().optional(),
  softwareWebgl: z.boolean().optional(),
  disableSandbox: z.boolean().optional(),
};

export const RenderArgsSchema = z.strictObject({
  command: z.literal('render'),
  ...rendererConfig,
  entry,
  composition,
  out,
  props: propsText.optional(),
  /** Renderers capturing at once; half the machine's parallelism when omitted. */
  concurrency: z.coerce.number().int().positive().optional(),
  videoCrf: z
    .string()
    .regex(/^(?:[0-9]|[1-4][0-9]|5[01])$/u, 'Use --video-crf with an integer from 0 to 51.')
    .transform(Number)
    .optional(),
  videoBitrate: z
    .string()
    .regex(/^[1-9][0-9]*$/u, 'Use --video-bitrate with a positive integer in kbps.')
    .transform(Number)
    .pipe(z.number().int())
    .optional(),
  scale: z
    .string()
    .regex(/^(?:\d+(?:\.\d+)?|\d+x\d+)$/u, 'Use --scale with a positive factor or WxH.')
    .optional(),
  fps: z
    .string()
    .regex(
      /^(?:\d+(?:\.\d+)?|\d+\/\d+)$/u,
      'Use --fps with a positive decimal or numerator/denominator.',
    )
    .optional(),
  json,
});

export const FrameArgsSchema = z.strictObject({
  command: z.literal('frame'),
  ...rendererConfig,
  entry,
  composition,
  out,
  frame: z
    .array(z.string())
    .min(1)
    .transform((values, context) => {
      const frames: number[] = [];
      for (const value of values.flatMap((item) => item.split(','))) {
        const number = Number(value);
        if (!/^-?\d+$/u.test(value) || !Number.isSafeInteger(number)) {
          context.addIssue({
            code: 'custom',
            message: `Frame ${JSON.stringify(value)} must be a safe integer.`,
          });
        } else if (number < 0) {
          context.addIssue({ code: 'custom', message: `Frame ${value} must not be negative.` });
        } else if (frames.includes(number)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate frame ${value}; pass each frame once.`,
          });
        } else frames.push(number);
      }
      return frames.sort((a, b) => a - b);
    }),
  props: propsText.optional(),
  json,
});

const docsTopic = z.string().min(1).optional();

const safeFrame = (value: string, context: z.RefinementCtx): number | undefined => {
  const number = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number)) {
    context.addIssue({
      code: 'custom',
      message: `Frame ${JSON.stringify(value)} must be a nonnegative safe integer.`,
    });
    return undefined;
  }
  return number;
};

const frameList = z
  .array(z.string())
  .min(1)
  .transform((values, context) => {
    const frames: number[] = [];
    for (const value of values.flatMap((item) => item.split(','))) {
      const number = safeFrame(value, context);
      if (number === undefined) continue;
      if (frames.includes(number))
        context.addIssue({
          code: 'custom',
          message: `Duplicate frame ${value}; pass each frame once.`,
        });
      else frames.push(number);
    }
    return frames.sort((a, b) => a - b);
  });

const optionalFrameList = z
  .array(z.string())
  .transform((values, context) => {
    if (values.length === 0) return undefined;
    const frames: number[] = [];
    for (const value of values.flatMap((item) => item.split(','))) {
      const number = safeFrame(value, context);
      if (number === undefined) continue;
      if (frames.includes(number))
        context.addIssue({
          code: 'custom',
          message: `Duplicate frame ${value}; pass each frame once.`,
        });
      else frames.push(number);
    }
    return frames.sort((a, b) => a - b);
  })
  .optional();

const isCheckHistory = (value: string): value is CheckHistory =>
  checkHistories.some((history) => history === value);

const historyList = z
  .array(z.string())
  .transform((values, context) => {
    if (values.length === 0) return undefined;
    const histories: CheckHistory[] = [];
    for (const value of values.flatMap((item) => item.split(','))) {
      if (!isCheckHistory(value)) {
        context.addIssue({
          code: 'custom',
          message: `Unknown history ${JSON.stringify(value)}; choose one of: ${checkHistories.join(', ')}.`,
        });
      } else if (histories.includes(value)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate history ${value}; pass each history once.`,
        });
      } else histories.push(value);
    }
    return histories;
  })
  .optional();

const channelTolerance = z
  .string()
  .regex(/^\d+$/u, 'Use --channel-tolerance with an integer from 0 to 255.')
  .transform(Number)
  .pipe(z.number().int().min(0).max(255))
  .optional();

const changedRatio = z
  .string()
  .regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/u, 'Use --changed-ratio with a number from 0 to 1.')
  .transform(Number)
  .pipe(z.number().min(0).max(1))
  .optional();

export const CheckArgsSchema = z
  .strictObject({
    command: z.literal('check'),
    ...rendererConfig,
    entry,
    composition,
    frame: frameList,
    predecessor: optionalFrameList,
    history: historyList,
    exact: z.boolean(),
    channelTolerance,
    changedRatio,
    props: propsText.optional(),
    json,
  })
  .superRefine((args, context) => {
    if (args.exact && (args.channelTolerance !== undefined || args.changedRatio !== undefined))
      context.addIssue({
        code: 'custom',
        path: ['exact'],
        message: 'Use --exact or a pixel tolerance, not both.',
      });
  });

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
  CheckArgsSchema,
]);

export type RenderArgs = z.infer<typeof RenderArgsSchema>;
export type FrameArgs = z.infer<typeof FrameArgsSchema>;
export type DocsArgs = z.infer<typeof DocsArgsSchema>;
export type CheckArgs = z.infer<typeof CheckArgsSchema>;
export type CliArgs = z.infer<typeof CliArgsSchema>;
