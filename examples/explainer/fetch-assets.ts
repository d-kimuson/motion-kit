#!/usr/bin/env node
// The explainer's asset setup, in two steps (docs/design-doc/20261025-reference-examples.md,
// "Assets and provenance"). Everything it writes lands in the gitignored `assets.local/`; nothing
// under `assets/` is ever touched, and no fetched or synthesized file is committed.
//
//   step 1  what needs nothing but Node and FFmpeg: the music bed and the transition whoosh
//           (synthesised by `synth.ts`), and silent voice placeholders. The placeholder characters
//           need no file at all — `assets: 'placeholder'` draws a badge in the speaker layer — so CI
//           runs step 1 before the smoke render.
//   step 2  the real thing, locally only: the voice and the two portraits from a local VOICEVOX
//           engine (the voice falls back to macOS `say -v Kyoko` where no engine answers). Every
//           part skips with an instruction when its input is missing, so step 1 alone always leaves
//           a renderable tree. Each sentence is synthesized on its own and fitted to the sentence's
//           slot (`plan.ts`), so the voice moves on to a sentence on the frame its subtitle does.
//
//   node examples/explainer/fetch-assets.ts                # both steps
//   node examples/explainer/fetch-assets.ts --placeholders # step 1 only (what CI runs)
//
// Run it from the repository root: the paths below are relative to it.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHARACTERS, LOCAL_PATH, musicSource, whooshSource, type Character } from './look.ts';
import { explainerStoryboard, type PlannedLine } from './plan.ts';
import { script, totalSeconds } from './script.ts';
import { encodeWav, musicBed, whoosh } from './synth.ts';

const root = LOCAL_PATH;
const voiceDir = join(root, 'voice');
const portraitDir = join(root, 'portraits');

/** The rate the storyboard is planned at; the sentence slots the voice is fitted to come from it. */
const FPS = 30;

/** Where a step reports what it did: the CLI prints, and the smoke test collects. */
export type Report = (message: string) => void;

const log: Report = (message) => console.log(`fetch-assets: ${message}`);

/** FFmpeg is a hard requirement of the render path, so a missing binary is a failure, not a skip. */
const ffmpeg = (args: readonly string[]): void => {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited ${String(result.status)}`);
};

const ffprobeSeconds = (file: string): number => {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  return Number.parseFloat(out.trim());
};

/**
 * The music bed for the whole video and the whoosh every slide change plays. Both are synthesised
 * (`synth.ts`), so they are as available as FFmpeg is and step 1 writes the real files, not stand-ins.
 */
const generateSoundtrack = (report: Report): void => {
  for (const [path, buffer] of [
    [musicSource, musicBed(totalSeconds)],
    [whooshSource, whoosh()],
  ] as const) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encodeWav(buffer));
    report(`step 1: synthesised ${path}`);
  }
};

/**
 * Silent placeholders at the paths the Composition's audio tracks name. The tracks are descriptor
 * data, so they cannot switch on `--props`: a placeholder render without these files would fail at
 * `asset.load-failed`, and with them it is silent digital silence.
 */
const placeholderVoice = (report: Report): void => {
  mkdirSync(voiceDir, { recursive: true });
  for (const line of script.lines) {
    const target = join(voiceDir, `${line.id}.wav`);
    if (existsSync(target) && !isSilentPlaceholder(target)) continue; // step 2's clip: keep it
    ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.4', target]);
  }
  report(`step 1: ${String(script.lines.length)} silent voice placeholders in ${voiceDir}`);
};

/** A placeholder is 0.4 s of silence; a real clip is longer or louder, so step 2 overwrites it. */
const isSilentPlaceholder = (file: string): boolean => Math.abs(ffprobeSeconds(file) - 0.4) < 0.001;

const voicevoxSpeaker: Record<Character, number> = { metan: 2, zundamon: 3 };

const voicevoxAvailable = async (engineUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${engineUrl}/version`);
    return response.ok;
  } catch {
    return false;
  }
};

