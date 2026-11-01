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

/**
 * The shell URL parameter naming one load of the realm frame. The frame's window outlives a
 * reload, so the document being replaced can still post; both realm messages carry their load and
 * the host only listens to the load it started.
 */
export const previewLoadParameter = 'load';
/** The realm announces itself to its parent window once the bootstrap ran. */
export const previewReadySchema = z.object({
  type: z.literal('motion-kit-preview-ready'),
  protocolVersion: z.literal(previewProtocolVersion),
  load: z.string(),
});
/**
 * The realm's shell posts this when its entry failed to load or run before the realm could
 * announce itself; a slow entry (top-level await) simply announces later.
 */
export const previewFailedType = 'motion-kit-preview-failed';
export const previewFailedSchema = z.object({
  type: z.literal(previewFailedType),
  load: z.string(),
});
/**
 * The classic script a preview realm's shell carries ahead of its entry. It runs before the module
 * graph, so it sees the entry's script fail to load or throw; capturing on the window also reaches
 * the script element's own error event.
 */
export const previewFailureReporter = `<script>addEventListener('error',function(e){if(e instanceof ErrorEvent||e.target instanceof HTMLScriptElement)parent.postMessage({type:${JSON.stringify(previewFailedType)},load:new URLSearchParams(location.search).get(${JSON.stringify(previewLoadParameter)})||''},location.origin)},true)</script>`;
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
  /** The element at a point of the shown frame, in the Composition's design pixels. */
  z.object({ type: z.literal('inspect'), id: requestId, x: z.number(), y: z.number() }),
  /** Every element of the shown frame, as a tree. */
  z.object({ type: z.literal('describe'), id: requestId }),
]);
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

/**
 * A font or image the Composition registered with `useAsset` while the frame settled. The source
 * is redacted as in asset diagnostics: no query, fragment or userinfo.
 */
export const registeredAssetSchema = z.object({
  kind: z.string(),
  source: z.string(),
  status: z.enum(['pending', 'ready', 'failed']),
});
export type RegisteredAsset = z.infer<typeof registeredAssetSchema>;

export const showOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('shown'),
    frame: z.int().nonnegative(),
    sequences: z.array(sequenceSpanSchema),
    assets: z.array(registeredAssetSchema),
  }),
  z.object({
    status: z.literal('failed'),
    diagnostics: z.tuple([DiagnosticSchema], DiagnosticSchema),
    assets: z.array(registeredAssetSchema),
  }),
  z.object({ status: z.literal('aborted') }),
]);
export type ShowOutcome =
  | Readonly<{
      status: 'shown';
      frame: number;
      sequences: readonly SequenceSpan[];
      assets: readonly RegisteredAsset[];
    }>
  | Readonly<{
      status: 'failed';
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
      assets: readonly RegisteredAsset[];
    }>
  | Readonly<{ status: 'aborted' }>;

/** The element a review comment points at, as the realm describes it. */
export const inspectedElementSchema = z.object({
  /** Tag, id and classes, as in `h1#title.lead`. */
  selector: z.string(),
  /** The start of its text content, whitespace collapsed; empty when it has none. */
  text: z.string(),
  /**
   * `file:line:column` of the JSX that created it or its nearest ancestor that has one; null when
   * no element on the way up came from JSX compiled in development.
   */
  source: z.string().nullable(),
  /** Its bounding box in design pixels, rounded. */
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type InspectedElement = z.infer<typeof inspectedElementSchema>;

/** An element of the shown frame and the elements inside it, in document order. */
export type ElementNode = InspectedElement &
  Readonly<{
    /** False when it or an ancestor is fully transparent, or it is hidden. */
    visible: boolean;
    children: readonly ElementNode[];
  }>;
export const elementNodeSchema: z.ZodType<ElementNode> = z.lazy(() =>
  inspectedElementSchema.extend({ visible: z.boolean(), children: z.array(elementNodeSchema) }),
);
/** The elements the Composition renders; past a size limit the rest are left out. */
export const elementTreeSchema = z.object({
  nodes: z.array(elementNodeSchema),
  truncated: z.boolean(),
});
export type ElementTree = Readonly<{ nodes: readonly ElementNode[]; truncated: boolean }>;

export const previewReplySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('listed'),
    id: requestId,
    result: resultSchema(z.array(descriptorSchema)),
  }),
  z.object({ type: z.literal('mounted'), id: requestId, result: resultSchema(mountReceiptSchema) }),
  z.object({ type: z.literal('shown'), id: requestId, outcome: showOutcomeSchema }),
  z.object({
    type: z.literal('inspected'),
    id: requestId,
    result: resultSchema(inspectedElementSchema.nullable()),
  }),
  z.object({
    type: z.literal('described'),
    id: requestId,
    result: resultSchema(elementTreeSchema.nullable()),
  }),
]);
// Readonly on both sides of the wire, like the Loading Page values the replies carry.
export type PreviewReply =
  | Readonly<{ type: 'listed'; id: number; result: Result<readonly LoadingDescriptor[]> }>
  | Readonly<{ type: 'mounted'; id: number; result: Result<MountReceipt> }>
  | Readonly<{ type: 'shown'; id: number; outcome: ShowOutcome }>
  | Readonly<{ type: 'inspected'; id: number; result: Result<InspectedElement | null> }>
  | Readonly<{ type: 'described'; id: number; result: Result<ElementTree | null> }>;

/** The server-sent event the events route emits after a module the realm loaded changed. */
export const previewReloadEvent = 'reload';
/** Its data: whether an audio file the host fetched is among the changes, so its decode is stale. */
export const previewReloadSchema = z.object({ audio: z.boolean() });

/** What the server inlines into the host page; every URL is absolute-path, under Vite's base. */
export const previewHostConfigSchema = z.object({
  /** The resolved project root; review comments name it for `--project-root`. */
  projectRoot: z.string(),
  /** Its real path, the prefix of the file names in `data-source`. */
  realProjectRoot: z.string(),
  /** The entry relative to the project root, which the CLI resolves it against. */
  entry: z.string(),
  /** The absolute path of the Vite config `--vite-config` named. */
  viteConfig: z.string().optional(),
  /** The composition shell in preview host mode. */
  shellUrl: z.string(),
  /** Server-sent events: `reload` after a served module changed. */
  eventsUrl: z.string(),
  /** Takes `?src=<AudioTrack src>` and answers with the file's bytes when Vite's fs policy allows it. */
  audioUrl: z.string(),
});
export type PreviewHostConfig = z.infer<typeof previewHostConfigSchema>;
export const previewConfigElementId = 'motion-kit-preview-config';
