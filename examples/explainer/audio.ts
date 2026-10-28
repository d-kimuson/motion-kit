// The soundtrack, as data on the Composition (the render audio muxing ADR): the narration, a quiet
// music bed under all of it, and a soft whoosh on every slide change.
//
// Audio is a descriptor field, not a prop: `defineComposition` freezes it at declaration, so it
// cannot switch on `--props`. Every file named here is written by `fetch-assets.ts`:
//
//   step 1  the music bed and the whoosh (synthesised by `synth.ts`), and a silent placeholder
//           (`anullsrc`) at every voice path, so a placeholder render has its music and no voice
//           rather than a link error;
//   step 2  the narration from VOICEVOX (or `say -v Kyoko`) over those placeholders.
//
// Each narration clip is fitted sentence by sentence to its line's slot (`fetch-assets.ts`), so the
// voice starts each sentence on the frame its subtitle does. `endInFrames` is a guard, not a cut:
// the timeline is frame-derived, and a clip that ever ran long must not talk over the next line.
import { type AudioTrack } from '@kimuson/motion-kit';

import { musicSource, voiceSource, whooshSource } from './look.ts';
import { type Storyboard } from './plan.ts';

/** The bed sits well under the voice: it fills the pauses without competing with a word. */
const MUSIC_VOLUME = 0.16;
const WHOOSH_VOLUME = 0.35;

/** How far ahead of a slide's first frame the whoosh starts, so its peak lands on the handoff. */
const WHOOSH_LEAD_FRAMES = 3;

/** One clip per line, in line order, at the frame the line starts. */
export const voiceTracks = (storyboard: Storyboard): readonly AudioTrack[] =>
  storyboard.lines.map((line) => ({
    src: voiceSource(line.id),
    startInFrames: line.startFrame,
    endInFrames: line.startFrame + line.frames,
  }));

/** The whole soundtrack: the narration, the bed for the video's whole length, a whoosh per handoff. */
export const soundtrack = (storyboard: Storyboard): readonly AudioTrack[] => [
  ...voiceTracks(storyboard),
  {
    src: musicSource,
    startInFrames: 0,
    endInFrames: storyboard.durationInFrames,
    volume: MUSIC_VOLUME,
  },
  ...storyboard.slides.slice(1).map((slide) => ({
    src: whooshSource,
    startInFrames: Math.max(0, slide.startFrame - WHOOSH_LEAD_FRAMES),
    volume: WHOOSH_VOLUME,
  })),
];
