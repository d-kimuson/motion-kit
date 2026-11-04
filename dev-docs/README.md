# Developing motion-kit

This page is for working on motion-kit itself, in a checkout of the repository. Using the package is
covered by the [README](../README.md) and the [documentation index](../docs/index.md). The directory
structure, the Feedback Loop commands, CI, guidelines and contexts are in [AGENTS.md](../AGENTS.md); this page adds only what
AGENTS.md does not say.

## Setup

```bash
nix develop                            # devShell from flake.nix: Node 26, pnpm, gitleaks, elan
pnpm install
pnpm exec playwright install chromium  # the render tests capture in Chromium
pnpm build                             # tsdown: dist/ for the published package and the CLI
```

The encoding and CLI tests also need FFmpeg and `ffprobe` on `PATH`. `lake build` takes its Lean
version from `lean-toolchain`, via elan.

## Spikes

The Phase 0 browser experiments stay separate from the framework, each with its own README and
`pnpm spike:*` script under `spikes/<name>/`.

## Landing page

`lp/index.html` is the GitHub Pages site, a static page with no build. `.github/workflows/pages.yml`
runs `node scripts/build-site.ts` on every push to `main`: it copies `lp/` into `_site/` and renders
each example into `_site/videos/` with a poster frame, so the videos always match the code and are
never committed. To look at the page locally, after `pnpm build`:

```bash
node scripts/build-site.ts teaser chart   # only the named examples; no argument renders all five
npx serve _site                           # or any static server
```

The brand assets are under `.github/assets/`: `mark.svg` (the same document as `src/lib/brand.ts`,
which the preview page uses), and the wordmark as `logo.svg` for light backgrounds and `logo-dark.svg`
for dark ones.
