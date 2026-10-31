import { type ScheduledClip } from './schedule.ts';

/** The part of `AudioContext` the player drives; injected so scheduling is testable. */
export type AudioGraph = Readonly<{
  currentTime: number;
  destination: AudioNode;
  decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer>;
  createBufferSource: () => AudioBufferSourceNode;
  createGain: () => GainNode;
}>;

export type AudioPlayer = Readonly<{
  /** Fetch and decode each source once; resolves with the sources that could not be played. */
  prepare: (srcs: readonly string[]) => Promise<readonly string[]>;
  /** Start the clips relative to `currentTime`, skipping muted or undecoded sources. */
  start: (clips: readonly ScheduledClip[], muted: ReadonlySet<string>) => void;
  /** Mute or unmute the clips already playing from `src`. */
  setMuted: (src: string, muted: boolean) => void;
  stop: () => void;
}>;

type Voice = Readonly<{
  src: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  level: number;
}>;

/**
 * Preview audio: the declared clips through Web Audio, decoded once per source. Playback reads
 * the same `AudioContext` clock the playhead does, so picture follows sound.
 */
export const createAudioPlayer = (
  graph: AudioGraph,
  load: (src: string) => Promise<ArrayBuffer>,
): AudioPlayer => {
  const buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  const decoded = new Map<string, AudioBuffer>();
  let voices: Voice[] = [];
  const decode = (src: string) => {
    let buffer = buffers.get(src);
    if (buffer === undefined) {
      buffer = load(src)
        .then((data) => graph.decodeAudioData(data))
        .then(
          (value) => {
            decoded.set(src, value);
            return value;
          },
          () => undefined,
        );
      buffers.set(src, buffer);
    }
    return buffer;
  };
  const stop = () => {
    for (const voice of voices) {
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    voices = [];
  };
  return {
    prepare: async (srcs) => {
      const unique = [...new Set(srcs)];
      const results = await Promise.all(unique.map(decode));
      return unique.filter((_, index) => results[index] === undefined);
    },
    start: (clips, muted) => {
      stop();
      const now = graph.currentTime;
      voices = clips.flatMap((clip): Voice[] => {
        const buffer = decoded.get(clip.src);
        if (buffer === undefined) return [];
        const source = graph.createBufferSource();
        const gain = graph.createGain();
        source.buffer = buffer;
        gain.gain.value = muted.has(clip.src) ? 0 : clip.gain;
        source.connect(gain).connect(graph.destination);
        source.start(now + clip.delay, clip.offset, clip.duration);
        return [{ src: clip.src, source, gain, level: clip.gain }];
      });
    },
    setMuted: (src, muted) => {
      for (const voice of voices)
        if (voice.src === src) voice.gain.gain.value = muted ? 0 : voice.level;
    },
    stop,
  };
};

/** Per-project muted sources, kept in `localStorage` across reloads. */
export const mutedSources = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  projectRoot: string,
) => {
  const key = `motion-kit-preview:muted:${projectRoot}`;
  return {
    load: (): ReadonlySet<string> => {
      try {
        const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
        return new Set(
          Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [],
        );
      } catch {
        return new Set();
      }
    },
    save: (muted: ReadonlySet<string>) =>
      storage.setItem(key, JSON.stringify([...muted].toSorted())),
  };
};
