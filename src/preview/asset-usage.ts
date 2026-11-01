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

const groupKey = (group: AssetGroup) => `${group.kind}\0${group.key}`;

/** What one frame showed, for `observeAssetFrames`. */
export type AssetFrame = Readonly<{
  frame: number;
  assets: readonly RegisteredAsset[];
  /** The frame playback showed right before this one, if it did. */
  continued?: number | undefined;
}>;

/**
 * Add the asset groups each frame used to `spans`, the frames in order. A span grows over a frame
 * next to it, and over the frames between `continued` and `frame` when playback showed
 * `continued` right before and that frame used the group too: playback skips the frames it cannot
 * show in time. Spans of a group that come to touch are joined. The result stays ordered by start,
 * a span changed later after one with the same start. Returns `spans` itself when nothing changed.
 */
export const observeAssetFrames = (
  spans: readonly AssetSpan[],
  frames: readonly AssetFrame[],
): readonly AssetSpan[] => {
  // Each group's spans, and when each span last changed: the order among equal starts.
  const byGroup = new Map<string, AssetSpan[]>();
  const changedAt = new Map<AssetSpan, number>();
  spans.forEach((span, index) => {
    const key = groupKey(span.group);
    byGroup.set(key, [...(byGroup.get(key) ?? []), span]);
    changedAt.set(span, index);
  });
  let changes = spans.length;
  for (const { frame, assets, continued } of frames) {
    const used = new Map<string, { group: AssetGroup; failed: boolean }>();
    for (const asset of assets) {
      const group = assetGroup(asset);
      const failed = asset.status === 'failed';
      const known = used.get(groupKey(group));
      if (known === undefined) used.set(groupKey(group), { group, failed });
      else known.failed ||= failed;
    }
    for (const [key, { group, failed }] of used) {
      const own = byGroup.get(key) ?? [];
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
      const grown: AssetSpan = { group, start, end, failed: joinedFailed };
      byGroup.set(key, [...own.filter((span) => !joined.includes(span)), grown]);
      changedAt.set(grown, changes);
      changes += 1;
    }
  }
  if (changes === spans.length) return spans;
  return [...byGroup.values()]
    .flat()
    .toSorted((a, b) => a.start - b.start || (changedAt.get(a) ?? 0) - (changedAt.get(b) ?? 0));
};

/** `observeAssetFrames` for one frame. */
export const observeAssets = (
  spans: readonly AssetSpan[],
  frame: number,
  assets: readonly RegisteredAsset[],
  continued?: number,
): readonly AssetSpan[] => observeAssetFrames(spans, [{ frame, assets, continued }]);
