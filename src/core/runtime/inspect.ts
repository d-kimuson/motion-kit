import {
  type ElementNode,
  type ElementTree,
  type InspectedElement,
} from '../../lib/preview-protocol.ts';

const textLimit = 80;
/** The most elements a tree describes; a frame drawing more is rare and the rest is left out. */
const treeLimit = 2000;

const selectorOf = (element: Element) =>
  [
    element.localName,
    element.id === '' ? '' : `#${element.id}`,
    ...[...element.classList].map((name) => `.${name}`),
  ].join('');

/**
 * Whether an element paints nothing: it or an ancestor below `root` is fully transparent, or it is
 * hidden. Scenes fade a shot out with opacity and keep it mounted, so such an element can lie over
 * the one the viewer sees.
 */
const invisible = (element: Element, root: HTMLElement) => {
  const view = root.ownerDocument.defaultView;
  if (view === null) return false;
  if (view.getComputedStyle(element).visibility === 'hidden') return true;
  for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) {
    if (view.getComputedStyle(at).opacity === '0') return true;
  }
  return false;
};

const transparent = (color: string) => color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color);

const replaced = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'picture']);

/**
 * Whether an element draws something of its own: text, an image, a background, a border or a
 * shadow. A layout box draws nothing, and may span elements drawn beneath it.
 */
const paints = (element: Element, root: HTMLElement) => {
  if (replaced.has(element.localName) || element instanceof SVGElement) return true;
  if (
    [...element.childNodes].some(
      (node) => node.nodeType === node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
  )
    return true;
  const style = root.ownerDocument.defaultView?.getComputedStyle(element);
  if (style === undefined) return false;
  return (
    !transparent(style.backgroundColor) ||
    style.backgroundImage !== 'none' ||
    style.boxShadow !== 'none' ||
    (['Top', 'Right', 'Bottom', 'Left'] as const).some(
      (side) =>
        style[`border${side}Style`] !== 'none' &&
        style[`border${side}Width`] !== '0px' &&
        !transparent(style[`border${side}Color`]),
    )
  );
};

/**
 * The visible element at a point of the Composition, in design pixels from the top-left corner of
 * `root` (the element the Composition renders into): the topmost one that draws something there,
 * or else the topmost visible one. Null when the point hits nothing visible inside `root`. An
 * element with `pointer-events: none` is not hit, as for a click.
 */
export const inspectPoint = (root: HTMLElement, x: number, y: number): InspectedElement | null => {
  const origin = root.getBoundingClientRect();
  const visible = root.ownerDocument
    .elementsFromPoint(origin.left + x, origin.top + y)
    .filter((element) => element !== root && root.contains(element) && !invisible(element, root));
  const hit = visible.find((element) => paints(element, root)) ?? visible[0];
  return hit === undefined ? null : describe(hit, root, origin);
};

const describe = (element: Element, root: HTMLElement, origin: DOMRect): InspectedElement => {
  const box = element.getBoundingClientRect();
  const text = (element.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
  const located = element.closest('[data-source]');
  return {
    selector: selectorOf(element),
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

/**
 * Every element inside `root`, in document order, each described as `inspectPoint` describes the
 * one it finds. Past `treeLimit` elements the rest are left out and the tree says so.
 */
export const describeTree = (root: HTMLElement): ElementTree => {
  const origin = root.getBoundingClientRect();
  let left = treeLimit;
  const nodes = (parent: Element): ElementNode[] => {
    const described: ElementNode[] = [];
    for (const element of parent.children) {
      if (left === 0) break;
      left -= 1;
      described.push({
        ...describe(element, root, origin),
        visible: !invisible(element, root),
        children: nodes(element),
      });
    }
    return described;
  };
  return { nodes: nodes(root), truncated: root.getElementsByTagName('*').length > treeLimit };
};
