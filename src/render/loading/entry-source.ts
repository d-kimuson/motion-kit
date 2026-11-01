/** Only import specifiers are serialized here. Props always cross Playwright serialization. */
export const entrySource = (entry: string): string =>
  `import { compositions } from ${JSON.stringify(entry)};\nimport { bootstrapComposition } from '@kimuson/motion-kit/browser';\nbootstrapComposition(compositions);\n`;
export const entryId = 'virtual:motion-kit-entry';
export const bootstrapId = '@kimuson/motion-kit/browser';
/** The preview host page's module: the host bundle is a private id like the bootstrap. */
export const previewEntryId = 'virtual:motion-kit-preview-entry';
export const previewHostId = '@kimuson/motion-kit/preview';
export const previewEntrySource = (): string =>
  `import { startPreviewHost } from '${previewHostId}';\nstartPreviewHost();\n`;
const svgTags = [
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'circle',
  'ellipse',
  'rect',
  'polygon',
  'polyline',
  'text',
  'tspan',
  'textPath',
  'image',
  'foreignObject',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'linearGradient',
  'radialGradient',
  'stop',
];

/**
 * Preview only: the JSX dev runtime the project's modules import, wrapping the project's own. It
 * marks each host element with `data-source="file:line:column"` from the source location the JSX
 * transform passes in development, so a review comment can name where an element was written. A
 * `data-source` the author set is kept. Only DOM elements are marked: a React Three Fiber element
 * is a string type too, and the mark would land on its Three object. A tag is a DOM element when
 * the browser knows it as HTML, or it is a common SVG one; `line` and `path` are left out, since
 * they name three.js classes too.
 */
export const jsxSourceId = 'virtual:motion-kit-jsx-source';
export const jsxSourceSource = (): string =>
  `import { Fragment, jsxDEV as runtimeJsxDEV } from 'react/jsx-dev-runtime';
export { Fragment };
const svg = new Set(${JSON.stringify(svgTags)});
const known = new Map();
const dom = (type) => {
  let found = known.get(type);
  if (found === undefined) {
    found =
      type.includes('-') ||
      svg.has(type) ||
      !(document.createElement(type) instanceof HTMLUnknownElement);
    known.set(type, found);
  }
  return found;
};
export const jsxDEV = (type, props, key, isStaticChildren, source, self) =>
  runtimeJsxDEV(
    type,
    typeof type === 'string' && source != null && props['data-source'] === undefined && dom(type)
      ? { ...props, 'data-source': \`\${source.fileName}:\${source.lineNumber}:\${source.columnNumber}\` }
      : props,
    key,
    isStaticChildren,
    source,
    self,
  );
`;
