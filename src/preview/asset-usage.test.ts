import { describe, expect, it } from 'vitest';

import { type RegisteredAsset } from '../lib/preview-protocol.ts';
import { assetGroup, observeAssets, type AssetSpan } from './asset-usage.ts';

const image = (source: string, status: RegisteredAsset['status'] = 'ready'): RegisteredAsset => ({
  kind: 'image',
  source,
  status,
});
const clip = (name: string, frame: number) =>
  image(`media/clips/${name}/f_${String(frame + 1).padStart(5, '0')}.jpg`);
const ranges = (spans: readonly AssetSpan[]) =>
  spans.map(({ group, start, end }) => `${group.label} [${start}, ${end})`);

describe('assetGroup', () => {
  it('collapses the number of an image sequence frame, and names it by its folder', () => {
    expect(assetGroup(clip('vows', 0))).toEqual({
      kind: 'image',
      key: 'media/clips/vows/f_*.jpg',
      label: 'vows/f_*.jpg',
    });
    expect(assetGroup(clip('vows', 41)).key).toBe(assetGroup(clip('vows', 0)).key);
    expect(assetGroup(clip('toast', 0)).key).not.toBe(assetGroup(clip('vows', 0)).key);
  });

  it('keeps a file without a number on its own', () => {
    expect(assetGroup(image('photos/cake.png'))).toEqual({
      kind: 'image',
      key: 'photos/cake.png',
      label: 'cake.png',
    });
    expect(assetGroup({ kind: 'font', source: '/fonts/inter.woff2', status: 'ready' }).key).toBe(
      '/fonts/inter.woff2',
    );
    // Only the number at the end of the name counts: these are different pictures.
    expect(assetGroup(image('2024/a.png')).key).not.toBe(assetGroup(image('2025/a.png')).key);
  });

  it('groups data URLs, which have no name, by kind', () => {
    expect(assetGroup(image('data:image/png;base64,AAAA'))).toEqual({
      kind: 'image',
      key: 'data:',
      label: 'data: URL',
    });
    expect(
      assetGroup({ kind: 'font', source: 'data:font/woff2;base64,AA', status: 'ready' }).kind,
    ).toBe('font');
  });
});

describe('observeAssets', () => {
  it('grows a span over the adjacent frames that use its group', () => {
    let spans: readonly AssetSpan[] = [];
    for (const frame of [3, 4, 5]) spans = observeAssets(spans, frame, [clip('vows', frame)]);
    expect(ranges(spans)).toEqual(['vows/f_*.jpg [3, 6)']);
  });

  it('joins frames seen in any order once they touch', () => {
    let spans: readonly AssetSpan[] = [];
    for (const frame of [5, 3, 4]) spans = observeAssets(spans, frame, [clip('vows', frame)]);
    expect(ranges(spans)).toEqual(['vows/f_*.jpg [3, 6)']);
  });

  it('bridges the frames playback skipped, but not a gap between unrelated looks', () => {
    let spans = observeAssets([], 10, [clip('vows', 10)]);
    // Playback went on from 10 and showed 13 next.
    spans = observeAssets(spans, 13, [clip('vows', 13)], 10);
    expect(ranges(spans)).toEqual(['vows/f_*.jpg [10, 14)']);
    // A seek to 20 is not a continuation.
    spans = observeAssets(spans, 20, [clip('vows', 20)]);
    expect(ranges(spans)).toEqual(['vows/f_*.jpg [10, 14)', 'vows/f_*.jpg [20, 21)']);
  });

  it('does not bridge to a group the previous frame did not use', () => {
    let spans = observeAssets([], 10, [clip('vows', 10)]);
    spans = observeAssets(spans, 12, [clip('toast', 12)], 10);
    spans = observeAssets(spans, 16, [clip('vows', 16), clip('toast', 16)], 12);
    expect(ranges(spans)).toEqual([
      'vows/f_*.jpg [10, 11)',
      'toast/f_*.jpg [12, 17)',
      'vows/f_*.jpg [16, 17)',
    ]);
  });

  it('counts a group once per frame and marks a span that failed to load', () => {
    const spans = observeAssets([], 0, [
      image('photos/a_1.png'),
      image('photos/a_2.png', 'failed'),
    ]);
    expect(spans).toEqual([
      {
        group: { kind: 'image', key: 'photos/a_*.png', label: 'photos/a_*.png' },
        start: 0,
        end: 1,
        failed: true,
      },
    ]);
  });

  it('keeps the spans unchanged when a frame used nothing new', () => {
    const spans = observeAssets([], 0, [clip('vows', 0)]);
    expect(observeAssets(spans, 0, [clip('vows', 0)])).toBe(spans);
  });
});
