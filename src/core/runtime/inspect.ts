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

/** Whether an element is a picture: an image, a video, a canvas, SVG or a background image file. */
const pictures = (element: Element, style: CSSStyleDeclaration) =>
  replaced.has(element.localName) ||
  element instanceof SVGElement ||
  style.backgroundImage.includes('url(');

/** The text nodes directly inside an element that hold more than whitespace. */
const ownText = (element: Element) =>
  [...element.childNodes].filter(
    (node) => node.nodeType === node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  );

/**
 * Whether an element draws something of its own: text, an image, a background, a border or a
 * shadow. A layout box draws nothing, and may span elements drawn beneath it.
 */
const paints = (element: Element, style: CSSStyleDeclaration) =>
  pictures(element, style) ||
  ownText(element).length > 0 ||
  !transparent(style.backgroundColor) ||
  style.backgroundImage !== 'none' ||
  style.boxShadow !== 'none' ||
  (['Top', 'Right', 'Bottom', 'Left'] as const).some(
    (side) =>
      style[`border${side}Style`] !== 'none' &&
      style[`border${side}Width`] !== '0px' &&
      !transparent(style[`border${side}Color`]),
  );

/** Whether a glyph of the text directly inside an element is drawn at a client point. */
const glyphAt = (element: Element, x: number, y: number) =>
  ownText(element).some((node) => {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].some(
      (rect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
    );
  });

/**
 * Whether a painting element is a film-look overlay rather than something the scene shows: it, or
 * an ancestor below `root`, blends with what is beneath it, or it covers the whole frame with no
 * text or picture of its own (a tint, a gradient, a backdrop).
 */
const decorates = (element: Element, root: HTMLElement, view: Window) => {
  for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) {
    if (view.getComputedStyle(at).mixBlendMode !== 'normal') return true;
  }
  const style = view.getComputedStyle(element);
  if (pictures(element, style) || ownText(element).length > 0) return false;
  const box = element.getBoundingClientRect();
  const frame = root.getBoundingClientRect();
  return (
    box.left <= frame.left &&
    box.top <= frame.top &&
    box.right >= frame.right &&
    box.bottom >= frame.bottom
  );
};

/**
 * Whether an element hides what lies beneath it: it draws an opaque picture or background, and
 * neither it nor an ancestor below `root` is translucent or blends.
 */
const opaque = (element: Element, root: HTMLElement, view: Window) => {
  for (let at: Element | null = element; at !== null && at !== root; at = at.parentElement) {
    const style = view.getComputedStyle(at);
    if (style.opacity !== '1' || style.mixBlendMode !== 'normal') return false;
  }
  return (
    ['img', 'video', 'canvas', 'picture'].includes(element.localName) ||
    view.getComputedStyle(element).backgroundColor.startsWith('rgb(')
  );
};

/** What an element is to the viewer at a point, the one most likely meant first. */
const kinds = ['glyph', 'paint', 'overlay', 'layout'] as const;
type Kind = (typeof kinds)[number];

/** `covered`: an element above it hides what lies beneath at the point, so its glyphs are not seen. */
const kindAt = (
  element: Element,
  root: HTMLElement,
  view: Window,
  point: Readonly<{ x: number; y: number }>,
  covered: boolean,
): Kind => {
  if (!covered && glyphAt(element, point.x, point.y)) return 'glyph';
  if (!paints(element, view.getComputedStyle(element))) return 'layout';
  return decorates(element, root, view) ? 'overlay' : 'paint';
};

/**
 * The visible elements at a point of the Composition, in design pixels from the top-left corner of
 * `root` (the element the Composition renders into), the one most likely meant first: the text
 * whose glyphs are seen under the point, then the elements that draw something there, then
 * film-look overlays (`decorates`), then layout boxes that draw nothing; each group topmost first.
 * Text under an element that hides it (`opaque`) ranks by what it draws instead. Empty when the
 * point hits nothing visible inside `root`. An element with `pointer-events: none` is not hit,
 * as for a click.
 */
export const inspectPoint = (
  root: HTMLElement,
  x: number,
  y: number,
): readonly InspectedElement[] => {
  const view = root.ownerDocument.defaultView;
  if (view === null) return [];
  const origin = root.getBoundingClientRect();
  const point = { x: origin.left + x, y: origin.top + y };
  let covered = false;
  return root.ownerDocument
    .elementsFromPoint(point.x, point.y)
    .filter((element) => element !== root && root.contains(element) && !invisible(element, root))
    .map((element, order) => {
      const kind = kindAt(element, root, view, point, covered);
      covered ||= opaque(element, root, view);
      return { element, order, rank: kinds.indexOf(kind) };
    })
    .toSorted((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ element }) => describe(element, root, origin));
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
 * ones it finds. Past `treeLimit` elements the rest are left out and the tree says so.
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
