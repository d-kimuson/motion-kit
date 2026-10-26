import type { SurfaceProps } from './slides.tsx';

// The probe's stand-in for a photo: flat colour fields, no file and no decode. The determinism gate
// covers this example's structure (the TransitionSeries crossfade and the width/height layout read),
// not the image path: an `useAsset` image inside a Sequence failed `reverse` twice and has not
// reproduced since, so the probes stay off it until that finding is settled
// (docs/design-doc/20261025-reference-examples.md, "CI policy").

/** One flat colour per slide id, so the same slide is the same bytes on every traversal. */
const FLAT_COLOURS: Readonly<Record<string, string>> = {
  'dune-light': '#2e2a24',
  'cold-water': '#1c2c38',
  'stone-stair': '#382b26',
  'pine-ridge': '#22302a',
  harbour: '#1d2a33',
  'long-field': '#2b2f22',
  'night-road': '#161821',
  'morning-window': '#33302b',
};

const MONO_STACK = "'SF Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace";

/** A flat picture: a solid field, a band and a block whose size follows the Ken Burns scale, so the
 *  probe still paints the arithmetic the real slide computes. */
export const FlatSurface = ({ slide, kenBurns: move }: SurfaceProps) => (
  <div
    style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: FLAT_COLOURS[slide.id] ?? '#242424',
      fontFamily: MONO_STACK,
    }}
  >
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: '18%',
        background: '#f5f2ec',
        opacity: 0.12,
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: '12%',
        top: '34%',
        width: `${Math.round(move.scale * 22)}%`,
        height: '22%',
        background: '#ff5a3c',
        opacity: 0.55,
      }}
    />
    <div style={{ position: 'absolute', left: '12%', top: '24%', color: '#f5f2ec', fontSize: 12 }}>
      {slide.id}
    </div>
  </div>
);
