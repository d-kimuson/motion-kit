import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compositions as explainerCompositions, storyboard } from './entry.tsx';
import { fitClip, fitTempo, generatePlaceholders } from './fetch-assets.ts';
import { mouthAt } from './look.ts';
import { ciStoryboard, crossFadeTime } from './plan.ts';
import { compositions as probeCompositions } from './probe.tsx';
import { lineStartTimes, slidePlan } from './script.schema.ts';
import { script, totalSeconds } from './script.ts';

const execFileAsync = promisify(execFile);

// Every command runs from the repository root: the CLI's projectRoot is process.cwd(), and React,
// ReactDOM and Zod resolve against it (docs/design-doc/20261025-reference-examples.md, "Running an
// example"). `pnpm test` builds dist/ first, so the shipped CLI is the thing under test.
const repositoryRoot = new URL('../../', import.meta.url).pathname;
const cli = join(repositoryRoot, 'dist', 'cli.js');
const outDirectory = join(repositoryRoot, 'out', 'examples');

// The CLI's own envelope contract, re-stated here so the assertion is checked rather than cast.
const renderEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('render'),
  ok: z.boolean(),
  diagnostics: z.array(z.unknown()),
  data: z
    .object({
      output: z.string(),
      format: z.string(),
      width: z.number(),
      height: z.number(),
      frameCount: z.number(),
      fps: z.object({ numerator: z.number(), denominator: z.number() }),
      durationSeconds: z.number(),
    })
    .nullable(),
});

const ffprobe = (file: string): string =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,nb_frames,r_frame_rate,avg_frame_rate,duration,width,height',
    '-of',
    'default=noprint_wrappers=1',
    file,
  ]).toString();

/** A clip's whole length in seconds, which for a fitted voice clip is its line's slot exactly. */
const clipSeconds = (file: string): number =>
  Number.parseFloat(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { encoding: 'utf8' },
    ).trim(),
  );

/** RMS of little-endian float32 PCM: how a fitted clip's speech and its pauses are told apart. */
const rmsOf = (pcm: Buffer): number => {
  const samples = Math.floor(pcm.length / 4);
  let energy = 0;
  for (let index = 0; index < samples; index += 1) energy += pcm.readFloatLE(index * 4) ** 2;
  return Math.sqrt(energy / samples);
};

