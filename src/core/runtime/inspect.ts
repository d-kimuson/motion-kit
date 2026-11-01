import { type InspectedElement } from '../../lib/preview-protocol.ts';

const textLimit = 80;

const selectorOf = (element: Element) =>
  [
    element.localName,
    element.id === '' ? '' : `#${element.id}`,
    ...[...element.classList].map((name) => `.${name}`),
  ].join('');

/**
 * The element at a point of the Composition, in design pixels from the top-left corner of `root`
 * (the element the Composition renders into). Null when the point hits nothing inside `root`. An
 * element with `pointer-events: none` is not hit, as for a click.
 */
export const inspectPoint = (root: HTMLElement, x: number, y: number): InspectedElement | null => {
  const origin = root.getBoundingClientRect();
  const hit = root.ownerDocument.elementFromPoint(origin.left + x, origin.top + y);
  if (hit === null || hit === root || !root.contains(hit)) return null;
  const box = hit.getBoundingClientRect();
  const text = (hit.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
  const located = hit.closest('[data-source]');
  return {
    selector: selectorOf(hit),
    text: text.length > textLimit ? `${text.slice(0, textLimit - 1)}…` : text,
    source: located !== null && root.contains(located) ? located.getAttribute('data-source') : null,
    box: {
      x: Math.round(box.left - origin.left),
      y: Math.round(box.top - origin.top),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
  };
};
