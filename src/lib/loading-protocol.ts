import { z } from 'zod';

import { DiagnosticSchema } from './diagnostic.ts';
import {
  type AssetReadinessSnapshot,
  type AssetSettlement,
  type FramePage,
  type Ownership,
} from './frame-protocol.ts';
import { type Result } from './result.ts';

export const loadingProtocolVersion = 1;
export const descriptorSchema = z.object({
  id: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.object({
    numerator: z.number().int().positive(),
    denominator: z.number().int().positive(),
  }),
  durationInFrames: z.number().int().nonnegative(),
});
export type LoadingDescriptor = z.infer<typeof descriptorSchema>;
export const resultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: DiagnosticSchema }),
  ]);
export const mountRequestSchema = z.object({
  compositionId: z.string().optional(),
  props: z.unknown().default({}),
  revision: z.string(),
  instance: z.string(),
  loadingTimeoutMs: z.number().positive(),
  frameTimeoutMs: z.number().positive().default(30_000),
  queueTimeoutMs: z.number().positive().default(30_000),
});
export type MountRequest = z.infer<typeof mountRequestSchema>;
export const mountReceiptSchema = z.object({
  instance: z.string(),
  revision: z.string(),
  descriptor: descriptorSchema,
});
export type MountReceipt = z.infer<typeof mountReceiptSchema>;
/** Loading-only protocol. Mount acknowledges preparation, never frame readiness. */
export type LoadingPage = FramePage & {
  protocolVersion: typeof loadingProtocolVersion;
  listCompositions: () => Result<readonly LoadingDescriptor[]>;
  mount: (request: unknown) => Promise<Result<MountReceipt>>;
  dispose: () => Result<undefined>;
  /** Registered-resource snapshot for a later inspect command. Not a package export. */
  assetReadiness: () => AssetReadinessSnapshot;
  /** Same registry settlement the frame barrier awaits. Not a package export. */
  whenReady: (timeoutMs: number) => Promise<AssetSettlement>;
};
declare global {
  // Interface merging is required for the browser global.
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    __motionKit?: LoadingPage;
    __motionKitLoadingEvent?: (event: { protocolVersion: number }) => Promise<void>;
    __motionKitOwnership?: (event: Ownership) => Promise<boolean>;
  }
}