/** A window of a clip as float32 PCM at 48 kHz: `seek` is an input option, so `-t`/`-sseof` go first. */
const pcmWindow = (file: string, seek: readonly string[]): Buffer =>
  execFileSync(
    'ffmpeg',
    ['-v', 'error', ...seek, '-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );

/** The clip's first `seconds`, and its last `seconds`. */
const pcmHead = (file: string, seconds: number): Buffer => pcmWindow(file, ['-t', String(seconds)]);

const pcmTail = (file: string, seconds: number): Buffer =>
  pcmWindow(file, ['-sseof', `-${String(seconds)}`]);

describe('explainer example', () => {
  // The smoke test is its own setup: CI has no committed media and no network, so the FFmpeg
  // placeholders and the silent voice clips are generated here, before the render that needs them
  // (docs/design-doc/20261025-reference-examples.md, "Assets and provenance"). Without them the
  // render fails at `asset.load-failed` rather than drawing a blank frame.
  beforeAll(() => {
    mkdirSync(outDirectory, { recursive: true });
    generatePlaceholders((message) => console.info(message));
  }, 180_000);

  it('declares the full explainer, its CI twin and its probe at the documented sizes', () => {
    expect(explainerCompositions.ok).toBe(true);
    expect(probeCompositions.ok).toBe(true);
    if (!explainerCompositions.ok || !probeCompositions.ok) return;
    const descriptors = explainerCompositions.value.listCompositions();
    expect(descriptors.map((item) => item.id)).toEqual(['explainer', 'explainer-ci']);
    const [full, ci] = descriptors;
    // 1920x1080 at 30 fps, 222 s of script as 6660 frames: a local QA Check, never rendered in CI.
    expect(full).toMatchObject({ width: 1920, height: 1080, durationInFrames: 6660 });
    expect(full?.fps).toEqual({ numerator: 30, denominator: 1 });
    expect(full?.durationInFrames).toBe(totalSeconds * 30);
    // The CI twin is half linear resolution and exactly 60 frames, per the CI policy.
    expect(ci).toMatchObject({ width: 960, height: 540, durationInFrames: 60 });
    expect(probeCompositions.value.listCompositions()).toMatchObject([
      { id: 'explainer-probe', width: 480, height: 270, durationInFrames: 30 },
    ]);
  });

  it('places the slides, the subtitles and the sprites on the script’s own frames', () => {
    // Every layer reads one `Storyboard`, so this is the assertion that the three cannot disagree:
    // each slide starts on its first line, each line starts on the sum of the lines before it, and
    // a slide's `TransitionScene` declares its dialogue plus the 0.4 s outgoing crossfade — which
    // is why the series telescopes back to the dialogue total.
    const starts = lineStartTimes(script.lines);
    storyboard.lines.forEach((line, index) => {
      expect(line.startFrame).toBe(Math.round((starts[index] ?? 0) * 30));
      expect(line.frames).toBe((script.lines[index]?.seconds ?? 0) * 30);
    });
    expect(storyboard.overlapFrames).toBe(12);
    const spans = slidePlan(script.lines);
    expect(storyboard.slides).toHaveLength(spans.length);
    storyboard.slides.forEach((slide, index) => {
      const span = spans[index];
      expect(span).toBeDefined();
      if (span === undefined) return;
      expect(slide.startFrame).toBe(Math.round(span.startSeconds * 30));
      expect(slide.contentFrames).toBe(Math.round(span.onScreenSeconds * 30));
    });
    // The last scene carries the held disclaimer tail, so the series ends exactly at 6660.
    const lastSlide = storyboard.slides.at(-1);
    expect((lastSlide?.startFrame ?? 0) + (lastSlide?.frames ?? 0)).toBe(
      storyboard.durationInFrames,
    );
    expect(storyboard.durationInFrames).toBe(totalSeconds * 30);
  });

  it('lays out the 60-frame CI storyboard as one line, a 0.4 s crossfade and the tail', () => {
    // `explainer-ci` is the same components over a short storyboard: 36 frames of the summary slide
    // (24 of them spoken), a 12-frame crossfade, then the disclaimer slide for its remaining 36.
    const ci = ciStoryboard();
    expect(ci.fps).toBe(30);
    expect(ci.overlapFrames).toBe(12);
    expect(ci.slides.map((slide) => slide.startFrame)).toEqual([0, 24]);
    expect(ci.slides.map((slide) => slide.frames)).toEqual([36, 36]);
    expect(ci.lines.map((line) => [line.id, line.startFrame, line.frames])).toEqual([
      ['summary-2', 0, 24],
      ['disclaimer-1', 24, 36],
    ]);
    expect(ci.durationInFrames).toBe(60);
    // The speaker alternates rest/open every 0.15 s (4.5 frames at 30 fps), counted from its own
    // line's start — the sprite layer's only per-frame change with no lip-sync asset contract.
    expect([0, 4, 5, 8, 9, 13].map((frame) => mouthAt(frame / 30))).toEqual([
      'rest',
      'rest',
      'open',
      'open',
      'rest',
      'rest',
    ]);
  });

  it('hands the CI crossfade a slide that keeps its own clock, instead of jumping 13 frames', () => {
    // `contentFrames` is where the outgoing scene stops drawing, and the overlay hands the slide
    // `contentFrames + elapsed` from then on. The `まとめ` slide is drawn by its own scene for frames
    // 0–23, so the handoff at frame 24 must be one frame on (0.800 s, not 1.200 s): a jump there
    // advances the bullets slide's local time by 0.43 s in a single frame and item 2's `reveal(0.87)`
    // snaps from 0 to 1 instead of ramping, which `slides/shared.ts` rules out.
    const ci = ciStoryboard();
    const outgoing = ci.slides[0];
    expect(outgoing).toBeDefined();
    if (outgoing === undefined) return;
    const lastDrawnFrame = outgoing.frames - ci.overlapFrames - 1;
    expect(outgoing.contentFrames).toBe(outgoing.frames - ci.overlapFrames);
    // The overlay's first frame (nothing elapsed yet) continues one frame past that frame.
    expect(crossFadeTime(outgoing, ci.fps, 0) * ci.fps).toBeCloseTo(lastDrawnFrame + 1, 6);
    // And the clock runs at 1x through the overlap, ending one frame inside the scene's own span.
    const lastOverlapFrame = (ci.overlapFrames - 1) / ci.fps;
    expect(crossFadeTime(outgoing, ci.fps, lastOverlapFrame) * ci.fps).toBeCloseTo(
      outgoing.frames - 1,
      6,
    );
    // The full storyboard obeys the same rule, so the two storyboards cannot drift apart: every slide
    // that hands over stops drawing one overlap short, and only the last draws its held tail through.
    for (const board of [storyboard, ci]) {
      board.slides.forEach((slide, index) => {
        const last = index === board.slides.length - 1;
        expect(slide.contentFrames).toBe(last ? slide.frames : slide.frames - board.overlapFrames);
      });
    }
  });

  it('renders explainer-ci through the CLI as a 60-frame 960x540 MP4 that decodes clean', async () => {
    const output = join(outDirectory, 'explainer-ci.mp4');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'render',
        'examples/explainer/entry.tsx',
        '--composition',
        'explainer-ci',
        '--out',
        output,
        '--json',
      ],
      { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    const envelope = renderEnvelopeSchema.parse(parsed);
    // A missing sprite or font fails the render with `asset.load-failed` rather than encoding a
    // blank frame, so `ok` here is also the assertion that the generated placeholders loaded.
    expect(envelope).toMatchObject({ schemaVersion: 1, command: 'render', ok: true });
    expect(envelope.diagnostics).toEqual([]);
    expect(envelope.data).toMatchObject({
      output,
      format: 'mp4',
      width: 960,
      height: 540,
      frameCount: 60,
      fps: { numerator: 30, denominator: 1 },
    });
    expect(envelope.data?.durationSeconds).toBeCloseTo(2, 5);
    expect(statSync(output).size).toBeGreaterThan(0);

    const probed = ffprobe(output);
    expect(probed).toContain('codec_name=h264');
    expect(probed).toContain('width=960');
    expect(probed).toContain('height=540');
    expect(probed).toContain('nb_frames=60');
    expect(probed).toContain('r_frame_rate=30/1');
    expect(probed).toContain('avg_frame_rate=30/1');
    expect(probed).toContain('duration=2.000000');

    // A clean decode: FFmpeg reports nothing at `error` level for the whole stream.
    const decoded = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(decoded).toBe('');
  }, 180_000);
});

describe('explainer narration fit', () => {
  it('moves a clip toward its slot, but never past the ±25 % band', () => {
    // A clip already on its slot is left alone; one inside the band moves by exactly its own ratio,
    // which is what makes the speech in the file the pace the script's 5 characters a second means.
    expect(fitTempo(13, 13)).toBe(1);
    expect(fitTempo(10.5, 12)).toBe(0.875);
    // Outside the band the clip keeps its own pace and the slot is padded instead, so a slow engine
    // is not made to chatter and a fast one is not made to drawl.
    expect(fitTempo(15, 12)).toBe(1.25);
    expect(fitTempo(6, 12)).toBe(0.8);
  });

  it('lands every clip exactly on its line’s seconds', () => {
    // The voice track's `endInFrames` cuts at the line's end, so a clip that is not exactly the slot
    // long either loses its last word or leaves silence before the next line. An FFmpeg sine stands
    // in for the engine here: the point is the `atempo`/`apad`/`-t` graph, which CI can run without
    // `say` or VOICEVOX.
    const dir = join(outDirectory, 'fit');
    mkdirSync(dir, { recursive: true });
    const source = join(dir, 'source.wav');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=5',
      '-ac',
      '1',
      source,
    ]);
    // 5 s of speech into a 12 s line: the tempo clamps at 0.8 and `apad` fills the remaining 5.75 s.
    const padded = join(dir, 'padded.wav');
    expect(fitClip(source, padded, 12)).toBe(0.8);
    expect(clipSeconds(padded)).toBe(12);
    // 5 s into a 4 s line: the clamp is 1.25, so `-t` is what lands the file on the slot.
    const cut = join(dir, 'cut.wav');
    expect(fitClip(source, cut, 4)).toBe(1.25);
    expect(clipSeconds(cut)).toBe(4);
  }, 60_000);

  it('starts the speech on the clip’s first sample, so nobody speaks a frame late', () => {
    // `say` writes ~0.1 s of digital silence before the first phoneme; left in, the voice would start
    // three frames after its subtitle and its sprite. A delayed sine stands in for that lead-in.
    const dir = join(outDirectory, 'fit');
    mkdirSync(dir, { recursive: true });
    const source = join(dir, 'lead-in.wav');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=3',
      '-af',
      'adelay=400:all=1',
      '-ac',
      '1',
      source,
    ]);
    const target = join(dir, 'lead-in-fitted.wav');
    // 3 s of tone behind 0.4 s of silence into a 4 s slot: the silence is gone from the measurement,
    // so the tempo is 3 s of speech over the 3.6 s the slot allows it, and not 3.4 over 3.6.
    expect(fitClip(source, target, 4)).toBeCloseTo(3 / 3.6, 4);
    expect(clipSeconds(target)).toBe(4);
    // The first millisecond of the fitted clip carries the tone, not the silence it had in front of it.
    expect(pcmHead(target, 0.001).length).toBeGreaterThan(0);
    expect(rmsOf(pcmHead(target, 0.001))).toBeGreaterThan(0.01);
    // And the last 0.3 s of the slot is the pause: 3.6 s of speech, then silence to the 4 s mark.
    expect(rmsOf(pcmTail(target, 0.3))).toBeLessThan(0.001);
  }, 60_000);
});
