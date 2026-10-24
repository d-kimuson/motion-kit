import { Suspense, useLayoutEffect, useRef } from 'react';
import { z } from 'zod';

import { useAsset } from '../../../core/assets/use-asset.ts';
import { defineComposition, defineCompositions } from '../../../core/composition/registry.ts';
import { Sequence } from '../../../core/sequence/sequence.tsx';
import { useFrame } from '../../../core/timeline/hooks.ts';
import {
  Transition,
  TransitionScene,
  TransitionSeries,
  useTransitionProgress,
} from '../../../core/transition/transition-series.tsx';

const metadata = {
  schema: z.object({}),
  width: 64,
  height: 64,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 6,
};

const stage = {
  position: 'relative' as const,
  width: 64,
  height: 64,
  overflow: 'hidden' as const,
};

const DomText = () => {
  const frame = useFrame();
  const font = useAsset({
    kind: 'font',
    id: 'dom-text-font',
    family: 'DeterminismAbel',
    source: '/abel.ttf',
    weight: 400,
    style: 'normal',
    text: '012345',
  });
  return (
    <div
      style={{
        ...stage,
        background: '#fff',
        color: '#111',
        fontFamily: font.family,
        fontSize: 32,
        lineHeight: '64px',
      }}
    >
      {frame}
    </div>
  );
};

const CssTransform = () => {
  const frame = useFrame();
  return (
    <div style={{ ...stage, background: '#222' }}>
      <div
        style={{
          width: 18,
          height: 18,
          background: '#f80',
          transform: `translate(${frame * 6}px, ${frame * 5}px) rotate(${frame * 18}deg)`,
        }}
      />
    </div>
  );
};

const SvgPath = () => {
  const frame = useFrame();
  const end = 8 + frame * 9;
  return (
    <svg width="64" height="64" style={{ background: '#fff' }}>
      <path d={`M4 60 L${end} 4 L${end} 60 Z`} fill="#0a0" />
    </svg>
  );
};

const CanvasDrawing = () => {
  const frame = useFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (context === undefined || context === null) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = `rgb(${frame * 36},40,180)`;
    context.beginPath();
    context.arc(32, 32, 4 + frame * 4, 0, Math.PI * 2);
    context.fill();
  }, [frame]);
  return <canvas ref={canvas} width={64} height={64} />;
};

const SequenceBoundary = () => (
  <div style={{ ...stage, background: '#400' }}>
    <Sequence from={{ numerator: 3, denominator: 30 }} duration={{ numerator: 2, denominator: 30 }}>
      <div style={{ width: 64, height: 64, background: '#0c0' }} />
    </Sequence>
  </div>
);

const OverlapBar = () => {
  const progress = useTransitionProgress();
  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        left: 0,
        width: Math.round(progress * 64),
        height: 8,
        background: '#ff0',
      }}
    />
  );
};

const TransitionOverlap = () => (
  <div style={{ ...stage, background: '#111' }}>
    <TransitionSeries>
      <TransitionScene duration={{ numerator: 3, denominator: 30 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 40,
            height: 64,
            background: '#c00',
          }}
        />
      </TransitionScene>
      <Transition duration={{ numerator: 1, denominator: 30 }}>
        <OverlapBar />
      </Transition>
      <TransitionScene duration={{ numerator: 3, denominator: 30 }}>
        <div
          style={{
            position: 'absolute',
            left: 24,
            top: 0,
            width: 40,
            height: 64,
            background: '#00c',
          }}
        />
      </TransitionScene>
    </TransitionSeries>
  </div>
);

const LoadedAssets = ({ frame }: { frame: number }) => {
  const font = useAsset({
    kind: 'font',
    id: 'suspense-font',
    family: 'DeterminismAbel',
    source: '/abel.ttf',
    weight: 400,
    style: 'normal',
    text: 'Ag',
  });
  const image = useAsset({
    kind: 'image',
    id: 'suspense-image',
    source: '/checker.svg',
  });
  return (
    <div
      style={{ ...stage, background: '#fff', color: '#111', fontFamily: font.family, fontSize: 20 }}
    >
      <img
        alt=""
        src={image.src}
        width={28}
        height={28}
        style={{ display: 'block', marginLeft: frame * 5 }}
      />
      Ag
    </div>
  );
};

const AssetSuspense = () => {
  const frame = useFrame();
  return (
    <div style={stage}>
      <Suspense fallback={<div style={{ ...stage, background: '#f00' }} />}>
        <Suspense fallback={<div style={{ ...stage, background: '#0f0' }} />}>
          <LoadedAssets frame={frame} />
        </Suspense>
      </Suspense>
    </div>
  );
};

// Deliberate negative control. The suite must fail this render; do not seed it.
// oxlint-disable-next-line no-restricted-properties
const randomChannel = (): number => Math.floor(Math.random() * 256);
const Nondeterministic = () => (
  <div
    style={{
      ...stage,
      background: `rgb(${randomChannel()},${randomChannel()},${randomChannel()})`,
    }}
  />
);

export const compositions = defineCompositions([
  defineComposition({ id: 'dom-text', component: DomText, ...metadata }),
  defineComposition({ id: 'css-transform', component: CssTransform, ...metadata }),
  defineComposition({ id: 'svg-path', component: SvgPath, ...metadata }),
  defineComposition({ id: 'canvas-drawing', component: CanvasDrawing, ...metadata }),
  defineComposition({ id: 'sequence-boundary', component: SequenceBoundary, ...metadata }),
  defineComposition({ id: 'transition-overlap', component: TransitionOverlap, ...metadata }),
  defineComposition({ id: 'asset-suspense', component: AssetSuspense, ...metadata }),
  defineComposition({ id: 'nondeterministic', component: Nondeterministic, ...metadata }),
]);
