import { describe, expect, it } from 'vitest';

import { createFrameRate, type FrameRate } from '../core/timeline/time.ts';
import {
  commentTime,
  relativeSource,
  reviewMarkdown,
  shellWord,
  type ReviewComment,
  type ReviewContext,
} from './comments.ts';

const rate = (numerator: number, denominator = 1): FrameRate => {
  const result = createFrameRate({ numerator, denominator });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const context: ReviewContext = {
  projectRoot: '/work/app',
  realProjectRoot: '/private/work/app',
  entry: 'src/entry.tsx',
  compositionId: 'intro',
  props: {},
  fps: rate(30),
  width: 1920,
  height: 1080,
};

const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 1,
  compositionId: 'intro',
  time: { kind: 'frame', frame: 45 },
  place: { kind: 'frame' },
  sequences: [],
  body: 'Too fast.',
  ...overrides,
});

describe('commentTime', () => {
  it('is one frame when both ends are the same frame', () => {
    expect(commentTime(12, 12)).toEqual({ kind: 'frame', frame: 12 });
  });

  it('orders the ends of a range', () => {
    expect(commentTime(40, 12)).toEqual({ kind: 'range', start: 12, end: 40 });
  });
});

describe('relativeSource', () => {
  it('names a JSX location under either spelling of the project root relative to it', () => {
    expect(relativeSource('/private/work/app/src/title.tsx:4:21', context)).toBe(
      'src/title.tsx:4:21',
    );
    expect(relativeSource('/work/app/src/title.tsx:4:21', context)).toBe('src/title.tsx:4:21');
  });

  it('keeps a location outside the project, and an author-set value, as it is', () => {
    expect(relativeSource('/work/application/x.tsx:1:1', context)).toBe(
      '/work/application/x.tsx:1:1',
    );
    expect(relativeSource('title', context)).toBe('title');
  });
});

describe('shellWord', () => {
  it('leaves plain words bare and single-quotes the rest', () => {
    expect(shellWord('src/entry.tsx')).toBe('src/entry.tsx');
    expect(shellWord('{"title":"it\'s"}')).toBe(`'{"title":"it'\\''s"}'`);
    expect(shellWord('/My Projects/app')).toBe("'/My Projects/app'");
  });
});

describe('reviewMarkdown', () => {
  it('writes each comment with its time, place and a command that renders its frame', () => {
    const markdown = reviewMarkdown(context, [
      comment({
        id: 2,
        time: { kind: 'frame', frame: 75 },
        place: {
          kind: 'element',
          x: 410.6,
          y: 130.2,
          element: {
            selector: 'h1#title.lead',
            text: 'Hello',
            source: '/private/work/app/src/title.tsx:4:21',
            box: { x: 120, y: 80, width: 640, height: 96 },
          },
        },
        sequences: [['intro'], ['intro', 'title']],
        body: 'Make it bigger.\nAnd bolder.',
      }),
      comment({ id: 1, place: { kind: 'point', x: 10, y: 20 } }),
    ]);
    expect(markdown).toBe(
      [
        '# Preview review of `intro`',
        '',
        '- Entry: `src/entry.tsx` in `/work/app`',
        '- Composition: `intro`, 1920×1080 at 30 fps. Positions are design pixels from the top-left corner.',
        '- Each command renders the frames a comment is about.',
        '',
        '## 1. 00:01.50 (frame 45)',
        '',
        '- Point: (10, 20)',
        '',
        '> Too fast.',
        '',
        '```sh',
        'motion-kit frame src/entry.tsx --project-root /work/app --composition intro --frame 45 --out review/frame-45.png',
        '```',
        '',
        '## 2. 00:02.50 (frame 75)',
        '',
        '- Sequence: `intro` › `title`',
        '- Element: `h1#title.lead` "Hello" from `src/title.tsx:4:21`, box (120, 80) 640×96, clicked at (411, 130)',
        '',
        '> Make it bigger.',
        '> And bolder.',
        '',
        '```sh',
        'motion-kit frame src/entry.tsx --project-root /work/app --composition intro --frame 75 --out review/frame-75.png',
        '```',
        '',
      ].join('\n'),
    );
  });

  it('renders both ends of a range, and passes props and the Vite config to the command', () => {
    const markdown = reviewMarkdown(
      {
        ...context,
        fps: rate(30000, 1001),
        props: { title: "it's" },
        viteConfig: 'vite.preview.ts',
      },
      [
        comment({
          time: { kind: 'range', start: 30, end: 90 },
          place: {
            kind: 'element',
            x: 5,
            y: 5,
            element: {
              selector: 'p',
              text: '',
              source: null,
              box: { x: 0, y: 0, width: 10, height: 10 },
            },
          },
          body: '',
        }),
      ],
    );
    expect(markdown).toContain('- Composition: `intro`, 1920×1080 at 30000/1001 fps.');
    expect(markdown).toContain('- Props: `{"title":"it\'s"}`');
    expect(markdown).toContain('## 1. 00:01.00 – 00:03.00 (frames 30–90)');
    expect(markdown).toContain('- Element: `p`, box (0, 0) 10×10, clicked at (5, 5)');
    expect(markdown).toContain('> (no text)');
    expect(markdown).toContain(
      `motion-kit frame src/entry.tsx --project-root /work/app --vite-config vite.preview.ts --composition intro --frame 30,90 --out review/frames-30-90 --props '{"title":"it'\\''s"}'`,
    );
  });

  it('says so when there is nothing to review', () => {
    expect(reviewMarkdown(context, [])).toContain('No comments yet.');
  });
});
