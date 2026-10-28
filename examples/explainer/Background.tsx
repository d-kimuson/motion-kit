// The layer under everything: the night-blue ground, a faint drifting grid, a few slow out-of-focus
// lights, and the stage panel every scene draws on. Nothing here follows the narration — it is the
// room the video happens in, alive enough that a held shot never looks frozen.
import { useTime } from '@kimuson/motion-kit';

import { DesignRect } from './flat.tsx';
import { DESIGN, STAGE, palette } from './look.ts';
import { hash01 } from './scenes/kit.tsx';
import { useFlat } from './slides/shared.ts';

const GRID = 64;
const LIGHTS = 9;

/** One out-of-focus light: a soft disc on a slow loop of its own, seeded by its index. */
const Light = ({ index, t }: { readonly index: number; readonly t: number }) => {
  const size = 180 + hash01(index * 3) * 260;
  const period = 26 + hash01(index * 5) * 22;
  const phase = hash01(index * 7) * Math.PI * 2;
  const x = hash01(index * 11) * DESIGN.width + Math.sin((t / period) * Math.PI * 2 + phase) * 60;
  const y = hash01(index * 13) * DESIGN.height + Math.cos((t / period) * Math.PI * 2 + phase) * 40;
  const color = [palette.sky, palette.mint, palette.gold][index % 3] ?? palette.sky;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}22 0%, ${color}00 70%)`,
      }}
    />
  );
};

export const Background = () => {
  const t = useTime();
  const flat = useFlat();
  if (flat)
    return (
      <DesignRect
        left={0}
        top={0}
        width={DESIGN.width}
        height={DESIGN.height}
        color={palette.groundTop}
      />
    );
  const drift = (t * 6) % GRID;
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, ${palette.groundTop} 0%, ${palette.groundBottom} 100%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -GRID,
          top: -GRID,
          width: DESIGN.width + 2 * GRID,
          height: DESIGN.height + 2 * GRID,
          transform: `translate(${String(drift)}px, ${String(drift)}px)`,
          backgroundImage: `linear-gradient(${palette.grid} 2px, transparent 2px), linear-gradient(90deg, ${palette.grid} 2px, transparent 2px)`,
          backgroundSize: `${String(GRID)}px ${String(GRID)}px`,
          opacity: 0.55,
        }}
      />
      {Array.from({ length: LIGHTS }, (_, index) => (
        <Light key={`light-${String(index)}`} index={index} t={t} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: STAGE.left,
          top: STAGE.top,
          width: STAGE.width,
          height: STAGE.height,
          borderRadius: 28,
          background: `linear-gradient(180deg, ${palette.panel}f2 0%, #0d1830f2 100%)`,
          border: `2px solid ${palette.panelEdge}`,
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
};