const voicevoxClip = async (
  engineUrl: string,
  speaker: number,
  text: string,
): Promise<Uint8Array> => {
  const query = await fetch(
    `${engineUrl}/audio_query?speaker=${String(speaker)}&text=${encodeURIComponent(text)}`,
    { method: 'POST' },
  );
  if (!query.ok) throw new Error(`VOICEVOX audio_query answered ${String(query.status)}`);
  const synthesis = await fetch(`${engineUrl}/synthesis?speaker=${String(speaker)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await query.json()),
  });
  if (!synthesis.ok) throw new Error(`VOICEVOX synthesis answered ${String(synthesis.status)}`);
  return new Uint8Array(await synthesis.arrayBuffer());
};

const sayAvailable = (): boolean =>
  process.platform === 'darwin' && spawnSync('say', ['-v', '?'], { stdio: 'ignore' }).status === 0;

/**
 * The band the fit may time-stretch within: at most 25 % faster and 25 % slower than the engine
 * spoke. Inside it a tempo change is the same voice at a slightly different pace; outside it, the
 * clip keeps the clamped pace: a short one is padded with silence, a long one is cut and reported.
 */
const maxTempo = 1.25;

/**
 * The breath the fit leaves at the end of every sentence. Two sentences that end and begin on the
 * same frame sound like a single run-on one; the slot a sentence is given is speech time plus this
 * pause.
 */
const pauseSeconds = 0.4;

/** How much of a slot the speech may occupy: the slot less the pause, and at least 80 % of it. */
const speechSeconds = (slot: number): number => Math.max(slot - pauseSeconds, slot * 0.8);

/**
 * The `atempo` that lands a `raw`-second clip on `speech` seconds of its slot, clamped to the band
 * above. Pure, so the smoke test holds the bounds without needing an engine to synthesize a clip.
 */
export const fitTempo = (raw: number, speech: number): number =>
  Math.min(maxTempo, Math.max(1 / maxTempo, raw / speech));

/**
 * Fit one synthesized clip to its slot: the lead-in trimmed, the speech tempo'd to the script's own
 * pace, and the result padded or cut to exactly `seconds`.
 *
 * The narration is timed by the script, not by the engine. `say -v Kyoko` reads a 5-character-per-
 * second line in about 80 % of its slot, so a raw clip leaves up to three seconds of silence before
 * the next line — and a slower engine's clip is cut mid-word by the track's `endInFrames` instead.
 * Fitting here means every clip is exactly as long as its slot, so the subtitle, the speaker's bob
 * and the voice start and end together, with the same pause after every sentence. The lead-in has to
 * go too: `say` writes ~0.1 s of digital silence before the first phoneme, which at 30 fps is three
 * frames of the slot with the speaker lit and nobody speaking.
 *
 * Two passes, because the length to measure is the trimmed one: a lead-in left in the measurement
 * would be read as speech and the tempo would come out slow by its share.
 *
 * A clip too long even at the fastest tempo is cut at the slot's end, and `report` names it: the
 * fix is a shorter sentence or a longer slot in the script, not a faster voice.
 */
export const fitClip = (
  input: string,
  target: string,
  seconds: number,
  report: Report = log,
): number => {
  const trimmed = tempPath(`trim-${basename(target)}`);
  ffmpeg([
    '-i',
    input,
    '-af',
    'silenceremove=start_periods=1:start_threshold=-50dB:detection=peak',
    '-ar',
    '48000',
    '-ac',
    '1',
    trimmed,
  ]);
  const speech = ffprobeSeconds(trimmed);
  const tempo = fitTempo(speech, speechSeconds(seconds));
  const overrun = speech / tempo - seconds;
  if (overrun > 0.01)
    report(
      `warning: ${basename(target)} is cut by ${overrun.toFixed(2)} s at atempo ${tempo.toFixed(2)}; shorten the sentence or lengthen its slot`,
    );
  ffmpeg([
    '-i',
    trimmed,
    '-af',
    `atempo=${tempo.toFixed(4)},apad`,
    '-t',
    String(seconds),
    '-ar',
    '48000',
    '-ac',
    '1',
    target,
  ]);
  rmSync(trimmed, { force: true });
  return tempo;
};

const tempPath = (name: string): string => {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  return join(root, 'tmp', name);
};

/** `say -v Kyoko` into an AIFF the fit reads like any engine's clip. */
const saySpeak = (text: string, target: string): void => {
  const spoken = spawnSync('say', ['-v', 'Kyoko', '-o', target, text], { stdio: 'inherit' });
  if (spoken.status !== 0) throw new Error(`say exited ${String(spoken.status)}`);
};

type Engine = { readonly kind: 'voicevox'; readonly url: string } | { readonly kind: 'say' };

const speak = async (
  engine: Engine,
  speaker: Character,
  text: string,
  target: string,
): Promise<void> => {
  if (engine.kind === 'say') return saySpeak(text, target);
  writeFileSync(target, await voicevoxClip(engine.url, voicevoxSpeaker[speaker], text));
};

/**
 * One line's clip: each sentence synthesized on its own and fitted to its sentence's slot, then the
 * fitted parts joined and cut to exactly the line's frames. Fitting per sentence is what keeps the
 * voice on the subtitle: the subtitle changes sentence on a frame the plan computes, and a whole-line
 * fit would let the engine's own pacing drift the second sentence off it by up to a second. The
 * pause each fit leaves at a sentence's end is the breath between two sentences of one speaker.
 */
const lineClip = async (
  engine: Engine,
  line: PlannedLine,
  target: string,
): Promise<readonly number[]> => {
  const tempos: number[] = [];
  const parts: string[] = [];
  for (const [index, sentence] of line.sentences.entries()) {
    const raw = tempPath(`${line.id}-${String(index)}.${engine.kind === 'say' ? 'aiff' : 'wav'}`);
    const part = tempPath(`${line.id}-${String(index)}-fitted.wav`);
    await speak(engine, line.speaker, sentence.text, raw);
    tempos.push(fitClip(raw, part, sentence.frames / FPS));
    rmSync(raw, { force: true });
    parts.push(part);
  }
  ffmpeg([
    ...parts.flatMap((part) => ['-i', part]),
    '-filter_complex',
    `${parts.map((_, index) => `[${String(index)}:a]`).join('')}concat=n=${String(parts.length)}:v=0:a=1,apad[out]`,
    '-map',
    '[out]',
    '-t',
    String(line.frames / FPS),
    '-ar',
    '48000',
    '-ac',
    '1',
    target,
  ]);
  for (const part of parts) rmSync(part, { force: true });
  return tempos;
};

const engineUrl = (): string => process.env['VOICEVOX_ENGINE_URL'] ?? 'http://127.0.0.1:50021';

/**
 * Step 2's voice: VOICEVOX where an engine answers, `say` where it does not, nothing otherwise.
 * Whichever spoke, every clip is exactly its line's seconds, so `durations.json` records the slots
 * the timeline already uses rather than the engine's own timing.
 */
const fetchVoice = async (useVoicevox: boolean): Promise<void> => {
  mkdirSync(voiceDir, { recursive: true });
  if (!useVoicevox && !sayAvailable()) {
    log(
      'step 2: voice skipped — start a local VOICEVOX engine (VOICEVOX_ENGINE_URL) or run this on macOS with `say`',
    );
    return;
  }
  const engine: Engine = useVoicevox ? { kind: 'voicevox', url: engineUrl() } : { kind: 'say' };
  const durations: Record<string, number> = {};
  const tempos: number[] = [];
  for (const line of explainerStoryboard(FPS).lines) {
    const target = join(voiceDir, `${line.id}.wav`);
    tempos.push(...(await lineClip(engine, line, target)));
    durations[line.id] = Math.round(ffprobeSeconds(target) * 1000) / 1000;
  }
  writeFileSync(join(voiceDir, 'durations.json'), `${JSON.stringify(durations, null, 2)}\n`);
  log(
    `step 2: ${String(script.lines.length)} voice clips via ${engine.kind === 'voicevox' ? 'VOICEVOX' : 'say -v Kyoko'} into ${voiceDir}, fitted sentence by sentence with atempo ${Math.min(...tempos).toFixed(2)}-${Math.max(...tempos).toFixed(2)} (durations.json is local-only)`,
  );
};

/** The engine's own speaker list, enough of it to find a style's character. */
type SpeakerEntry = {
  readonly speaker_uuid: string;
  readonly styles: readonly { readonly id: number }[];
};

const isSpeakerList = (value: unknown): value is readonly SpeakerEntry[] =>
  Array.isArray(value) &&
  value.every(
    (entry: unknown) =>
      typeof entry === 'object' &&
      entry !== null &&
      'speaker_uuid' in entry &&
      typeof entry.speaker_uuid === 'string' &&
      'styles' in entry &&
      Array.isArray(entry.styles),
  );

/** A VOICEVOX GET answered as JSON; a non-2xx status throws rather than parsing an error page. */
const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`VOICEVOX ${url} answered ${String(response.status)}`);
  return response.json();
};

/**
 * Step 2's portraits: the character art the VOICEVOX engine ships for each speaker (`/speaker_info`,
 * 坂本アヒル's 立ち絵), written as `<root>/portraits/<character>.png`. They come with the engine the
 * voice already needs, under the same character guideline, so there is no separate manual download.
 */
const fetchPortraits = async (useVoicevox: boolean): Promise<void> => {
  if (!useVoicevox) {
    log('step 2: portraits skipped — they come from a local VOICEVOX engine (VOICEVOX_ENGINE_URL)');
    return;
  }
  const url = engineUrl();
  const speakers: unknown = await fetchJson(`${url}/speakers`);
  if (!isSpeakerList(speakers)) throw new Error('VOICEVOX /speakers answered an unexpected shape');
  mkdirSync(portraitDir, { recursive: true });
  for (const character of CHARACTERS) {
    const entry = speakers.find((speaker) =>
      speaker.styles.some((style) => style.id === voicevoxSpeaker[character]),
    );
    if (entry === undefined)
      throw new Error(`VOICEVOX has no speaker with style ${String(voicevoxSpeaker[character])}`);
    const info: unknown = await fetchJson(`${url}/speaker_info?speaker_uuid=${entry.speaker_uuid}`);
    if (
      typeof info !== 'object' ||
      info === null ||
      !('portrait' in info) ||
      typeof info.portrait !== 'string'
    )
      throw new Error(`VOICEVOX /speaker_info has no portrait for ${character}`);
    writeFileSync(join(portraitDir, `${character}.png`), Buffer.from(info.portrait, 'base64'));
  }
  log(
    `step 2: ${String(CHARACTERS.length)} portraits from VOICEVOX /speaker_info into ${portraitDir}`,
  );
};

/**
 * Step 1 as one call: the music bed, the whoosh and the silent voice placeholders. It needs Node and
 * FFmpeg and nothing else, so the smoke test runs it as its own setup — CI has no committed media,
 * no VOICEVOX engine and no network (docs/design-doc/20261025-reference-examples.md, "Assets and
 * provenance").
 */
export const generatePlaceholders = (report: Report = log): void => {
  mkdirSync(root, { recursive: true });
  generateSoundtrack(report);
  placeholderVoice(report);
  report('step 1 done');
};

const main = async (): Promise<void> => {
  generatePlaceholders();
  if (process.argv.includes('--placeholders')) return;
  const useVoicevox = await voicevoxAvailable(engineUrl());
  await fetchPortraits(useVoicevox);
  await fetchVoice(useVoicevox);
};

// Importing this file (the smoke test does) runs nothing: only `node examples/explainer/fetch-assets.ts`
// performs the setup.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
