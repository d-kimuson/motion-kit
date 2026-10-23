# Local Development

Rules for managing the development environment's dependencies.

- npm packages are managed with pnpm at the version in `packageManager` (`package.json`). Versions are pinned exactly (`save-exact` in `pnpm-workspace.yaml`); `minimum-release-age` keeps packages published less than a day ago out. Change the lockfile only through pnpm and include `pnpm-lock.yaml` in the same commit as `package.json`.
- Node.js is the version in `.node-version`. Other tools (Node, pnpm, gitleaks, elan) come from the nix dev shell (`flake.nix`), entered through direnv (`use flake`) or `nix develop`. Nothing is installed globally.
- The Lean toolchain is managed by elan from `lean-toolchain`; the first `lake build` downloads it. `.lake/` is build output and is gitignored.
- CI installs the same way: `.github/actions/setup-node` installs pnpm at the `packageManager` version and runs `pnpm install --frozen-lockfile --ignore-scripts`; `leanprover/lean-action` installs elan and runs `lake build`.
- Rendering needs a Chromium build (Playwright) and FFmpeg; when the render context gets its first code, record how each is obtained here and in `docs/guidelines/quality-assurance/exploratory-testing.md`.
- Before adding a production dependency, check its license against `scripts/check-licenses.ts` and whether it belongs behind an optional subpath (`REVIEW.md`, Dependencies).
