import { expect, it } from 'vitest';

import { createAudioPlayer, mutedSources, type AudioGraph } from './audio.ts';

/** Records what the player asks of Web Audio. */
const fakeGraph = () => {
  const started: {
    src: string;
    when: number;
    offset: number;
    duration: number;
    gain: () => number;
  }[] = [];
  let stopped = 0;
  const graph = {
    currentTime: 10,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the player only connects to it.
    destination: {} as AudioNode,
    decodeAudioData: (data: ArrayBuffer) => {
      const text = new TextDecoder().decode(data);
      if (text === 'broken') return Promise.reject(new Error('undecodable'));
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tagged with its source for the assertions below.
      return Promise.resolve({ text } as unknown as AudioBuffer);
    },
    createGain: () => {
      const gain = { gain: { value: 1 }, connect: (node: unknown) => node, disconnect: () => {} };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the subset the player uses.
      return gain as unknown as GainNode;
    },
    createBufferSource: () => {
      let gainNode: { gain: { value: number } } | undefined;
      const source = {
        buffer: undefined as { text: string } | undefined,
        connect: (node: { gain: { value: number } }) => {
          gainNode = node;
          return node;
        },
        disconnect: () => {},
        start: (when: number, offset: number, duration: number) =>
          started.push({
            src: source.buffer?.text ?? '',
            when,
            offset,
            duration,
            gain: () => gainNode?.gain.value ?? Number.NaN,
          }),
        stop: () => {
          stopped += 1;
        },
      };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the subset the player uses.
      return source as unknown as AudioBufferSourceNode;
    },
  } satisfies AudioGraph;
  return { graph, started, stopped: () => stopped };
};
const loader = (loads: string[]) => (src: string) => {
  loads.push(src);
  return Promise.resolve(new TextEncoder().encode(src === 'bad.wav' ? 'broken' : src).buffer);
};

it('decodes each source once and reports the ones that cannot play', async () => {
  const loads: string[] = [];
  const fake = fakeGraph();
  const player = createAudioPlayer(fake.graph, loader(loads));
  expect(await player.prepare(['voice.wav', 'bad.wav', 'voice.wav'])).toEqual(['bad.wav']);
  expect(await player.prepare(['voice.wav'])).toEqual([]);
  expect(loads).toEqual(['voice.wav', 'bad.wav']);
  player.forget();
  expect(await player.prepare(['voice.wav'])).toEqual([]);
  expect(loads).toEqual(['voice.wav', 'bad.wav', 'voice.wav']);
});

it('drops a decode that was still running when the sources were forgotten', async () => {
  const fake = fakeGraph();
  const pending: ((text: string) => void)[] = [];
  const player = createAudioPlayer(
    fake.graph,
    () =>
      new Promise((resolve) => {
        pending.push((text) => resolve(new TextEncoder().encode(text).buffer));
      }),
  );
  const stale = player.prepare(['voice.wav']);
  player.forget();
  const fresh = player.prepare(['voice.wav']);
  pending[1]?.('new take');
  await fresh;
  pending[0]?.('old take');
  await stale;
  player.start([{ src: 'voice.wav', delay: 0, offset: 0, duration: 1, gain: 1 }], new Set());
  expect(fake.started.map((start) => start.src)).toEqual(['new take']);
});

it('starts clips on the context clock, muted ones silent, and stops the previous ones', async () => {
  const fake = fakeGraph();
  const player = createAudioPlayer(fake.graph, loader([]));
  await player.prepare(['voice.wav', 'clip.wav']);
  const clips = [
    { src: 'voice.wav', delay: 0.5, offset: 1, duration: 2, gain: 0.8 },
    { src: 'clip.wav', delay: 0, offset: 0, duration: 1, gain: 1 },
    { src: 'missing.wav', delay: 0, offset: 0, duration: 1, gain: 1 },
  ];
  player.start(clips, new Set(['clip.wav']));
  expect(fake.started.map(({ gain, ...rest }) => ({ ...rest, gain: gain() }))).toEqual([
    { src: 'voice.wav', when: 10.5, offset: 1, duration: 2, gain: 0.8 },
    { src: 'clip.wav', when: 10, offset: 0, duration: 1, gain: 0 },
  ]);
  player.setMuted('clip.wav', false);
  player.setMuted('voice.wav', true);
  expect(fake.started.map(({ gain }) => gain())).toEqual([0, 1]);
  player.start([], new Set());
  expect(fake.stopped()).toBe(2);
});

it('keeps muted sources per project and survives a corrupt entry', () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
  const project = mutedSources(storage, '/a');
  project.save(new Set(['b.wav', 'a.wav']));
  expect(items.get('motion-kit-preview:muted:/a')).toBe('["a.wav","b.wav"]');
  expect(project.load()).toEqual(new Set(['a.wav', 'b.wav']));
  expect(mutedSources(storage, '/b').load()).toEqual(new Set());
  items.set('motion-kit-preview:muted:/a', '{nope');
  expect(project.load()).toEqual(new Set());
});

it('lets a mute through when storage refuses to keep it', () => {
  const blocked = mutedSources(
    {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
    },
    '/a',
  );
  expect(() => blocked.save(new Set(['a.wav']))).not.toThrow();
});
