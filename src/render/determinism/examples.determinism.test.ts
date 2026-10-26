import { describe, expect, it } from 'vitest';

import { requiredDeterminismModes } from './compare.ts';
import { defineDeterminismSuite, runDeterminismSuite } from './suite.ts';

// One row per reference example (docs/design-doc/20261025-reference-examples.md, "CI policy").
// The probe registry is reached as a module path string, and the suite imports it inside its own
// temporary project: an example never imports the suite, and package.json#exports gains no subpath.
// Each row renders the example's `<name>-probe` Composition (480x270, 30 frames) at exact PNG bytes.
const probes = [
  { name: 'teaser', compositionId: 'teaser-probe' },
  { name: 'chart', compositionId: 'chart-probe' },
] as const;

const frames = [0, 15, 29] as const;

describe('reference example probes', () => {
  it.each(probes)(
    'captures the $name example identically across the seven traversal modes',
    async ({ name, compositionId }) => {
      const report = await runDeterminismSuite(
        defineDeterminismSuite({
          composition: {
            name,
            compositionId,
            modulePath: new URL(`../../../examples/${name}/probe.tsx`, import.meta.url).pathname,
          },
          frames,
        }),
      );
      for (const mode of report.compositions.flatMap((item) => item.modes))
        console.info(mode.message);
      expect(report.passed).toBe(true);
      expect(report.compositions[0]?.framesDiffer).toBe(true);
      expect(report.compositions[0]?.modes.map((mode) => mode.mode)).toEqual([
        ...requiredDeterminismModes,
      ]);
    },
    60_000,
  );
});
