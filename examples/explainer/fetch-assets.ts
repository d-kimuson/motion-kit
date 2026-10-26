#!/usr/bin/env node
// The explainer's asset setup, in two steps (docs/design-doc/20261025-reference-examples.md,
// "Assets and provenance"). Everything it writes lands in the gitignored `assets.local/`; nothing
// under `assets/` is ever touched, and no fetched or synthesized file is committed.
//
//   step 1  placeholders: FFmpeg `color` sprites, a `sine` tone bed, and silent voice placeholders.
//           Needs only the FFmpeg the render path already requires — no network, no engine — so CI
//           runs it before the smoke render.
//   step 2  the real thing, locally only: the 立ち絵 sprites from a manual download, and the voice
//           from a local VOICEVOX engine, or macOS `say -v Kyoko` where no engine is installed.
//           Every part skips with an instruction when its input is missing, so step 1 alone always
//           leaves a renderable tree. Each voice clip is fitted to its line's slot here rather than
//           at render time: a synthesized line is rarely exactly as long as the script says it is.
//
//   node examples/explainer/fetch-assets.ts                # both steps
//   node examples/explainer/fetch-assets.ts --placeholders # step 1 only (what CI runs)
//
// Run it from the repository root: the paths below are relative to it.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CHARACTERS,
  EXPRESSIONS,
  MOUTHS,
  characterColor,
  type Character,
  type Expression,
} from './look.ts';
import { script } from './script.ts';

const root = 'examples/explainer/assets.local';
const spritesDir = (mode: 'placeholder' | 'final') => join(root, 'sprites', mode);
const voiceDir = join(root, 'voice');
const toneBed = join(root, 'music', 'tone.wav');
const spriteSourceDir = join(root, 'sprite-source');

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

