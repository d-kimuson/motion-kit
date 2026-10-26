import { z } from 'zod';

import { defineComposition, defineCompositions } from '../../../core/composition/registry.ts';
import { useFrame } from '../../../core/timeline/hooks.ts';

// A flat background with a moving square, plus audio declared as data. The clips themselves are
// generated locally by the tests (FFmpeg `sine`) and never committed: the project-root-relative
// `src` is what production reads too.
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
  // 60 frames at 20 fps: onsets at frames 10 (0.5 s) and 30 (1.5 s), and 3 s of audio.
  defineComposition({
    id: 'audio',
    component: Scene,
    schema,
    width: 160,
    height: 120,
    fps: { numerator: 20, denominator: 1 },
    durationInFrames: 60,
    audio: [
      { src: 'audio/clip-1.wav', startInFrames: 10 },
      { src: 'audio/clip-2.wav', startInFrames: 30, volume: 0.5 },
    ],
  }),
  // The same declaration with a source that does not exist: `asset.load-failed` names the file.
  defineComposition({
    id: 'audio-missing',
    component: Scene,
    schema,
    width: 160,
    height: 120,
    fps: { numerator: 20, denominator: 1 },
    durationInFrames: 20,
    audio: [{ src: 'audio/absent.wav' }],
  }),
]);
