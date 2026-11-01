import { z } from 'zod';

import { type FrameRate } from '../core/timeline/time.ts';
import { inspectedElementSchema } from '../lib/preview-protocol.ts';
import { timecode } from './schedule.ts';

const frameSchema = z.int().nonnegative();

/** When a review comment is about: one frame, or every frame from `start` through `end`. */
export const commentTimeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frame'), frame: frameSchema }),
  z.object({ kind: z.literal('range'), start: frameSchema, end: frameSchema }),
]);
export type CommentTime = z.infer<typeof commentTimeSchema>;

/** Where on the stage a review comment is about, in design pixels; `frame` is the whole frame. */
export const commentPlaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frame') }),
  z.object({ kind: z.literal('point'), x: z.number(), y: z.number() }),
  z.object({
    kind: z.literal('element'),
    x: z.number(),
    y: z.number(),
    element: inspectedElementSchema,
  }),
]);
export type CommentPlace = z.infer<typeof commentPlaceSchema>;

export const reviewCommentSchema = z.object({
  id: z.int().positive(),
  compositionId: z.string(),
  /** The props the Composition was mounted with, so its command renders the frame commented on. */
  props: z.record(z.string(), z.unknown()),
  time: commentTimeSchema,
  place: commentPlaceSchema,
  /** Paths of the named Sequences showing at the first frame, outer before inner. */
  sequences: z.array(z.array(z.string())),
  body: z.string(),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type CommentDraft = Omit<ReviewComment, 'id'>;

/** The frames between two playhead positions, in either order. */
export const commentTime = (a: number, b: number): CommentTime =>
  a === b
    ? { kind: 'frame', frame: a }
    : { kind: 'range', start: Math.min(a, b), end: Math.max(a, b) };

export const firstFrame = (time: CommentTime): number =>
  time.kind === 'frame' ? time.frame : time.start;

/** What the Markdown needs besides the comments: how to render the frames they are about. */
export type ReviewContext = Readonly<{
  /** The project root the server resolved, which `--project-root` takes. */
  projectRoot: string;
  /** Its real path, the prefix of the file names in `data-source`. */
  realProjectRoot: string;
  /** The entry relative to the project root, which the CLI resolves it against. */
  entry: string;
  viteConfig?: string;
  compositionId: string;
  fps: FrameRate;
  width: number;
  height: number;
}>;

/** What the page knows of a ReviewContext before a Composition is mounted. */
export type ReviewSite = Omit<ReviewContext, 'compositionId' | 'fps' | 'width' | 'height'>;

/** A `data-source` location relative to the project root when it is under it. */
export const relativeSource = (
  source: string,
  roots: Pick<ReviewContext, 'projectRoot' | 'realProjectRoot'>,
): string => {
  for (const root of [roots.realProjectRoot, roots.projectRoot]) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (source.startsWith(prefix)) return source.slice(prefix.length);
  }
  return source;
};

/** `value` as one POSIX shell word. */
export const shellWord = (value: string): string =>
  /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

/** `value` as a Markdown code span, fenced past any backticks in it. */
const code = (value: string) => {
  const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
};

const frameRate = (fps: FrameRate) =>
  fps.denominator === 1n ? `${fps.numerator}` : `${fps.numerator}/${fps.denominator}`;

const position = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`;

const frames = (time: CommentTime) =>
  time.kind === 'frame' ? [time.frame] : [time.start, time.end];

/** A `motion-kit frame` command that renders the frames a comment is about. */
export const reproduceCommand = (context: ReviewContext, comment: ReviewComment): string => {
  const { time } = comment;
  const props = JSON.stringify(comment.props);
  return [
    'motion-kit frame',
    shellWord(context.entry),
    `--project-root ${shellWord(context.projectRoot)}`,
    ...(context.viteConfig === undefined ? [] : [`--vite-config ${shellWord(context.viteConfig)}`]),
    `--composition ${shellWord(context.compositionId)}`,
    `--frame ${frames(time).join(',')}`,
    `--out ${time.kind === 'frame' ? `review/frame-${time.frame}.png` : `review/frames-${time.start}-${time.end}`}`,
    ...(props === '{}' ? [] : [`--props ${shellWord(props)}`]),
  ].join(' ');
};

const heading = (index: number, time: CommentTime, fps: FrameRate) =>
  time.kind === 'frame'
    ? `## ${index}. ${timecode(time.frame, fps)} (frame ${time.frame})`
    : `## ${index}. ${timecode(time.start, fps)} – ${timecode(time.end, fps)} (frames ${time.start}–${time.end})`;

/** The innermost paths: those no other path continues. */
const innermost = (paths: readonly (readonly string[])[]) =>
  paths.filter(
    (path) =>
      !paths.some(
        (other) => other.length > path.length && path.every((name, i) => other[i] === name),
      ),
  );

const facts = (context: ReviewContext, comment: ReviewComment, ownProps: boolean): string[] => {
  const sequences = innermost(comment.sequences).map((path) => path.map(code).join(' › '));
  const lines = [
    ...(ownProps ? [`- Props: ${code(JSON.stringify(comment.props))}`] : []),
    ...(sequences.length === 0
      ? []
      : [`- ${sequences.length === 1 ? 'Sequence' : 'Sequences'}: ${sequences.join(', ')}`]),
  ];
  const { place } = comment;
  if (place.kind === 'point') lines.push(`- Point: ${position(place.x, place.y)}`);
  if (place.kind === 'element') {
    const { selector, text, source, box } = place.element;
    lines.push(
      [
        `- Element: ${code(selector)}`,
        text === '' ? '' : ` ${JSON.stringify(text)}`,
        source === null ? '' : ` from ${code(relativeSource(source, context))}`,
        `, box ${position(box.x, box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`,
        `, clicked at ${position(place.x, place.y)}`,
      ].join(''),
    );
  }
  return lines;
};

const quote = (body: string) =>
  (body.trim() === '' ? '(no text)' : body.trimEnd())
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');

/**
 * The comments on one Composition as Markdown for a coding agent: each with its time, the named
 * Sequences and the element it is about, and a command that renders its frames, earliest first.
 * Props shared by every comment are stated once; otherwise each comment states its own.
 */
export const reviewMarkdown = (
  context: ReviewContext,
  comments: readonly ReviewComment[],
): string => {
  const propsOf = comments.map((comment) => JSON.stringify(comment.props));
  const shared = propsOf.every((props) => props === propsOf[0]) ? propsOf[0] : undefined;
  const header = [
    `# Preview review of ${code(context.compositionId)}`,
    [
      `- Entry: ${code(context.entry)} in ${code(context.projectRoot)}`,
      ...(context.viteConfig === undefined ? [] : [`- Vite config: ${code(context.viteConfig)}`]),
      `- Composition: ${code(context.compositionId)}, ${context.width}×${context.height} at ${frameRate(context.fps)} fps. Positions are design pixels from the top-left corner.`,
      ...(shared === undefined || shared === '{}' ? [] : [`- Props: ${code(shared)}`]),
      '- Each command renders the frames a comment is about.',
    ].join('\n'),
  ];
  const sorted = comments.toSorted(
    (a, b) => firstFrame(a.time) - firstFrame(b.time) || a.id - b.id,
  );
  const sections = sorted.flatMap((comment, index) => {
    const lines = facts(context, comment, shared === undefined);
    return [
      heading(index + 1, comment.time, context.fps),
      ...(lines.length === 0 ? [] : [lines.join('\n')]),
      quote(comment.body),
      ['```sh', reproduceCommand(context, comment), '```'].join('\n'),
    ];
  });
  return `${[...header, ...(sections.length === 0 ? ['No comments yet.'] : sections)].join('\n\n')}\n`;
};
