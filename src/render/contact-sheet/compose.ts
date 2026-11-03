import { type BrowserContext } from 'playwright';

import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { launchBrowser, type BrowserOptions } from '../browser/launch.ts';
import { contactSheetDocument } from './document.ts';
import { type ContactSheetLayout } from './layout.ts';

// Compositing a Contact Sheet: one Chromium page lays the captured tiles out in a CSS grid and the
// screenshot of that page is the artifact. The page is a static document built from the layout and
// the captured bytes, so the same frames produce the same PNG — the alternative, compositing in
// Node.js, would need a PNG encoder and a text rasteriser for the frame labels, and the labels are
// the reason the tiles can be read at all (agent ADR: contact-sheet compositing).

export type ContactSheetTile = {
  readonly frame: number;
  readonly timeSeconds: number;
  /** The captured PNG of this frame, as the renderer handed it over. */
  readonly image: Uint8Array;
};

/** The captured tiles could not be composed; the page belongs to motion-kit, so a failure is ours. */
const compositionFailure = (): Diagnostic => ({
  code: 'internal.unexpected',
  severity: 'error',
  message: 'The contact sheet could not be composed.',
  hint: 'The sheet page is generated from the captured frames; report the stderr output as a bug.',
});

/**
 * Draws `tiles` into one PNG of `layout`'s geometry. The browser is this function's own — the
 * capture session's realm belongs to the Composition — and it is torn down whatever the outcome.
 */
export const composeContactSheet = async (options: {
  readonly tiles: readonly ContactSheetTile[];
  readonly layout: ContactSheetLayout;
  readonly browser?: BrowserOptions;
  readonly signal?: AbortSignal | undefined;
}): Promise<Result<Buffer> | { readonly ok: false; readonly aborted: true }> => {
  const { tiles, layout } = options;
  const aborted = (): boolean => options.signal?.aborted === true;
  if (aborted()) return { ok: false, aborted: true };
  const launched = await launchBrowser(options.browser ?? {});
  if (!launched.ok) return launched;
  const { browser, server } = launched.value;
  let context: BrowserContext | undefined;
  try {
    // The viewport is the sheet, so the screenshot is exactly the artifact: no clip arithmetic and
    // no scaling. One device pixel per sheet pixel keeps the capture independent of the host.
    context = await browser.newContext({
      viewport: { width: layout.width, height: layout.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const html = contactSheetDocument({
      layout,
      cells: tiles.map((tile) => ({
        frame: tile.frame,
        timeSeconds: tile.timeSeconds,
        pngBase64: Buffer.from(tile.image).toString('base64'),
      })),
    });
    await page.setContent(html, { waitUntil: 'load' });
    // A screenshot taken before the inline images are decoded would draw the sheet's background
    // where a tile belongs, so the capture waits for every one of them.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
    });
    const image = await page.screenshot({ type: 'png' });
    if (aborted()) return { ok: false, aborted: true };
    return { ok: true, value: image };
  } catch {
    return { ok: false, error: compositionFailure() };
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    await server.kill().catch(() => undefined);
  }
};
