import { z } from 'zod';

import { DiagnosticSchema, type Diagnostic } from './diagnostic.ts';
import {
  descriptorSchema,
  mountReceiptSchema,
  resultSchema,
  sequenceSpanSchema,
  type LoadingDescriptor,
  type MountReceipt,
  type SequenceSpan,
} from './loading-protocol.ts';
import { type Result } from './result.ts';

/**
 * Messages between a preview host page and the composition realm in its iframe
 * (docs/design-doc/20261101-browser-preview.md). Plain data, validated on both sides.
 */
export const previewProtocolVersion = 1;

/** The realm announces itself to its parent window once the bootstrap ran. */
export const previewReadySchema = z.object({
  type: z.literal('motion-kit-preview-ready'),
  protocolVersion: z.literal(previewProtocolVersion),
});
/** The host answers with this message and transfers the port requests travel on. */
export const previewConnectSchema = z.object({
  type: z.literal('motion-kit-preview-connect'),
  protocolVersion: z.literal(previewProtocolVersion),
});

const requestId = z.int().nonnegative();
export const previewRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list'), id: requestId }),
  z.object({
    type: z.literal('mount'),
    id: requestId,
    compositionId: z.string().optional(),
    props: z.unknown(),
  }),
  z.object({ type: z.literal('show'), id: requestId, frame: z.int().nonnegative() }),
]);
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const showOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('shown'),
    frame: z.int().nonnegative(),
    sequences: z.array(sequenceSpanSchema),
  }),
  z.object({
    status: z.literal('failed'),
    diagnostics: z.tuple([DiagnosticSchema], DiagnosticSchema),
  }),
  z.object({ status: z.literal('aborted') }),
]);
export type ShowOutcome =
  | Readonly<{ status: 'shown'; frame: number; sequences: readonly SequenceSpan[] }>
  | Readonly<{ status: 'failed'; diagnostics: readonly [Diagnostic, ...Diagnostic[]] }>
  | Readonly<{ status: 'aborted' }>;

export const previewReplySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('listed'),
    id: requestId,
    result: resultSchema(z.array(descriptorSchema)),
  }),
  z.object({ type: z.literal('mounted'), id: requestId, result: resultSchema(mountReceiptSchema) }),
  z.object({ type: z.literal('shown'), id: requestId, outcome: showOutcomeSchema }),
]);
// Readonly on both sides of the wire, like the Loading Page values the replies carry.
export type PreviewReply =
  | Readonly<{ type: 'listed'; id: number; result: Result<readonly LoadingDescriptor[]> }>
  | Readonly<{ type: 'mounted'; id: number; result: Result<MountReceipt> }>
  | Readonly<{ type: 'shown'; id: number; outcome: ShowOutcome }>;

/** What the server inlines into the host page; every URL is absolute-path, under Vite's base. */
export const previewHostConfigSchema = z.object({
  projectRoot: z.string(),
  /** The composition shell in preview host mode. */
  shellUrl: z.string(),
  /** Server-sent events: `reload` after a served module changed. */
  eventsUrl: z.string(),
  /** Takes `?src=<AudioTrack src>` and redirects to the file under Vite's fs policy. */
  audioUrl: z.string(),
});
export type PreviewHostConfig = z.infer<typeof previewHostConfigSchema>;
export const previewConfigElementId = 'motion-kit-preview-config';
