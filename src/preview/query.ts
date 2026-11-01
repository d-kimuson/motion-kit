import { z } from 'zod';

import { type Result } from '../lib/result.ts';

/** Playback samples this many frames per second unless the query says otherwise. */
export const defaultPreviewFps = 12;

/** The rates playback may sample at; `--preview-fps` takes the same range. */
export const previewFpsSchema = z.int().min(1).max(60);
const propsSchema = z.record(z.string(), z.unknown());
/** The selection a preview host page carries in its query, so the server keeps none. */
const previewQuerySchema = z
  .object({
    compositionId: z.string().optional(),
    props: propsSchema.readonly(),
    fps: previewFpsSchema,
  })
  .readonly();
export type PreviewQuery = z.infer<typeof previewQuerySchema>;

const fpsSchema = z.coerce.number().pipe(previewFpsSchema);
const invalid = (message: string, hint: string): Result<never> => ({
  ok: false,
  error: { code: 'cli.invalid-arguments', severity: 'error', message, hint },
});

export const parsePreviewQuery = (search: string): Result<PreviewQuery> => {
  const params = new URLSearchParams(search);
  const compositionId = params.get('composition') ?? undefined;
  const fpsText = params.get('fps');
  const fps = fpsSchema.safeParse(fpsText ?? defaultPreviewFps);
  if (!fps.success)
    return invalid(`Preview fps "${fpsText ?? ''}" is invalid.`, 'Use an integer from 1 to 60.');
  const propsText = params.get('props');
  let props: unknown = {};
  if (propsText !== null)
    try {
      props = JSON.parse(propsText);
    } catch {
      return invalid('Preview props are not valid JSON.', 'Pass props as a JSON object.');
    }
  const record = propsSchema.safeParse(props);
  if (!record.success)
    return invalid('Preview props must be a JSON object.', 'Pass props as a JSON object.');
  return {
    ok: true,
    value: {
      ...(compositionId === undefined ? {} : { compositionId }),
      props: record.data,
      fps: fps.data,
    },
  };
};

/** `search` with the chosen Composition in it, so a page reload keeps the choice. */
export const withCompositionId = (search: string, compositionId: string): string => {
  const params = new URLSearchParams(search);
  params.set('composition', compositionId);
  return `?${params.toString()}`;
};

/** The query `parsePreviewQuery` reads back; defaults are left out. */
export const previewQueryString = (query: PreviewQuery): string => {
  const params = new URLSearchParams();
  if (query.compositionId !== undefined) params.set('composition', query.compositionId);
  if (Object.keys(query.props).length > 0) params.set('props', JSON.stringify(query.props));
  if (query.fps !== defaultPreviewFps) params.set('fps', String(query.fps));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
};
