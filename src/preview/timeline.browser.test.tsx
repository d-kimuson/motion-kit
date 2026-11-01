import type * as Lucide from 'lucide-react';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { type AssetSpan } from './asset-usage.ts';
import { packLanes } from './schedule.ts';
import { AssetLanes } from './timeline.tsx';

// Each asset bar draws one icon, so the icon's renders count the bars drawn.
const drawn = vi.hoisted(() => ({ count: 0 }));
vi.mock('lucide-react', async (original) => ({
  ...(await original<typeof Lucide>()),
  Image: () => {
    drawn.count += 1;
    return <svg />;
  },
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  drawn.count = 0;
});

const still = (index: number, start: number, end = start + 1): AssetSpan => ({
  group: { kind: 'image', key: `stills/f_${index}.jpg`, label: `f_${index}.jpg` },
  start,
  end,
  failed: false,
});
const lanesOf = (spans: readonly AssetSpan[]) =>
  packLanes(spans.map((span) => ({ span, start: span.start, end: span.end })));

it('draws again only the asset bars whose span changed, however many there are', () => {
  const spans = Array.from({ length: 1000 }, (_, index) => still(index, index * 2));
  const root = document.createElement('div');
  document.body.append(root);
  const view = createRoot(root);
  cleanups.push(() => {
    act(() => view.unmount());
    root.remove();
  });
  const lanes = lanesOf(spans);
  act(() => view.render(<AssetLanes lanes={lanes} duration={3000} />));
  expect(drawn.count).toBe(1000);

  // The playhead moved, and the spans did not.
  drawn.count = 0;
  act(() => view.render(<AssetLanes lanes={lanes} duration={3000} />));
  expect(drawn.count).toBe(0);

  // The last still is shown a frame longer, and a new one comes after it.
  drawn.count = 0;
  const grown = [...spans.slice(0, -1), still(999, 1998, 2000), still(1000, 2000)];
  act(() => view.render(<AssetLanes lanes={lanesOf(grown)} duration={3000} />));
  expect(drawn.count).toBe(2);
  expect(root.querySelectorAll('[data-slot=timeline-asset]')).toHaveLength(1001);
});
