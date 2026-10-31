import { previewConfigElementId, type PreviewHostConfig } from '../../lib/preview-protocol.ts';
import { previewEntryId } from './entry-source.ts';

/** Vite's transformIndexHtml applies the configured base exactly once to /@id. */
export const htmlShell = (): string =>
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}#motion-kit-root{overflow:hidden}</style></head><body><div id="motion-kit-root"></div><script type="module" src="/@id/virtual:motion-kit-entry"></script></body></html>';

/** The preview host page; its configuration is inline JSON, `<` escaped so it cannot end the tag. */
export const previewShell = (config: PreviewHostConfig): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>motion-kit preview</title></head><body><div id="motion-kit-preview"></div><script type="application/json" id="${previewConfigElementId}">${JSON.stringify(config).replaceAll('<', '\\u003c')}</script><script type="module" src="/@id/${previewEntryId}"></script></body></html>`;
