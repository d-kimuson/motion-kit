// The one table a cue's `chartId` resolves through. The data belongs to the `chart` example
// (`examples/chart/data/`), so both examples draw the same JSON rather than two copies of it.
import index30y from '../../chart/data/index-30y.json';
import { type Point } from './math.ts';

const datasets: Readonly<Record<string, readonly Point[]>> = {
  'index-30y': index30y.series[0]?.points ?? [],
};

/** The points a `chartId` names; a name the table does not hold is a script bug, so it throws. */
export const dataset = (id: string): readonly Point[] => {
  const points = datasets[id];
  if (points === undefined || points.length === 0)
    throw new Error(`explainer: no dataset named ${id}`);
  return points;
};

/** Where the series comes from, printed under every chart that draws it. */
export const datasetSource = '合成データ（実在の指数・商品ではありません）';
