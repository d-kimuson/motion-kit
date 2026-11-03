// The promo's whole look as constants: one ground, two accents, one sans and one mono stack. The
// scenes are drawn on a 1920x1080 design grid and scaled to the Composition's size, so every length
// below is in design pixels.

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

export const INK = '#090b14';
export const PANEL = '#121628';
export const PANEL_EDGE = '#262c48';
export const CHALK = '#eef1fa';
export const MUTED = '#8a93b8';
export const VIOLET = '#8b6cff';
export const CYAN = '#2fe3d0';
export const PINK = '#ff6f9d';
export const AMBER = '#ffc861';
export const ACCENT_GRADIENT = `linear-gradient(90deg, ${VIOLET}, ${CYAN})`;

export const SANS =
  "'Inter', 'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif";
export const MONO = "'SF Mono', 'JetBrains Mono', Menlo, 'DejaVu Sans Mono', monospace";

/** Colours of the syntax tokens in `copy.ts`. */
export const TOKEN_COLOURS = {
  keyword: PINK,
  name: CHALK,
  call: CYAN,
  string: AMBER,
  number: AMBER,
  punct: MUTED,
  tag: VIOLET,
  key: CYAN,
  plain: CHALK,
} as const;

/** The preview's comment-mode colour (`--comment` in the preview's stylesheet), so the mock preview
 * in the review scene marks what the real one marks. */
export const MAGENTA = '#e12afb';
