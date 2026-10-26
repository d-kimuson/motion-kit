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
//           leaves a renderable tree.
//
//   node examples/explainer/fetch-assets.ts                # both steps
//   node examples/explainer/fetch-assets.ts --placeholders # step 1 only (what CI runs)
//
// Run it from the repository root: the paths below are relative to it.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

const log = (message: string) => console.log(`fetch-assets: ${message}`);

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

const placeholderSprites = (): void => {
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
  log(`step 1: ${String(written)} placeholder sprites in ${dir}`);
};

/**
 * The tone bed. It is generated so a reader can hear the pipeline, but the explainer declares no
 * music track: the placeholder render stays silent and the narrated one is voice only.
 */
const generateToneBed = (): void => {
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
  log(`step 1: tone bed ${toneBed}`);
};

/**
 * Silent placeholders at the paths the Composition's audio tracks name. The tracks are descriptor
 * data, so they cannot switch on `--props`: a placeholder render without these files would fail at
 * `asset.load-failed`, and with them it is silent digital silence.
 */
const placeholderVoice = (): void => {
  mkdirSync(voiceDir, { recursive: true });
  for (const line of script.lines) {
    const target = join(voiceDir, `${line.id}.wav`);
    if (existsSync(target) && !isSilentPlaceholder(target)) continue; // step 2's clip: keep it
    ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.4', target]);
  }
  log(`step 1: ${String(script.lines.length)} silent voice placeholders in ${voiceDir}`);
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

const sayClip = (text: string, target: string): void => {
  const aiff = join(root, 'tmp', 'line.aiff');
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const spoken = spawnSync('say', ['-v', 'Kyoko', '-o', aiff, text], { stdio: 'inherit' });
  if (spoken.status !== 0) throw new Error(`say exited ${String(spoken.status)}`);
  ffmpeg(['-i', aiff, '-ar', '48000', '-ac', '1', target]);
  rmSync(aiff, { force: true });
};

/** Step 2's voice: VOICEVOX where an engine answers, `say` where it does not, nothing otherwise. */
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
  for (const line of script.lines) {
    const target = join(voiceDir, `${line.id}.wav`);
    if (useVoicevox) {
      const wav = await voicevoxClip(engineUrl, voicevoxSpeaker[line.speaker], line.text);
      writeFileSync(target, wav);
    } else {
      sayClip(line.text, target);
    }
    durations[line.id] = Math.round(ffprobeSeconds(target) * 1000) / 1000;
  }
  writeFileSync(join(voiceDir, 'durations.json'), `${JSON.stringify(durations, null, 2)}\n`);
  log(
    `step 2: ${String(script.lines.length)} voice clips via ${useVoicevox ? 'VOICEVOX' : 'say -v Kyoko'} into ${voiceDir} (durations.json is local-only)`,
  );
};

const main = async (): Promise<void> => {
  const placeholdersOnly = process.argv.includes('--placeholders');
  mkdirSync(root, { recursive: true });
  placeholderSprites();
  generateToneBed();
  placeholderVoice();
  log('step 1 done');
  if (placeholdersOnly) return;
  fetchSprites();
  await fetchVoice();
};

await main();
