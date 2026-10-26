import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

import { ChartScene } from './chart.tsx';

// The props schema lives in the Composition registry, so the page validates it before the first
// frame is captured: that is this example's axis (docs/design-doc/20261025-reference-examples.md,
// "chart"). `series` has no default, so the data is always supplied — `--props` in the documented
// commands, and `composition.props-invalid` with the failing path when a reader omits it. The other
// three fields default, so a dataset file only has to carry what it changes.
const pointSchema = z.object({ year: z.int().min(1900), value: z.number().nonnegative() });

const seriesSchema = z.object({
  label: z.string().min(1),
  points: z.array(pointSchema).min(2),
});

export const chartProps = z.object({
  title: z.string().default('30 years of an index'),
  unit: z.string().default('index points'),
  source: z.string().default(''),
  series: z.array(seriesSchema),
});

/** The entry holds two Compositions, so `--composition <id>` is always required. `chart` is
 * 1920x1080 at 30 fps for 600 frames (20 s); `chart-ci` is half linear resolution for 60 frames and
 * renders the same `ChartScene` — only the props (the dataset) and the duration differ. */
export const compositions = defineCompositions([
  defineComposition({
    id: 'chart',
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 600,
    schema: chartProps,
    component: ChartScene,
  }),
  defineComposition({
    id: 'chart-ci',
    width: 960,
    height: 540,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 60,
    schema: chartProps,
    component: ChartScene,
  }),
]);
