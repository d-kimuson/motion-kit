import { z } from 'zod';

import { DiagnosticSchema, type Diagnostic } from './diagnostic.ts';

/** Internal plain-data protocol, shared by browser and Node; no host imports. */
export const captureLeaseSchema = z.object({
  source: z.enum(['renderer', 'preview']),
  instance: z.string(),
  revision: z.string(),
  generation: z.int().positive(),
  globalFrame: z.int().nonnegative(),
  fps: z.object({ numerator: z.int().positive(), denominator: z.int().positive() }),
  presentationTime: z.object({
    numerator: z.string().regex(/^-?\d+$/),
    denominator: z.string().regex(/^[1-9]\d*$/),
  }),
  resourceRevision: z.int().nonnegative(),
  resourceVersions: z.array(z.object({ id: z.string(), version: z.string() })).readonly(),
});
export type CaptureLease = z.infer<typeof captureLeaseSchema>;
const aborted = z.object({ status: z.literal('aborted') });
const failed = z.object({
  status: z.literal('failed'),
  diagnostics: z.tuple([DiagnosticSchema], DiagnosticSchema),
});
export const frameOutcomeSchema = z.discriminatedUnion('status', [
  aborted,
  failed,
  z.object({ status: z.literal('ready'), lease: captureLeaseSchema }),
]);
export const captureValidationSchema = z.discriminatedUnion('status', [
  aborted,
  failed,
  z.object({ status: z.literal('valid') }),
  z.object({ status: z.literal('resettle') }),
]);
export const captureCompletionSchema = z.discriminatedUnion('status', [
  aborted,
  failed,
  z.object({ status: z.literal('accepted') }),
  z.object({ status: z.literal('resettle') }),
]);
export const ownershipSchema = z.object({
  requestId: z.string(),
  source: z.literal('renderer'),
  instance: z.string(),
  revision: z.string(),
  generation: z.int().positive(),
  globalFrame: z.int().nonnegative(),
});
export type Ownership = z.infer<typeof ownershipSchema>;
/** Current required work. Sources are redacted by the asset diagnostic producer. */
export const pendingAssetSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.string(),
  source: z.string(),
  phase: z.string(),
  sceneId: z.string().min(1).optional(),
  relatedSources: z.array(z.string()).optional(),
});
export type PendingAsset = z.infer<typeof pendingAssetSchema>;
export type AssetReadinessSnapshot = Readonly<{
  pending: readonly PendingAsset[];
  failed: readonly PendingAsset[];
  ready: readonly PendingAsset[];
}>;
/** Registry settlement. Cancellation is not a Diagnostic. */
export type AssetSettlement =
  | { readonly ok: true; readonly value: undefined }
  | { readonly ok: false; readonly error: readonly Diagnostic[] }
  | { readonly ok: false; readonly aborted: true };
export const frameRequestSchema = z.object({
  source: z.enum(['renderer', 'preview']),
  requestId: z.string(),
});
export type FramePage = {
  settleFrame: (frame: number, request: unknown) => Promise<z.infer<typeof frameOutcomeSchema>>;
  resettle: (lease: unknown) => Promise<z.infer<typeof frameOutcomeSchema>>;
  validateCapture: (lease: unknown) => z.infer<typeof captureValidationSchema>;
  completeCapture: (lease: unknown) => z.infer<typeof captureCompletionSchema>;
  cancel: (requestId: string) => void;
  pendingAssets: (requestId: string) => PendingAsset[];
  warnings: () => z.infer<typeof DiagnosticSchema>[];
};
