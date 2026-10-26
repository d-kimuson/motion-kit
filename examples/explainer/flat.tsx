// The probe's whole drawing language: an axis-aligned, fully opaque rectangle on whole pixels.
//
// A determinism probe has to rasterise the same bytes on macOS arm64 and on the Linux runner, and
// every construct this file keeps out of is a construct that has painted differently there:
// antialiased edges (`border-radius`, a rotated/non-integer box), fractional alpha (`opacity < 1`
// over anything), blended layers (a crossfade, a `box-shadow`, a gradient), and glyph rasterisation
// (a font, whose hinting and subpixel coverage are the platform's, not ours). Chromium draws a
// rounded corner or a glyph through a coverage mask it recomputes per paint and per platform; it
// draws an opaque integer rectangle by filling a span. So the probe draws only this, and the gate
// compares PNG bytes with no tolerance.
//
// The primitive rounds, because whole pixels are the rule rather than a habit a caller remembers.
export type FlatRectProps = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** An opaque colour: `#rrggbb`. Never `rgba()`, never a colour with an alpha channel. */
  readonly color: string;
};

export const FlatRect = ({ left, top, width, height, color }: FlatRectProps) => (
  <div
    style={{
      position: 'absolute',
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height),
      background: color,
    }}
  />
);
