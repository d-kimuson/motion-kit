import { z } from 'zod';

import { defineComposition, defineCompositions } from '../../../core/composition/registry.ts';
import { useFrame } from '../../../core/timeline/hooks.ts';

// A flat background with a moving square: pure in the frame, and cheap for H.264 to
// reproduce, so the decoded MP4 can be compared with the captured PNG within a tolerance.
const schema = z.object({});
const Scene = () => {
  const frame = useFrame();
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#204a87' }}>
      <div
        style={{
          position: 'absolute',
          left: 8 + (frame % 10) * 12,
          top: 40,
          width: 40,
          height: 40,
          background: '#f5f5f5',
        }}
      />
    </div>
  );
};

export const compositions = defineCompositions([
  defineComposition({
    id: 'video',
    component: Scene,
    schema,
    width: 160,
    height: 120,
    fps: { numerator: 20, denominator: 1 },
    durationInFrames: 40,
  }),
]);
