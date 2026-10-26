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

// The slideshow's placeholder step: eight FFmpeg `gradients`/`noise` stills and a `sine`/`anoisesrc`
// tone bed into the gitignored `assets.local/`. No network, no engine, no committed bytes — the whole
// example renders from these files, and CI runs this same function as the smoke test's own setup
// (docs/design-doc/20261025-reference-examples.md, "Assets and provenance").
//
// This is a Node.js process but still an example: it uses Node.js and its own modules only, never a
// relative path into `src/`, and never Python.

const execFileAsync = promisify(execFile);

/** The repository root: every path below is relative to it, and the CLI's projectRoot is the same. */
export const repositoryRoot = new URL('../../', import.meta.url).pathname;

const PHOTO_SIZE = 1440;

/** One placeholder's palette and light, so the eight slides read as eight photographs rather than as a
 *  hue ramp or a test pattern. Colours are CSS hex here and converted by `hexColour` on the way out. */
type PhotoLook = Readonly<{
  /** Two colours down the top of the frame: the sky, light at the top edge to deeper at the middle. */
  readonly sky: readonly [string, string];
  /** Two colours for the bottom: the ground at the horizon to the darkest corner. */
  readonly ground: readonly [string, string];
  /** The light source's colour, and where it sits as a fraction of the frame. */
  readonly light: string;
  readonly lightX: number;
  readonly lightY: number;
}>;

/** A scene per slide, keyed by the slide's stable id, so the file name and the picture agree. */
const PHOTO_LOOKS: Readonly<Record<string, PhotoLook>> = {
  'dune-light': {
    sky: ['#f8e4c2', '#eec394'],
    ground: ['#a86f42', '#4a2c1c'],
    light: '#fff6e2',
    lightX: 0.76,
    lightY: 0.12,
  },
  'cold-water': {
    sky: ['#a9cfd2', '#4f8791'],
    ground: ['#143842', '#040c11'],
    light: '#dff4f4',
    lightX: 0.24,
    lightY: 0.1,
  },
  'stone-stair': {
    sky: ['#f2e4d2', '#dcc6ab'],
    ground: ['#7a6554', '#241d19'],
    light: '#fff4e4',
    lightX: 0.6,
    lightY: 0.2,
  },
  'pine-ridge': {
    sky: ['#e4ecd8', '#b3c8a4'],
    ground: ['#22392c', '#080f0c'],
    light: '#f4fbe6',
    lightX: 0.38,
    lightY: 0.08,
  },
  harbour: {
    sky: ['#e9f0f6', '#bccdd9'],
    ground: ['#3d576b', '#101a23'],
    light: '#fbfdff',
    lightX: 0.62,
    lightY: 0.14,
  },
  'long-field': {
    sky: ['#f6e9c4', '#dcd39a'],
    ground: ['#6c7a3c', '#181e11'],
    light: '#fff8dc',
    lightX: 0.42,
    lightY: 0.1,
  },
  'night-road': {
    sky: ['#3f5273', '#27324a'],
    ground: ['#141c2a', '#05070d'],
    light: '#f6bd76',
    lightX: 0.54,
    lightY: 0.56,
  },
  'morning-window': {
    sky: ['#fdf5ea', '#f6e0cc'],
    ground: ['#9c7168', '#33241f'],
    light: '#fffdf8',
    lightX: 0.28,
    lightY: 0.08,
  },
};

/** A neutral look for a slide this table has not learned yet, so a new slide still renders a picture. */
const DEFAULT_LOOK: PhotoLook = {
  sky: ['#d9dde2', '#aab0b8'],
  ground: ['#5b6068', '#1c1f24'],
  light: '#f5f7fa',
  lightX: 0.5,
  lightY: 0.2,
};

const hexColour = (colour: string): string => `0x${colour.replace('#', '')}`;

/**
 * One FFmpeg `gradients` source: a linear ramp down the frame for the backdrop, a radial one for the
 * light, a radial white-to-grey one for the vignette. Every source is a still (`rate=1`, `duration=1`,
 * `speed=0`), so the frame that lands on disk is a pure function of the colours and the geometry.
 */
const gradientSource = (
  options: Readonly<{
    readonly colours: readonly string[];
    readonly type: 'linear' | 'radial';
    readonly from: readonly [number, number];
    readonly to: readonly [number, number];
  }>,
): string =>
  [
    `gradients=size=${String(PHOTO_SIZE)}x${String(PHOTO_SIZE)}`,
    'rate=1',
    'duration=1',
    'speed=0',
    `type=${options.type}`,
    `nb_colors=${String(options.colours.length)}`,
    ...options.colours.map((colour, index) => `c${String(index)}=${hexColour(colour)}`),
    `x0=${String(Math.round(PHOTO_SIZE * options.from[0]))}`,
    `y0=${String(Math.round(PHOTO_SIZE * options.from[1]))}`,
    `x1=${String(Math.round(PHOTO_SIZE * options.to[0]))}`,
    `y1=${String(Math.round(PHOTO_SIZE * options.to[1]))}`,
  ].join(':');

/**
 * The picture, built from three soft fields rather than a pattern: a four-stop linear ramp from the
 * sky to the ground (the horizon is where the ramp changes direction), a radial light source blended
 * in with `softlight`, a radial white-to-grey field multiplied over the frame as a vignette, and film
 * grain on top. The result is a full-bleed abstract photograph, which is what makes the Ken Burns
 * read as a camera move over a picture instead of a pan across a test pattern.
 *
 * The two blends and the grain run in RGB (`format=rgb24` between the layers): `blend` and `vignette`
 * in the default YUV leave chroma behind in the shadows, and a warm ramp comes out magenta.
 */
const PHOTO_GRAPH = [
  '[0:v]format=rgb24[sky]',
  '[1:v]format=rgb24[light]',
  '[2:v]format=rgb24[vignette]',
  '[sky][light]blend=all_mode=softlight:all_opacity=0.5[lit]',
  '[lit][vignette]blend=all_mode=multiply:all_opacity=0.55,noise=alls=8:allf=t+u,gblur=sigma=1.6,format=rgb24[photo]',
].join(';');

const photoArgs = (slide: Slide, out: string): string[] => {
  const look = PHOTO_LOOKS[slide.id] ?? DEFAULT_LOOK;
  const backdrop = gradientSource({
    colours: [look.sky[0], look.sky[1], look.ground[0], look.ground[1]],
    type: 'linear',
    from: [0.12, 0],
    to: [0.88, 1],
  });
  const light = gradientSource({
    colours: [look.light, '#000000'],
    type: 'radial',
    from: [look.lightX, look.lightY],
    to: [look.lightX + 0.62, look.lightY + 0.62],
  });
  const vignette = gradientSource({
    colours: ['#ffffff', '#a8a8a8'],
    type: 'radial',
    from: [0.5, 0.5],
    to: [1.3, 1.3],
  });
  return [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    backdrop,
    '-f',
    'lavfi',
    '-i',
    light,
    '-f',
    'lavfi',
    '-i',
    vignette,
    '-filter_complex',
    PHOTO_GRAPH,
    '-map',
    '[photo]',
    '-frames:v',
    '1',
    '-update',
    '1',
    out,
  ];
};

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
  for (const slide of slides) {
    const out = join(photosDirectory, slide.file);
    if (!force && (await exists(out))) {
      skipped.push(out);
      report(`kept    ${slide.file}`);
      continue;
    }
    await run(ffmpeg, photoArgs(slide, out));
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
