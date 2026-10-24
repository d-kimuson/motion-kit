import { useLayoutEffect } from 'react';
import { z } from 'zod';

import { useAsset } from '../../assets/use-asset.ts';
import { useCompositionRuntime } from '../../composition/composition.tsx';
import { defineComposition, defineCompositions } from '../../composition/registry.ts';
import { assetsOf } from '../composition-runtime.ts';

const Scene = () => {
  const font = useAsset({
    kind: 'font',
    id: 'title-font',
    family: 'GatedAbel',
    source: '/gated-font.ttf',
    weight: 400,
    style: 'normal',
    sceneId: 'title',
    text: 'Ag',
  });
  const image = useAsset({
    kind: 'image',
    id: 'title-image',
    source: '/gated-image.svg',
    sceneId: 'title',
  });
  useLayoutEffect(() => {
    document.documentElement.dataset['assetsReady'] = 'true';
    return () => {
      delete document.documentElement.dataset['assetsReady'];
    };
  }, []);
  return (
    <div
      style={{
        width: 64,
        height: 64,
        background: '#fff',
        color: '#111',
        fontFamily: font.family,
        fontSize: 28,
        lineHeight: '32px',
      }}
    >
      <img alt="" src={image.src} width={32} height={32} style={{ display: 'block' }} />
      Ag
    </div>
  );
};

const ImageAsset = ({ id, source }: { id: string; source: string }) => {
  useAsset({ kind: 'image', id, source });
  return null;
};

const FailingPair = () => (
  <>
    <ImageAsset id="fail-a" source="http://127.0.0.1:9/fail-a.png" />
    <ImageAsset id="fail-b" source="/fail-b.png" />
  </>
);

const MixedFailure = () => {
  const runtime = useCompositionRuntime();
  assetsOf(runtime).retain(
    { kind: 'image', id: 'loader-rejected', source: '/loader-rejected.png' },
    'loader-owner',
    { compositionId: 'mixed-failure', frame: 0, timeSeconds: 0, generation: 1 },
  );
  return <ImageAsset id="boundary" source="/boundary.png?token=secret" />;
};

const metadata = {
  schema: z.object({}),
  width: 64,
  height: 64,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 2,
};

export const compositions = defineCompositions([
  defineComposition({
    id: 'assets',
    component: Scene,
    ...metadata,
  }),
  defineComposition({
    id: 'failing-assets',
    component: FailingPair,
    ...metadata,
  }),
  defineComposition({
    id: 'mixed-failure',
    component: MixedFailure,
    ...metadata,
  }),
]);
