import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  MUSIC_SECONDS,
  PLACEHOLDER_MUSIC,
  PLACEHOLDER_PHOTOS,
  type Slide,
  slides,
} from './slides/plan.ts';

// The slideshow's placeholder step: FFmpeg `color`/`testsrc2` stills and a `sine`/`anoisesrc` tone bed
// into the gitignored `assets.local/`. No network, no engine, no committed bytes — the whole example
// renders from these files, and CI runs this same function as the smoke test's own setup
// (docs/design-doc/20261025-reference-examples.md, "Assets and provenance").
//
// This is a Node.js process but still an example: it uses Node.js and its own modules only, never a
// relative path into `src/`, and never Python.

const execFileAsync = promisify(execFile);

/** The repository root: every path below is relative to it, and the CLI's projectRoot is the same. */
export const repositoryRoot = new URL('../../', import.meta.url).pathname;

const PHOTO_SIZE = 1440;

/** One FFmpeg `-vf` chain per slide: stills built from `testsrc2` and `color`, all 1440x1440 so a
 *  9:16 frame and a 16:9 frame both crop it without upscaling. */
const photoFilters = (slide: Slide, index: number): string => {
  const hue = index * 43;
  // Alternating sources, so the eight slides read as eight different pictures rather than a hue ramp.
  if (index % 2 === 0) return `hue=h=${String(hue)}:s=0.85,vignette=angle=PI/5,format=rgb24`;
  const band = PHOTO_SIZE * (0.5 + 0.06 * index);
  return `drawbox=x=0:y=0:w=${String(PHOTO_SIZE)}:h=${String(PHOTO_SIZE * 0.16)}:color=0xffffff@0.14:t=fill,drawbox=x=${String(PHOTO_SIZE * 0.1)}:y=${String(Math.round(band))}:w=${String(PHOTO_SIZE * 0.8)}:h=${String(PHOTO_SIZE * 0.24)}:color=0x000000@0.32:t=fill,format=rgb24`;
};

/** Flat tint per odd-index slide, so no two placeholders are the same file. */
const FLAT_COLOURS = ['0x1b2b3a', '0x3a2b25', '0x24322b', '0x2b2f22'] as const;

const photoInput = (index: number): string =>
  index % 2 === 0
    ? `testsrc2=size=${String(PHOTO_SIZE)}x${String(PHOTO_SIZE)}:rate=1:duration=1`
    : `color=c=${FLAT_COLOURS[Math.floor(index / 2) % FLAT_COLOURS.length] ?? '0x242424'}:size=${String(PHOTO_SIZE)}x${String(PHOTO_SIZE)}:duration=1`;

const photoArgs = (slide: Slide, index: number, out: string): string[] => [
  '-y',
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  photoInput(index),
  '-vf',
  photoFilters(slide, index),
  '-frames:v',
  '1',
  '-update',
  '1',
  out,
];

/** The tone bed: a low sine under filtered pink noise, faded in and out, exactly as long as the full
 *  `slideshow` so the music ends with the last slide instead of being cut off. No Composition declares
 *  audio yet (TASK-171), so nothing muxes it; the file is what that step will read. */
const musicArgs = (out: string): string[] => {
  const seconds = String(MUSIC_SECONDS);
  const fadeOut = String(Math.max(0, MUSIC_SECONDS - 1.5));
  return [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=110:sample_rate=48000:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=colour=pink:amplitude=0.03:sample_rate=48000:duration=${seconds}`,
    '-filter_complex',
    `[0:a]volume=0.12[low];[1:a]lowpass=f=900,volume=0.5[air];[low][air]amix=inputs=2:duration=shortest,afade=t=in:st=0:d=1.5,afade=t=out:st=${fadeOut}:d=1.5[bed]`,
    '-map',
    '[bed]',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    out,
  ];
};

export type PlaceholderOptions = Readonly<{
  /** Regenerate files that already exist. Without it the script is a no-op on a warm checkout. */
  readonly force?: boolean;
  /** FFmpeg binary; defaults to `ffmpeg` on PATH, which the render path requires anyway. */
  readonly ffmpeg?: string;
  /** Progress sink, so the CLI prints and the smoke test stays quiet. */
  readonly report?: (message: string) => void;
}>;

export type PlaceholderSummary = Readonly<{
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}>;

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const run = async (ffmpeg: string, args: readonly string[]): Promise<void> => {
  try {
    await execFileAsync(ffmpeg, [...args], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr)
        : String(error);
    throw new Error(`fetch-assets: ffmpeg failed\n${stderr.trim()}`);
  }
};

/**
 * Writes the placeholder photos and the tone bed into `examples/slideshow/assets.local/`. Idempotent:
 * an existing file is left alone unless `force` is set. The smoke test calls this before its render,
 * which is how CI gets media without committing any.
 */
export const generatePlaceholders = async (
  options: PlaceholderOptions = {},
): Promise<PlaceholderSummary> => {
  const { force = false, ffmpeg = 'ffmpeg', report = () => {} } = options;
  const photosDirectory = join(repositoryRoot, PLACEHOLDER_PHOTOS);
  const musicDirectory = join(repositoryRoot, PLACEHOLDER_MUSIC);
  // Both directories are inside the gitignored `assets.local/`; nothing here writes into `assets/`.
  await mkdir(photosDirectory, { recursive: true });
  await mkdir(musicDirectory, { recursive: true });

  const written: string[] = [];
  const skipped: string[] = [];
  for (const [index, slide] of slides.entries()) {
    const out = join(photosDirectory, slide.file);
    if (!force && (await exists(out))) {
      skipped.push(out);
      report(`kept    ${slide.file}`);
      continue;
    }
    await run(ffmpeg, photoArgs(slide, index, out));
    written.push(out);
    report(`wrote   ${slide.file}`);
  }

  const music = join(musicDirectory, 'tone-bed.wav');
  if (force || !(await exists(music))) {
    await run(ffmpeg, musicArgs(music));
    written.push(music);
    report(`wrote   ${music.slice(musicDirectory.lastIndexOf('/') + 1)}`);
  } else {
    skipped.push(music);
    report('kept    tone-bed.wav');
  }

  return { written, skipped };
};

const main = async (): Promise<void> => {
  const force = process.argv.includes('--force');
  const summary = await generatePlaceholders({
    force,
    report: (message) => console.info(message),
  });
  console.info(
    `fetch-assets: ${String(summary.written.length)} written, ${String(summary.skipped.length)} kept ` +
      `in ${PLACEHOLDER_PHOTOS}/ and ${PLACEHOLDER_MUSIC}/`,
  );
  console.info('fetch-assets: no audio is declared yet, so the tone bed is not muxed (TASK-171).');
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
