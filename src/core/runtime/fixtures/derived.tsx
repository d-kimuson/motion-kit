import { z } from 'zod';

import { defineComposition, defineCompositions } from '../../composition/registry.ts';
import { useTimeline } from '../../timeline/hooks.ts';

/** Props stand in for a generated script: the duration is data the entry no longer imports. */
const schema = z.object({
  frames: z.number().int().nonnegative().default(6),
  fail: z.enum(['reported', 'thrown', 'hang']).optional(),
});

const Scene = (_props: z.infer<typeof schema>) => {
  const { durationInFrames, width, height } = useTimeline();
  return (
    <div
      style={{ width: '100%', height: '100%', background: '#3366cc' }}
      data-duration-in-frames={durationInFrames}
      data-size={`${width}x${height}`}
    />
  );
};

export const compositions = defineCompositions([
  defineComposition({
    id: 'derived',
    component: Scene,
    schema,
    width: 32,
    height: 32,
    fps: { numerator: 30, denominator: 1 },
    // The declared 1 frame is only a baseline: resolveMetadata replaces it from the props.
    durationInFrames: 1,
    resolveMetadata: ({ props }) => {
      if (props.fail === 'reported')
        return {
          ok: false,
          error: {
            code: 'render.page-error',
            severity: 'error',
            message: 'The generated script could not be read.',
            hint: 'Check the generated script path.',
          },
        };
      if (props.fail === 'thrown') throw new Error('generated script unavailable');
      // A resolver that never settles, for the loading deadline of a real host.
      if (props.fail === 'hang') return new Promise(() => {});
      return { ok: true, value: { durationInFrames: props.frames } };
    },
  }),
]);
