import { describe, expect, it } from 'vitest';

import { type RegisteredAsset } from '../lib/preview-protocol.ts';
import { assetGroup, observeAssets, type AssetSpan } from './asset-usage.ts';

const image = (source: string, status: RegisteredAsset['status'] = 'ready'): RegisteredAsset => ({
  kind: 'image',
  source,
  status,
});
const photo = (name: string) => image(`media/photos/${name}.jpg`);
const ranges = (spans: readonly AssetSpan[]) =>
  spans.map(({ group, start, end }) => `${group.label} [${start}, ${end})`);

describe('assetGroup', () => {
  it('keeps every file on its own, numbered or not', () => {
    expect(assetGroup(image('photos/cake.png'))).toEqual({
      kind: 'image',
      key: 'photos/cake.png',
      label: 'cake.png',
    });
    expect(assetGroup({ kind: 'font', source: '/fonts/inter.woff2', status: 'ready' }).key).toBe(
      '/fonts/inter.woff2',
    );
    // Photos named by when they were taken number like the frames of a sequence.
    expect(assetGroup(photo('IMG20261031111549')).key).not.toBe(
      assetGroup(photo('IMG20261031111550')).key,
    );
    expect(assetGroup(image('clips/vows/f_00001.jpg')).key).not.toBe(
      assetGroup(image('clips/vows/f_00002.jpg')).key,
    );
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
    for (const frame of [3, 4, 5]) spans = observeAssets(spans, frame, [photo('vows')]);
    expect(ranges(spans)).toEqual(['vows.jpg [3, 6)']);
  });

  it('joins frames seen in any order once they touch', () => {
    let spans: readonly AssetSpan[] = [];
    for (const frame of [5, 3, 4]) spans = observeAssets(spans, frame, [photo('vows')]);
    expect(ranges(spans)).toEqual(['vows.jpg [3, 6)']);
  });

  it('bridges the frames playback skipped, but not a gap between unrelated looks', () => {
    let spans = observeAssets([], 10, [photo('vows')]);
    // Playback went on from 10 and showed 13 next.
    spans = observeAssets(spans, 13, [photo('vows')], 10);
    expect(ranges(spans)).toEqual(['vows.jpg [10, 14)']);
    // A seek to 20 is not a continuation.
    spans = observeAssets(spans, 20, [photo('vows')]);
    expect(ranges(spans)).toEqual(['vows.jpg [10, 14)', 'vows.jpg [20, 21)']);
  });

  it('does not bridge to a group the previous frame did not use', () => {
    let spans = observeAssets([], 10, [photo('vows')]);
    spans = observeAssets(spans, 12, [photo('toast')], 10);
    spans = observeAssets(spans, 16, [photo('vows'), photo('toast')], 12);
    expect(ranges(spans)).toEqual(['vows.jpg [10, 11)', 'toast.jpg [12, 17)', 'vows.jpg [16, 17)']);
  });

  it('counts a group once per frame and marks a span that failed to load', () => {
    const spans = observeAssets([], 0, [
      image('data:image/png;base64,AA'),
      image('data:image/png;base64,BB', 'failed'),
      photo('cake'),
    ]);
    expect(spans).toEqual([
      {
        group: { kind: 'image', key: 'data:', label: 'data: URL' },
        start: 0,
        end: 1,
        failed: true,
      },
      {
        group: { kind: 'image', key: 'media/photos/cake.jpg', label: 'cake.jpg' },
        start: 0,
        end: 1,
        failed: false,
      },
    ]);
  });

  it('lays the stills of an image sequence one after another, each over the frames it was shown', () => {
    const still = (index: number) => image(`clips/vows/f_${String(index).padStart(5, '0')}.jpg`);
    let spans: readonly AssetSpan[] = [];
    // Two frames a still, and playback skipped frame 3.
    for (const [frame, continued] of [[0], [1, 0], [2, 1], [4, 2]] as const)
      spans = observeAssets(spans, frame, [still(Math.floor(frame / 2) + 1)], continued);
    expect(ranges(spans)).toEqual([
      'f_00001.jpg [0, 2)',
      'f_00002.jpg [2, 3)',
      'f_00003.jpg [4, 5)',
    ]);
  });

  it('keeps the spans unchanged when a frame used nothing new', () => {
    const spans = observeAssets([], 0, [photo('vows')]);
    expect(observeAssets(spans, 0, [photo('vows')])).toBe(spans);
  });
});
