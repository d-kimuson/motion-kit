# Developing motion-kit

This page is for working on motion-kit itself, in a checkout of the repository. Using the package is
covered by the [README](../README.md) and the [documentation index](../docs/index.md); the
contributor rules (Feedback Loop, guidelines, contexts) start at [AGENTS.md](../AGENTS.md).

## Commands

```bash
pnpm install
pnpm fix        # oxlint --fix and oxfmt
pnpm lint       # oxlint, oxfmt --check, package checks, license allowlist, tsconfig, Lean specs
pnpm typecheck
pnpm test
pnpm build      # tsdown: dist/ for the published package and the CLI
lake build      # Lean specs under src/core (Lean version from lean-toolchain, via elan)
nix develop     # devShell from flake.nix: Node 26, pnpm, gitleaks, elan
```

CI runs `pnpm lint`, `pnpm typecheck`, `lake build` and `pnpm test`. The render tests need a Chromium
(`pnpm exec playwright install chromium`), and the encoding and CLI tests also need FFmpeg and
`ffprobe` on `PATH`. The Phase 0 browser experiments stay separate from the framework, each with its
own README and `pnpm spike:*` script under `spikes/<name>/`.

## Repository documentation

- `docs/index.md` and `docs/guide/` are the user documentation. They ship inside the npm package, so
  an agent using motion-kit reads them from `node_modules/@kimuson/motion-kit/docs/`; keep them about
  using the package.
- `docs/CONTEXT-MAP.md`, `docs/contexts/`, `docs/decisions/`, `docs/design-doc/` and
  `docs/guidelines/` are for development and stay out of the package (`files` in `package.json`).
- `dev-docs/` holds development notes that used to live in the README.
