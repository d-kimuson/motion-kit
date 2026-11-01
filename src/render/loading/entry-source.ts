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
/**
 * Preview only: the JSX dev runtime the project's modules import, wrapping the project's own. It
 * marks each host element with `data-source="file:line:column"` from the source location the JSX
 * transform passes in development, so a review comment can name where an element was written. A
 * `data-source` the author set is kept.
 */
export const jsxSourceId = 'virtual:motion-kit-jsx-source';
export const jsxSourceSource = (): string =>
  `import { Fragment, jsxDEV as runtimeJsxDEV } from 'react/jsx-dev-runtime';
export { Fragment };
export const jsxDEV = (type, props, key, isStaticChildren, source, self) =>
  runtimeJsxDEV(
    type,
    typeof type === 'string' && source != null && props['data-source'] === undefined
      ? { ...props, 'data-source': \`\${source.fileName}:\${source.lineNumber}:\${source.columnNumber}\` }
      : props,
    key,
    isStaticChildren,
    source,
    self,
  );
`;
