/** Only import specifiers are serialized here. Props always cross Playwright serialization. */
export const entrySource = (entry: string): string =>
  `import { compositions } from ${JSON.stringify(entry)};\nimport { bootstrapComposition } from '@kimuson/motion-kit/browser';\nbootstrapComposition(compositions);\n`;
export const entryId = 'virtual:motion-kit-entry';
export const bootstrapId = '@kimuson/motion-kit/browser';
