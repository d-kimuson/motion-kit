// Every scene renders, and every beat it keys to a phrase finds that phrase in the narration.
//
// A scene times its beats to the words a sentence says (`clock.at('…')`). A phrase the script does
// not narrate is not an error at render time — the beat is simply already over — so a rewritten line
// would leave its animation silently frozen. Rendering each slide here with a `missing` collector
// turns that into a failing test. The scenes take their clock as a prop, so `renderToStaticMarkup`
// draws them without a timeline.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { advanceEm } from '../layout.ts';
import { ciStoryboard, explainerStoryboard, type PlannedSlide } from '../plan.ts';
import { SceneFor } from './Scene.tsx';
import { AGENDA_SIZE, AGENDA_TEXT_WIDTH } from './TitleScene.tsx';

/** Draw `slide` at a spread of its own times, and return the phrases it asked for and did not find. */
const drawAcross = (slide: PlannedSlide, fps: number): readonly string[] => {
  const missing: string[] = [];
  const seconds = slide.frames / fps;
  for (const time of [0, 0.5, seconds / 3, seconds / 2, seconds - 0.1]) {
    const markup = renderToStaticMarkup(createElement(SceneFor, { slide, time, fps, missing }));
    expect(markup.length).toBeGreaterThan(0);
    expect(markup).not.toContain('NaN');
  }
  return [...new Set(missing)];
};

describe('explainer scenes', () => {
  const full = explainerStoryboard(30);
  for (const slide of full.slides)
    it(`draws ${slide.cue.kind} with every phrase it keys to narrated`, () => {
      expect(drawAcross(slide, full.fps)).toEqual([]);
    });

  // A card sets its chapter title on one line (`nowrap`), so a longer title would run out of the card.
  it('fits every agenda title on one line of its card', () => {
    const agenda = full.slides.flatMap((slide) =>
      slide.cue.kind === 'title' ? slide.cue.agenda : [],
    );
    expect(agenda.length).toBeGreaterThan(0);
    expect(agenda.filter((item) => advanceEm(item) * AGENDA_SIZE > AGENDA_TEXT_WIDTH)).toEqual([]);
  });

  // `explainer-ci` narrates one line of the summary, so the beats keyed to the others are already
  // over: the checklist draws its finished state, which is what a 2-second twin should show.
  it('draws the slides of the CI storyboard', () => {
    const ci = ciStoryboard();
    expect(ci.slides.map((slide) => drawAcross(slide, ci.fps).length)).toHaveLength(2);
  });
});
