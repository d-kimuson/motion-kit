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
