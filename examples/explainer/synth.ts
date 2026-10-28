// The explainer's music bed and transition cue, synthesised from nothing but arithmetic, so the
// soundtrack needs no download, no licence and no network (`fetch-assets.ts` writes both as WAV).
//
//   bed     a quiet loop in C major at 92 BPM: a soft detuned pad on Fmaj7 – G6 – Em7 – Am7, a
//           plucked eighth-note arpeggio an octave up, a round bass on beats 1 and 3, and a faint
//           off-beat shaker. It is mixed to sit under a voice, not to be listened to.
//   whoosh  0.6 s of noise swept up through a resonant band-pass, swelling and falling away.
//
// Every voice is a pure function of the sample index plus one seeded noise source, so the same
// call writes the same file on every run. Across machines `Math.sin` and friends are not
// guaranteed bit-identical, which does not matter here: the WAVs are generated locally and never
// committed or compared.

export const SAMPLE_RATE = 48_000;

/** A stereo buffer: one Float32Array per channel, samples in [-1, 1]. */
export type Stereo = { readonly left: Float32Array; readonly right: Float32Array };

const TAU = Math.PI * 2;

/** A deterministic [-1, 1) noise source (mulberry32), so the shaker and the whoosh never vary. */
const noise = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4_294_967_296) * 2 - 1;
  };
};

const midiHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

const BPM = 92;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;

/** One bar per chord, as MIDI notes: the pad voicing (around middle C) and the bass root. */
const PROGRESSION: readonly { readonly pad: readonly number[]; readonly root: number }[] = [
  { pad: [53, 57, 60, 64], root: 41 }, // Fmaj7
  { pad: [55, 59, 62, 64], root: 43 }, // G6
  { pad: [52, 55, 59, 62], root: 40 }, // Em7
  { pad: [57, 60, 64, 67], root: 45 }, // Am7
];

const chordAt = (bar: number) =>
  PROGRESSION[((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length] ??
  PROGRESSION[0];

/** 0 → 1 → 0 over a bar with soft edges, so consecutive chords crossfade instead of stepping. */
const padEnvelope = (local: number): number => {
  const attack = Math.min(1, local / 0.6);
  const release = Math.min(1, (BAR + 0.6 - local) / 0.9);
  return Math.max(0, Math.min(attack, release));
};

/** A plucked note: a sine and a quieter octave, decaying from its onset. */
const pluck = (hz: number, age: number, decay: number): number =>
  age < 0
    ? 0
    : Math.exp(-age / decay) *
      (Math.sin(TAU * hz * age) + 0.25 * Math.sin(TAU * 2 * hz * age)) *
      Math.min(1, age / 0.004);

/** Fade the first and last seconds, so the bed neither clicks in nor stops dead. */
const edges = (time: number, seconds: number, fadeIn: number, fadeOut: number): number =>
  Math.min(1, time / fadeIn, Math.max(0, seconds - time) / fadeOut);

/** Scale both channels so the louder one peaks at `peak`. */
const normalise = (buffer: Stereo, peak: number): Stereo => {
  let max = 0;
  for (const channel of [buffer.left, buffer.right])
    for (const sample of channel) max = Math.max(max, Math.abs(sample));
  if (max === 0) return buffer;
  const gain = peak / max;
  for (const channel of [buffer.left, buffer.right])
    for (let index = 0; index < channel.length; index += 1)
      channel[index] = (channel[index] ?? 0) * gain;
  return buffer;
};

/** The music bed, `seconds` long. */
export const musicBed = (seconds: number): Stereo => {
  const length = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const shaker = noise(7);
  let shakerLow = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const bar = Math.floor(time / BAR);
    let padL = 0;
    let padR = 0;
    // The pad: this bar's chord and the tail of the previous one, each note two detuned sines panned apart.
    for (const offset of [0, -1]) {
      const chord = chordAt(bar + offset);
      const local = time - (bar + offset) * BAR;
      const envelope = padEnvelope(local);
      if (envelope <= 0 || chord === undefined) continue;
      for (const note of chord.pad) {
        const hz = midiHz(note);
        padL += envelope * Math.sin(TAU * hz * 0.9985 * time);
        padR += envelope * Math.sin(TAU * hz * 1.0015 * time);
      }
    }
    const chord = chordAt(bar);
    const inBar = time - bar * BAR;
    // The arpeggio: eighth notes up and down the chord an octave higher, a little to the right.
    const step = Math.floor(inBar / (BEAT / 2));
    const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
    const arpNote = (chord?.pad[pattern[step % pattern.length] ?? 0] ?? 60) + 12;
    const arp = pluck(midiHz(arpNote), inBar - step * (BEAT / 2), 0.28);
    // The bass: the root on beats 1 and 3.
    const half = Math.floor(inBar / (2 * BEAT));
    const bass = pluck(midiHz(chord?.root ?? 41), inBar - half * 2 * BEAT, 0.7);
    // The shaker: high-passed noise on every off-beat eighth, very short.
    const sinceOffbeat = ((inBar / (BEAT / 2)) % 2) - 1;
    const grain = shaker();
    shakerLow += 0.2 * (grain - shakerLow);
    const shake =
      sinceOffbeat >= 0 ? Math.exp(-(sinceOffbeat * BEAT) / 2 / 0.03) * (grain - shakerLow) : 0;
    const fade = edges(time, seconds, 2.5, 4);
    left[index] = fade * (0.11 * padL + 0.13 * arp + 0.34 * bass + 0.05 * shake);
    right[index] = fade * (0.11 * padR + 0.16 * arp + 0.34 * bass + 0.05 * shake);
  }
  return normalise({ left, right }, 0.8);
};

/** The transition cue: band-passed noise sweeping up from 300 Hz to 3.2 kHz, 0.6 s long. */
export const whoosh = (): Stereo => {
  const seconds = 0.6;
  const length = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const source = noise(11);
  // A state-variable band-pass whose centre follows the sweep.
  let low = 0;
  let band = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const progress = time / seconds;
    const centre = 300 * (3200 / 300) ** Math.min(1, progress / 0.7);
    const f = 2 * Math.sin((Math.PI * centre) / SAMPLE_RATE);
    const q = 0.35;
    const input = source();
    low += f * band;
    const high = input - low - q * band;
    band += f * high;
    // A swell to 45 % of the cue, then an exponential fall.
    const rise = Math.sin((Math.PI / 2) * Math.min(1, progress / 0.45)) ** 2;
    const fall = progress < 0.45 ? 1 : Math.exp(-(progress - 0.45) / 0.14);
    const envelope = rise * fall;
    // A slow pan from left to right, so the cue moves the way the slides do.
    const pan = 0.3 + 0.4 * progress;
    left[index] = envelope * band * (1 - pan);
    right[index] = envelope * band * pan;
  }
  return normalise({ left, right }, 0.7);
};

/** A 16-bit PCM stereo WAV of `buffer`. */
export const encodeWav = (buffer: Stereo): Uint8Array => {
  const frames = buffer.left.length;
  const dataBytes = frames * 2 * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  const pcm = (sample: number): number => Math.round(Math.max(-1, Math.min(1, sample)) * 32_767);
  for (let index = 0; index < frames; index += 1) {
    view.setInt16(44 + index * 4, pcm(buffer.left[index] ?? 0), true);
    view.setInt16(46 + index * 4, pcm(buffer.right[index] ?? 0), true);
  }
  return bytes;
};
