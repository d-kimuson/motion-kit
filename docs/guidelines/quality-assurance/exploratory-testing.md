# Exploratory Testing

How to start the product locally and operate it for a QA Check.

## Startup

1. Install dependencies: `pnpm install`.
2. If `.lake/build/bin/spec-oracle` is missing, build the Lean oracle: `lake build` (the first run downloads the toolchain).
3. Confirm the baseline with `pnpm test`; every test passes before the change is explored.
4. Scratch scripts go under `dev/` (gitignored, ignored by lint) and run with `node dev/<name>.ts`. Delete them when done.

Loading sessions use the pinned Playwright Chromium. Reuse an installed browser; if absent, run `pnpm exec playwright install chromium` (Linux CI uses `--with-deps chromium`). Run `pnpm test --project loading` for real config/realm/lifecycle tests, and `pnpm test --project composition-dom` for page bootstrap and core DOM tests. Sandbox remains enabled; software-WebGL is not enabled by these loading tests. FFmpeg is not required: frame transport, PNG capture and encoding have not shipped.

## Operation

- Library (`src/core`, `src/motion`, `src/theme`, `src/three`, `src/presets`): write a scratch script or a temporary vitest file that imports the public entry (root or subpath) as a consumer would, evaluates the changed component or function at chosen times, and prints or asserts the values. Compare sequential evaluation with a random seek order.
- CLI (`src/cli`, once it exists): run the command (`render`, `frame`, `inspect`, `validate`) against a composition, and check the exit code, the JSON diagnostics on stdout, and the files written.
- Loading only (`motion-kit/render/loading`): call `openLoadingSession({ projectRoot, entry })`, inspect descriptors, select a composition and change props, then await and check `dispose()`. Assert the service PID is reused across selections, realm instance changes, and the workspace/processes disappear on disposal. `select` only prepares a root: no scene content, frame or PNG is expected. Exercise a missing browser and an incompatible config and inspect their returned Diagnostics.
- Rendered output (once capture ships): open the PNG frames the `frame` command writes and look at them; compare frames rendered sequentially and by seek.

## Cleanup

- Stop any process you started, remove scratch files under `dev/` and temporary test files, and leave no rendered output in the working tree.
