// The voice track, as data on the Composition (the render audio muxing ADR).
//
// Audio is a descriptor field, not a prop: `defineComposition` freezes it at declaration, so it
// cannot switch on `--props`. The explainer therefore declares one clip per line at the line's
// frame-derived start — the same starts the subtitle and sprite `Sequence`s use — and
// `fetch-assets.ts` writes the files the declaration names:
//
//   step 1  silent placeholders (`anullsrc`), so a placeholder render is silent, not a link error;
//   step 2  VOICEVOX, or `say -v Kyoko` where no engine is installed, into the same paths.
//
// `endInFrames` is a guard, not a cut: `fetch-assets.ts` fits every clip to its line's `seconds`
// (step 2, local only), so the voice starts on the line's frame and stops where the subtitle and the
// sprite do. The bound stays because the timeline is frame-derived: a clip that ever ran long must
// not talk over the line that follows it.
import { type AudioTrack } from '@kimuson/motion-kit';

import { voiceSource } from './look.ts';
import { type Storyboard } from './plan.ts';

/** One clip per line, in line order, at the frame the line's `Sequence` starts. */
export const voiceTracks = (storyboard: Storyboard): readonly AudioTrack[] =>
  storyboard.lines.map((line) => ({
    src: voiceSource(line.id),
    startInFrames: line.startFrame,
    endInFrames: line.startFrame + line.frames,
  }));
