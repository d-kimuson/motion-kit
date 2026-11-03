// Every word the promo shows, in one place. The code and the terminal output are pre-tokenised so
// the scenes colour them without a highlighter, and every claim is one the README and the guides
// make about the current release.

import type { TOKEN_COLOURS } from './look.ts';
import type { AgentBeat } from './review.ts';

import { promoFrames } from './plan.ts';

export type TokenKind = keyof typeof TOKEN_COLOURS;
export type Token = readonly [TokenKind, string];
export type CodeLine = readonly Token[];

export const productName = 'motion-kit';
export const tagline = 'Programmatic video, built for agents.';
export const installCommand = 'pnpm add @kimuson/motion-kit';
export const repositoryUrl = 'github.com/d-kimuson/motion-kit';

export const headings = {
  code: { kicker: '01 · Author', title: 'Scenes are React components.' },
  time: { kicker: '02 · Determinism', title: 'Every frame is a pure function of time.' },
  three: { kicker: '03 · 3D', title: 'Three.js runs on the same clock.' },
  pipeline: { kicker: '04 · Render', title: 'Chromium captures. FFmpeg encodes.' },
  agent: { kicker: '05 · Automate', title: 'A CLI your coding agent can read.' },
  review: { kicker: '06 · Review', title: 'Point at it. Your agent fixes it.' },
} as const;

/** The chips under the 3D scene: what draws it, and what it promises. */
export const threeCaption = ['<ThreeCanvas>', '<CameraRig>', 'no useFrame'] as const;

/** The scene the code panel types, and the preview next to it runs. */
export const sceneCode: readonly CodeLine[] = [
  [
    ['keyword', 'export const '],
    ['name', 'Hello'],
    ['punct', ' = () => {'],
  ],
  [
    ['keyword', '  const '],
    ['name', 't'],
    ['punct', ' = '],
    ['call', 'useTime'],
    ['punct', '();'],
  ],
  [
    ['keyword', '  const '],
    ['name', 'x'],
    ['punct', ' = '],
    ['call', 'interpolate'],
    ['punct', '(t, ['],
    ['number', '0'],
    ['punct', ', '],
    ['number', '1'],
    ['punct', '], ['],
    ['number', '0'],
    ['punct', ', '],
    ['number', '560'],
    ['punct', '], {'],
  ],
  [
    ['key', '    easing'],
    ['punct', ': easing.'],
    ['call', 'easeOutBack'],
    ['punct', ','],
  ],
  [['punct', '  });']],
  [
    ['keyword', '  return '],
    ['tag', '<Ball'],
    ['key', ' x'],
    ['punct', '={x.ok ? x.value : '],
    ['number', '0'],
    ['punct', '} '],
    ['tag', '/>'],
    ['punct', ';'],
  ],
  [['punct', '};']],
];

export const timeFormula = 'frame(t) → pixels';
export const timeClaim = 'Seek anywhere. Capture in any order. Same frame.';

/** The eight traversal modes the determinism suite compares exact PNG bytes across. */
export const determinismModes = [
  'sequential',
  'random',
  'reverse',
  'repeated',
  'fresh realm',
  'held session',
  'fresh renderer',
  'concurrent',
] as const;

export const pipelineStages = [
  { title: 'React / TSX', detail: 'your scenes' },
  { title: 'Chromium', detail: 'Playwright capture' },
  { title: 'FFmpeg', detail: 'H.264 encode' },
  { title: 'promo.mp4', detail: '1920×1080 · 30 fps' },
] as const;

export const pipelineSteps = 'seek → readiness barrier → capture → encode';

export const renderCommand =
  'npx @kimuson/motion-kit render examples/promo/entry.tsx --composition promo --out promo.mp4 --json';

/** The envelope `render --json` prints for this very video. */
export const renderEnvelope: readonly CodeLine[] = [
  [['punct', '{']],
  [
    ['key', '  "schemaVersion"'],
    ['punct', ': '],
    ['number', '1'],
    ['punct', ','],
  ],
  [
    ['key', '  "command"'],
    ['punct', ': '],
    ['string', '"render"'],
    ['punct', ','],
  ],
  [
    ['key', '  "ok"'],
    ['punct', ': '],
    ['keyword', 'true'],
    ['punct', ','],
  ],
  [
    ['key', '  "data"'],
    ['punct', ': { '],
    ['key', '"format"'],
    ['punct', ': '],
    ['string', '"mp4"'],
    ['punct', ', '],
    ['key', '"frameCount"'],
    ['punct', ': '],
    ['number', String(promoFrames)],
    ['punct', ', … },'],
  ],
  [
    ['key', '  "diagnostics"'],
    ['punct', ': []'],
  ],
  [['punct', '}']],
];

export const agentFacts = [
  { title: 'One JSON envelope', detail: 'schemaVersion 1 on stdout' },
  { title: 'Stable diagnostic codes', detail: 'composition.props-invalid, …' },
  { title: 'Exit codes 0 · 1 · 2 · 3', detail: 'success, domain, invocation, internal' },
] as const;

/** The review scene: the command that opens the preview, the Composition it reviews, the comment a
 * reviewer leaves on its title, and what the coding agent does with the copied review Markdown. */
export const launchCommand = 'npx @kimuson/motion-kit preview src/entry.tsx --composition hello';
/** What `preview` prints once it serves the page. */
export const previewServing =
  'serving http://127.0.0.1:4173/__motion-kit/preview/?composition=hello (Ctrl-C to stop); ready';
export const previewHost = '127.0.0.1:4173';
export const helloTitle = 'Hello, motion';
export const helloSource = 'src/Hello.tsx:12:7';
/** The preview's hint over the stage while comment mode picks an element. */
export const pickingHint =
  'Click an element to comment on it · Scroll for the one beneath · Esc to stop';
export const reviewComment = 'Make the title bigger and warmer.';

export type TranscriptLine = {
  readonly beat: AgentBeat;
  readonly kind: 'prompt' | 'quote' | 'tool' | 'detail' | 'removed' | 'added' | 'result' | 'reply';
  readonly text: string;
};

/** The agent's session, from the pasted review (an excerpt of what Copy Markdown writes) to the
 * re-rendered frame. */
export const reviewTranscript: readonly TranscriptLine[] = [
  { beat: 'paste', kind: 'prompt', text: 'Fix what this review asks for.' },
  { beat: 'paste', kind: 'quote', text: '# Preview review of `hello`' },
  { beat: 'paste', kind: 'quote', text: '## 1. 00:01.20 (frame 36)' },
  { beat: 'paste', kind: 'quote', text: `- Element: \`h1\` from \`${helloSource}\`` },
  { beat: 'paste', kind: 'quote', text: `> ${reviewComment}` },
  { beat: 'read', kind: 'tool', text: 'Read src/Hello.tsx' },
  { beat: 'edit', kind: 'tool', text: 'Edit src/Hello.tsx' },
  { beat: 'edit', kind: 'removed', text: "fontSize: 120, color: '#eef1fa'," },
  { beat: 'edit', kind: 'added', text: "fontSize: 180, color: '#ffc861'," },
  { beat: 'run', kind: 'tool', text: 'Run npx @kimuson/motion-kit frame src/entry.tsx' },
  { beat: 'run', kind: 'detail', text: '--composition hello --frame 36' },
  { beat: 'run', kind: 'detail', text: '--out review/frame-36.png' },
  { beat: 'rendered', kind: 'result', text: '✓ review/frame-36.png · 1920×1080' },
  { beat: 'reply', kind: 'reply', text: 'The title is 180 px and amber now.' },
];
