/** Vite's transformIndexHtml applies the configured base exactly once to /@id. */
export const htmlShell = (): string =>
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}#motion-kit-root{overflow:hidden}</style></head><body><div id="motion-kit-root"></div><script type="module" src="/@id/virtual:motion-kit-entry"></script></body></html>';
