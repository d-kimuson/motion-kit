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
