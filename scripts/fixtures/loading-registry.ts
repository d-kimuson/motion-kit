import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

export const compositions = defineCompositions([
  defineComposition({
    id: 'graph',
    width: 1,
    height: 1,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 1,
    schema: z.object({}),
    component: () => null,
  }),
]);
