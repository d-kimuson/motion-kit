// Which scene a slide's cue selects. The cue is the slide (`groupSlides` merges consecutive lines
// that carry the same one), so this is the whole dispatch: build the slide's clock, hand the cue of
// the matching kind to its scene. Pure in (slide, time), so the crossfade overlay and the slide's own
// scene draw the same picture, and the scene test can render every slide without a timeline.
import { type PlannedSlide } from '../plan.ts';
import { ChartScene } from './ChartScene.tsx';
import { CostScene } from './CostScene.tsx';
import { DisclaimerScene } from './DisclaimerScene.tsx';
import { IndexScene } from './IndexScene.tsx';
import { InstalmentScene } from './InstalmentScene.tsx';
import { sceneClock } from './kit.tsx';
import { RiskScene } from './RiskScene.tsx';
import { ScopeScene } from './ScopeScene.tsx';
import { SpreadScene } from './SpreadScene.tsx';
import { SummaryScene } from './SummaryScene.tsx';
import { TitleScene } from './TitleScene.tsx';

export type SceneForProps = {
  readonly slide: PlannedSlide;
  /** Seconds since the slide's own zero. */
  readonly time: number;
  readonly fps: number;
  /** Collects every phrase a scene keyed a beat to that this storyboard does not narrate. */
  readonly missing?: string[];
};

export const SceneFor = ({ slide, time, fps, missing }: SceneForProps) => {
  const clock = sceneClock(slide, time, fps, missing);
  const chapter = slide.index;
  const { cue } = slide;
  switch (cue.kind) {
    case 'title':
      return <TitleScene cue={cue} clock={clock} chapter={chapter} />;
    case 'index':
      return <IndexScene cue={cue} clock={clock} chapter={chapter} />;
    case 'spread':
      return <SpreadScene cue={cue} clock={clock} chapter={chapter} />;
    case 'chart':
      return <ChartScene cue={cue} clock={clock} chapter={chapter} />;
    case 'cost':
      return <CostScene cue={cue} clock={clock} chapter={chapter} />;
    case 'instalment':
      return <InstalmentScene cue={cue} clock={clock} chapter={chapter} />;
    case 'risk':
      return <RiskScene cue={cue} clock={clock} chapter={chapter} />;
    case 'scope':
      return <ScopeScene cue={cue} clock={clock} chapter={chapter} />;
    case 'summary':
      return <SummaryScene cue={cue} clock={clock} chapter={chapter} />;
    case 'disclaimer':
      return <DisclaimerScene cue={cue} clock={clock} chapter={chapter} />;
    default:
      return cue satisfies never;
  }
};
