import { type RegisteredAsset } from '../lib/preview-protocol.ts';

/**
 * The assets one timeline item stands for: one file, or every data URL of a kind. A numbered name is
 * not taken for a frame of an image sequence: photos named by the time they were taken
 * (`IMG20261031111549.jpg`) number as closely as the frames of one, so a video made of stills
 * shows as a run of short items, one per still.
 */
export type AssetGroup = Readonly<{ kind: string; key: string; label: string }>;

/** Frames `[start, end)` that used an asset group, as far as the frames shown so far tell. */
export type AssetSpan = Readonly<{
  group: AssetGroup;
  start: number;
  end: number;
  failed: boolean;
}>;

export const assetGroup = ({ kind, source }: RegisteredAsset): AssetGroup => {
  // A data URL has no name, and each one is different, so they are one group per kind.
  if (source.startsWith('data:')) return { kind, key: 'data:', label: 'data: URL' };
  return { kind, key: source, label: source.slice(source.lastIndexOf('/') + 1) };
};

const sameGroup = (a: AssetGroup, b: AssetGroup) => a.kind === b.kind && a.key === b.key;

/**
 * Add the asset groups shown `frame` used to `spans`. A span grows over a frame next to it, and
 * over the frames between `continued` and `frame` when playback showed `continued` right before
 * and that frame used the group too: playback skips the frames it cannot show in time. Spans of a
 * group that come to touch are joined. Returns `spans` itself when nothing changed.
 */
export const observeAssets = (
  spans: readonly AssetSpan[],
  frame: number,
  assets: readonly RegisteredAsset[],
  continued?: number,
): readonly AssetSpan[] => {
  const used: { group: AssetGroup; failed: boolean }[] = [];
  for (const asset of assets) {
    const group = assetGroup(asset);
    const failed = asset.status === 'failed';
    const known = used.find((item) => sameGroup(item.group, group));
    if (known === undefined) used.push({ group, failed });
    else known.failed ||= failed;
  }
  let next = spans;
  for (const { group, failed } of used) {
    const own = next.filter((span) => sameGroup(span.group, group));
    const covering = own.find((span) => span.start <= frame && frame < span.end);
    if (covering !== undefined && (covering.failed || !failed)) continue;
    const bridged =
      continued !== undefined && continued < frame
        ? own.find((span) => span.start <= continued && continued < span.end)
        : undefined;
    let start = Math.min(frame, bridged?.start ?? frame);
    let end = frame + 1;
    let joinedFailed = failed;
    // Join every span of the group that overlaps or touches [start, end).
    const joined = own.filter((span) => span.start <= end && start <= span.end);
    for (const span of joined) {
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
      joinedFailed ||= span.failed;
    }
    next = [
      ...next.filter((span) => !joined.includes(span)),
      { group, start, end, failed: joinedFailed },
    ].toSorted((a, b) => a.start - b.start);
  }
  return next;
};
