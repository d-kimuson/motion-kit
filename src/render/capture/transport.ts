import { type Page } from 'playwright';
import { z } from 'zod';

import { DiagnosticSchema, type Diagnostic } from '../../lib/diagnostic.ts';
import {
  captureCompletionSchema,
  captureValidationSchema,
  frameOutcomeSchema,
  pendingAssetSchema,
  type CaptureLease,
  type PendingAsset,
} from '../../lib/frame-protocol.ts';

/** Internal driver seam. Every remote value is checked before host use. */
export type FrameTransport = {
  settle: (frame: number, requestId: string) => Promise<z.infer<typeof frameOutcomeSchema>>;
  resettle: (lease: CaptureLease) => Promise<z.infer<typeof frameOutcomeSchema>>;
  validate: (lease: CaptureLease) => Promise<z.infer<typeof captureValidationSchema>>;
  complete: (lease: CaptureLease) => Promise<z.infer<typeof captureCompletionSchema>>;
  capture: (width: number, height: number) => Promise<Buffer>;
  pendingAssets: (requestId: string) => Promise<PendingAsset[]>;
  warnings: () => Promise<Diagnostic[]>;
};
export const pageTransport = (page: Page): FrameTransport => ({
  settle: async (frame, requestId) =>
    frameOutcomeSchema.parse(
      await page.evaluate(
        ({ frame, requestId }) =>
          window.__motionKit?.settleFrame(frame, { source: 'renderer', requestId }),
        { frame, requestId },
      ),
    ),
  resettle: async (lease) =>
    frameOutcomeSchema.parse(
      await page.evaluate((value) => window.__motionKit?.resettle(value), lease),
    ),
  validate: async (lease) =>
    captureValidationSchema.parse(
      await page.evaluate((value) => window.__motionKit?.validateCapture(value), lease),
    ),
  complete: async (lease) =>
    captureCompletionSchema.parse(
      await page.evaluate((value) => window.__motionKit?.completeCapture(value), lease),
    ),
  capture: (width, height) =>
    page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width, height },
      scale: 'css',
      animations: 'allow',
      caret: 'hide',
      timeout: 0,
    }),
  pendingAssets: async (requestId) =>
    z
      .array(pendingAssetSchema)
      .parse(await page.evaluate((id) => window.__motionKit?.pendingAssets(id), requestId)),
  warnings: async () =>
    z.array(DiagnosticSchema).parse(await page.evaluate(() => window.__motionKit?.warnings())),
});
