import { type ContactSheetLayout } from './layout.ts';

// The page a Contact Sheet is a screenshot of. It is a pure function of the layout and the captured
// bytes, so the same frames always produce the same document: no clock, no randomness, no state,
// and no markup that resolves differently between two runs. Numbers only, so nothing here needs
// escaping.

export type ContactSheetCell = {
  readonly frame: number;
  readonly timeSeconds: number;
  /** The tile's PNG bytes, base64-encoded, as an inline `data:` URL. */
  readonly pngBase64: string;
};

/** Sheet background: a neutral dark, so a bright frame reads as the thing to look at. */
const background = '#101014';
/** Label colour; `#e6e6ea` keeps a contrast against the background without glowing. */
const labelColor = '#e6e6ea';
const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** The label's font size, scaled with the tile and floored so a small sheet stays readable. */
export const contactSheetFontSize = (tileWidth: number): number =>
  Math.max(9, Math.round(tileWidth * 0.042));

/** A presentation time as a tile label writes it: milliseconds, no locale, no exponent. */
export const contactSheetTimeLabel = (timeSeconds: number): string => `${timeSeconds.toFixed(3)}s`;

const cell = (value: ContactSheetCell): string =>
  [
    '<div class="cell">',
    `<img src="data:image/png;base64,${value.pngBase64}" alt="">`,
    '<div class="label">',
    `<span>frame ${String(value.frame)}</span>`,
    `<span>${contactSheetTimeLabel(value.timeSeconds)}</span>`,
    '</div>',
    '</div>',
  ].join('');

/**
 * The whole sheet as one HTML document: a grid of the requested geometry, each cell an image of a
 * captured frame with its frame number and presentation time underneath.
 */
export const contactSheetDocument = (options: {
  readonly layout: ContactSheetLayout;
  readonly cells: readonly ContactSheetCell[];
}): string => {
  const { layout, cells } = options;
  const fontSize = contactSheetFontSize(layout.tileWidth);
  const style = [
    '*{box-sizing:border-box;margin:0;padding:0}',
    `html,body{width:${String(layout.width)}px;height:${String(layout.height)}px;overflow:hidden;background:${background}}`,
    'body{-webkit-font-smoothing:antialiased}',
    `.sheet{display:grid;grid-template-columns:repeat(${String(layout.columns)}, ${String(layout.tileWidth)}px);` +
      `gap:${String(layout.gap)}px;padding:${String(layout.padding)}px;width:${String(layout.width)}px;height:${String(layout.height)}px}`,
    '.cell{display:flex;flex-direction:column;overflow:hidden}',
    `.cell img{display:block;width:${String(layout.tileWidth)}px;height:${String(layout.tileHeight)}px}`,
    `.label{display:flex;justify-content:space-between;gap:${String(layout.gap)}px;height:${String(layout.labelHeight)}px;` +
      `line-height:${String(layout.labelHeight)}px;font-family:${fontFamily};font-size:${String(fontSize)}px;` +
      `color:${labelColor};white-space:nowrap;overflow:hidden}`,
  ].join('');
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<style>${style}</style>`,
    '</head><body><main class="sheet">',
    cells.map(cell).join(''),
    '</main></body></html>',
  ].join('');
};
