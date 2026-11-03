import { Transition, TransitionScene, TransitionSeries, useTimeline } from '@kimuson/motion-kit';
import { type ComponentType, type ReactNode, useMemo } from 'react';

import { Backdrop, SceneShell, Stage, Wipe } from './parts.tsx';
import { placeScenes, type SceneKind, type Storyboard } from './plan.ts';
import {
  AgentScene,
  CodeScene,
  IntroScene,
  OutroScene,
  PipelineScene,
  TimeScene,
} from './scenes.tsx';
import { ThreeScene } from './ThreeScene.tsx';

const sceneComponents: Readonly<Record<SceneKind, ComponentType>> = {
  intro: IntroScene,
  code: CodeScene,
  time: TimeScene,
  three: ThreeScene,
  pipeline: PipelineScene,
  agent: AgentScene,
  outro: OutroScene,
};

type PromoSceneProps = { readonly board: Storyboard };

/** The promo. `promo-ci` renders this same component with a shorter board, never a simplified
 * copy. Each scene is a named `TransitionScene`, so the preview's timeline lists them by kind. */
export const PromoScene = ({ board }: PromoSceneProps) => {
  const { frameRate } = useTimeline();
  const placed = useMemo(() => placeScenes(board), [board]);
  // Frame counts become exact rational seconds here, so nothing is rounded outside the Time Module.
  const at = (frames: number) => ({
    numerator: frames * Number(frameRate.denominator),
    denominator: Number(frameRate.numerator),
  });

  const children: ReactNode[] = [];
  for (const [index, scene] of placed.entries()) {
    const Scene = sceneComponents[scene.kind];
    children.push(
      <TransitionScene key={`scene-${String(index)}`} name={scene.kind} duration={at(scene.frames)}>
        <SceneShell
          frames={scene.frames}
          enterFrames={scene.enterFrames}
          exitFrames={scene.exitFrames}
        >
          <Scene />
        </SceneShell>
      </TransitionScene>,
    );
    if (scene.exitFrames > 0)
      children.push(
        <Transition key={`wipe-${String(index)}`} duration={at(scene.exitFrames)}>
          <Wipe />
        </Transition>,
      );
  }

  return (
    <Stage>
      <Backdrop />
      <TransitionSeries>{children}</TransitionSeries>
    </Stage>
  );
};