/** A placeholder sprite's colour: the character's own, shifted per expression and per mouth. */
const shade = (hex: string, factor: number): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): string => {
    const part = (value >> shift) & 0xff;
    return Math.max(0, Math.min(255, Math.round(part * factor)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
};

const expressionShade: Record<Expression, number> = {
  normal: 1,
  happy: 1.16,
  surprised: 1.3,
  thinking: 0.8,
  wink: 1.08,
  serious: 0.66,
};

/** 540x900, the aspect the sprite layer draws: the placeholders must not distort the layout. */
const spriteSize = '540x900';

const placeholderSprites = (report: Report): void => {
  const dir = spritesDir('placeholder');
  let written = 0;
  for (const character of CHARACTERS) {
    for (const expression of EXPRESSIONS) {
      for (const mouth of MOUTHS) {
        const target = join(dir, character, `${expression}-${mouth}.png`);
        mkdirSync(join(dir, character), { recursive: true });
        const factor = expressionShade[expression] * (mouth === 'open' ? 0.86 : 1);
        const colour = shade(characterColor[character], factor);
        ffmpeg([
          '-f',
          'lavfi',
          '-i',
          `color=c=${colour}:s=${spriteSize}`,
          '-frames:v',
          '1',
          target,
        ]);
        written += 1;
      }
    }
  }
  report(`step 1: ${String(written)} placeholder sprites in ${dir}`);
};

/**
 * The tone bed. It is generated so a reader can hear the pipeline, but the explainer declares no
 * music track: the placeholder render stays silent and the narrated one is voice only.
 */
const generateToneBed = (report: Report): void => {
  mkdirSync(join(root, 'music'), { recursive: true });
  ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=48000:duration=20',
    '-af',
    'volume=0.05',
    '-ac',
    '2',
    toneBed,
  ]);
  report(`step 1: tone bed ${toneBed}`);
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

const fetchSprites = (): void => {
  if (!existsSync(spriteSourceDir)) {
    log(
      `step 2: sprites skipped — download the 坂本アヒル 立ち絵 sets manually into ${spriteSourceDir}/<character>/<expression>-<mouth>.png (see docs/decisions/20261026-example-asset-licensing.accepted.md)`,
    );
    return;
  }
  const dir = spritesDir('final');
  let copied = 0;
  for (const character of CHARACTERS) {
    for (const expression of EXPRESSIONS) {
      for (const mouth of MOUTHS) {
        const source = join(spriteSourceDir, character, `${expression}-${mouth}.png`);
        if (!existsSync(source)) continue;
        const target = join(dir, character, `${expression}-${mouth}.png`);
        mkdirSync(join(dir, character), { recursive: true });
        ffmpeg([
          '-i',
          source,
          '-vf',
          `scale=540:900:force_original_aspect_ratio=decrease,pad=540:900:(ow-iw)/2:(oh-ih)/2:color=#00000000`,
          '-pix_fmt',
          'rgba',
          target,
        ]);
        copied += 1;
      }
    }
  }
  log(`step 2: ${String(copied)} fetched sprites normalised into ${dir}`);
};

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
 * clip keeps its own pace and the rest of the slot is the silence every clip is padded with.
 */
const maxTempo = 1.25;

/**
 * The breath the fit leaves at the end of every line. Two lines are two sentences by two speakers,
 * so the one that ends on the frame the next begins on sounds like a single run-on line; the slot a
 * line is given is speech time plus this pause.
 */
const linePauseSeconds = 0.4;

/** How much of a line's slot the speech may occupy: the slot less the pause, and at least 80 % of it. */
const speechSeconds = (slot: number): number => Math.max(slot - linePauseSeconds, slot * 0.8);

/**
 * The `atempo` that lands a `raw`-second clip on `speech` seconds of its line, clamped to the band
 * above. Pure, so the smoke test holds the bounds without needing an engine to synthesize a clip.
 */
export const fitTempo = (raw: number, speech: number): number =>
  Math.min(maxTempo, Math.max(1 / maxTempo, raw / speech));

/**
 * Fit one synthesized clip to its line: the lead-in trimmed, the speech tempo'd to the line's own
 * pace, and the result padded or cut to exactly the line's `seconds`.
 *
 * The narration is timed by the script, not by the engine. `say -v Kyoko` reads a 5-character-per-
 * second line in about 80 % of its slot, so a raw clip leaves up to three seconds of silence before
 * the next line — and a slower engine's clip is cut mid-word by the track's `endInFrames` instead.
 * Fitting here means every clip is exactly as long as its line, so the subtitle, the sprite and the
 * voice start and end together, with the same pause between every pair of lines. The lead-in has to
 * go too: `say` writes ~0.1 s of digital silence before the first phoneme, which at 30 fps is three
 * frames of the line's slot with the mouth moving and nobody speaking.
 *
 * Two passes, because the length to measure is the trimmed one: a lead-in left in the measurement
 * would be read as speech and the tempo would come out slow by its share.
 */
export const fitClip = (input: string, target: string, seconds: number): number => {
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
  const tempo = fitTempo(ffprobeSeconds(trimmed), speechSeconds(seconds));
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

/** `say -v Kyoko`, then the same fit every engine's clip goes through. Returns the tempo it used. */
const sayClip = (text: string, seconds: number, target: string): number => {
  const aiff = tempPath('line.aiff');
  const spoken = spawnSync('say', ['-v', 'Kyoko', '-o', aiff, text], { stdio: 'inherit' });
  if (spoken.status !== 0) throw new Error(`say exited ${String(spoken.status)}`);
  const tempo = fitClip(aiff, target, seconds);
  rmSync(aiff, { force: true });
  return tempo;
};

/**
 * Step 2's voice: VOICEVOX where an engine answers, `say` where it does not, nothing otherwise.
 * Whichever spoke, `fitClip` lands the clip on the line's own seconds before it is measured, so
 * `durations.json` records the slots the timeline already uses rather than the engine's own timing.
 */
const fetchVoice = async (): Promise<void> => {
  mkdirSync(voiceDir, { recursive: true });
  const engineUrl = process.env['VOICEVOX_ENGINE_URL'] ?? 'http://127.0.0.1:50021';
  const useVoicevox = await voicevoxAvailable(engineUrl);
  if (!useVoicevox && !sayAvailable()) {
    log(
      'step 2: voice skipped — start a local VOICEVOX engine (VOICEVOX_ENGINE_URL) or run this on macOS with `say`',
    );
    return;
  }
  const durations: Record<string, number> = {};
  const tempos: number[] = [];
  for (const line of script.lines) {
    const target = join(voiceDir, `${line.id}.wav`);
    if (useVoicevox) {
      const raw = tempPath(`${line.id}.wav`);
      writeFileSync(raw, await voicevoxClip(engineUrl, voicevoxSpeaker[line.speaker], line.text));
      tempos.push(fitClip(raw, target, line.seconds));
      rmSync(raw, { force: true });
    } else {
      tempos.push(sayClip(line.text, line.seconds, target));
    }
    durations[line.id] = Math.round(ffprobeSeconds(target) * 1000) / 1000;
  }
  writeFileSync(join(voiceDir, 'durations.json'), `${JSON.stringify(durations, null, 2)}\n`);
  log(
    `step 2: ${String(script.lines.length)} voice clips via ${useVoicevox ? 'VOICEVOX' : 'say -v Kyoko'} into ${voiceDir}, fitted to their lines with atempo ${Math.min(...tempos).toFixed(2)}-${Math.max(...tempos).toFixed(2)} (durations.json is local-only)`,
  );
};

/**
 * Step 1 as one call: the sprites, the tone bed and the silent voice placeholders. It needs FFmpeg
 * and nothing else, so the smoke test runs it as its own setup — CI has no committed media, no
 * VOICEVOX engine and no network (docs/design-doc/20261025-reference-examples.md, "Assets and
 * provenance").
 */
export const generatePlaceholders = (report: Report = log): void => {
  mkdirSync(root, { recursive: true });
  placeholderSprites(report);
  generateToneBed(report);
  placeholderVoice(report);
  report('step 1 done');
};

const main = async (): Promise<void> => {
  generatePlaceholders();
  if (process.argv.includes('--placeholders')) return;
  fetchSprites();
  await fetchVoice();
};

// Importing this file (the smoke test does) runs nothing: only `node examples/explainer/fetch-assets.ts`
// performs the setup.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
