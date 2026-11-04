// Builds the GitHub Pages site into _site/: the landing page in lp/, the brand assets, and every example
// under examples/ rendered to MP4 with a poster frame. Run with Node.js 24.2+ from the repository root
// after `pnpm build`, with Chromium and FFmpeg installed (examples/README.md, "Running an example"):
//
//   node scripts/build-site.ts            # every example
//   node scripts/build-site.ts teaser     # only the named examples, for a quick look at the page
//
// .github/workflows/pages.yml runs it on every push to main, so the videos are rendered by the commit
// they show and never committed.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

type Example = {
  readonly name: string;
  readonly composition: string;
  /** The frame the page shows before the video plays. */
  readonly poster: number;
  /** A JSON file whose contents are the Composition's props. */
  readonly props?: string;
  /** The command that generates the example's media first, if it has any. */
  readonly setup?: readonly string[];
};

// The order is the order on the page; the copy for each lives in lp/index.html.
const examples: readonly Example[] = [
  { name: 'promo', composition: 'promo', poster: 90 },
  { name: 'teaser', composition: 'teaser', poster: 300 },
  { name: 'chart', composition: 'chart', poster: 540, props: 'examples/chart/data/index-30y.json' },
  {
    name: 'slideshow',
    composition: 'slideshow',
    poster: 60,
    setup: ['examples/slideshow/fetch-assets.ts'],
  },
  {
    name: 'explainer',
    composition: 'explainer',
    poster: 600,
    setup: ['examples/explainer/fetch-assets.ts', '--placeholders'],
  },
];

const site = '_site';
const only = process.argv.slice(2);
const unknown = only.filter((name) => !examples.some((example) => example.name === name));
if (unknown.length > 0) {
  throw new Error(
    `unknown example ${unknown.join(', ')}; known: ${examples.map(({ name }) => name).join(', ')}`,
  );
}
const selected = only.length === 0 ? examples : examples.filter(({ name }) => only.includes(name));

const cli = (...args: readonly string[]): void => {
  execFileSync('node', ['dist/cli.js', ...args, '--quiet'], { stdio: 'inherit' });
};

rmSync(site, { recursive: true, force: true });
mkdirSync(`${site}/videos`, { recursive: true });
cpSync('lp', site, { recursive: true });
cpSync('.github/assets/mark.svg', `${site}/mark.svg`);

for (const example of selected) {
  if (example.setup !== undefined) execFileSync('node', example.setup, { stdio: 'inherit' });
  const entry = `examples/${example.name}/entry.tsx`;
  const out = `${site}/videos/${example.name}`;
  const props = example.props === undefined ? [] : ['--props', readFileSync(example.props, 'utf8')];
  cli(
    'frame',
    entry,
    '--composition',
    example.composition,
    ...props,
    '--frame',
    String(example.poster),
    '--out',
    `${out}.png`,
  );
  // A full-HD PNG is a few MB; the poster only has to hold the place until the video loads.
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    `${out}.png`,
    '-vf',
    'scale=960:-2',
    '-q:v',
    '4',
    `${out}.jpg`,
  ]);
  rmSync(`${out}.png`);
  cli('render', entry, '--composition', example.composition, ...props, '--out', `${out}.mp4`);
}
