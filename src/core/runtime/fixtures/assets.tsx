import { useLayoutEffect } from 'react';
import { z } from 'zod';

import { useAsset } from '../../assets/use-asset.ts';
import { defineComposition, defineCompositions } from '../../composition/registry.ts';

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

export const compositions = defineCompositions([
  defineComposition({
    id: 'assets',
    component: Scene,
    schema: z.object({}),
    width: 64,
    height: 64,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 2,
  }),
]);
