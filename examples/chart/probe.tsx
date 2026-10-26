import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { ChartScene } from './chart.tsx';
import { type ChartProps } from './scale.ts';

// The determinism gate's Composition (docs/design-doc/20261025-reference-examples.md, "CI policy"):
// 480x270 for 30 frames, the same `ChartScene` the full chart renders. A separate registry keeps it
// out of what a reader renders, and its props schema is empty because `DeterminismComposition.props`
// is a flat record — a nested `series` cannot travel through the suite, so the dataset is a module
// constant here instead.
const probeData: ChartProps = {
  title: 'Ten years of a synthetic index',
  unit: 'index points',
  source: 'Synthetic series authored for motion-kit; not a real index.',
  series: [
    {
      label: 'Synthetic index, yearly close',
      points: [
        { year: 2015, value: 100 },
        { year: 2016, value: 118 },
        { year: 2017, value: 104 },
        { year: 2018, value: 139 },
        { year: 2019, value: 156 },
        { year: 2020, value: 128 },
        { year: 2021, value: 187 },
        { year: 2022, value: 211 },
        { year: 2023, value: 196 },
        { year: 2024, value: 244 },
      ],
    },
  ],
};

export const compositions = defineCompositions([
  defineComposition({
    id: 'chart-probe',
    width: 480,
    height: 270,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 30,
    schema: z.object({}),
    component: () => <ChartScene {...probeData} />,
  }),
]);
