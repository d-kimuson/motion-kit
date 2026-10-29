# `npx <own package name>` fails inside the package's own checkout

## Symptom

Run in the repository root, where `package.json#name` is `@kimuson/motion-kit` (npm 11.20.0, Node 26.12.0):

```bash
npx @kimuson/motion-kit --help
# sh: line 1: motion-kit: command not found

npm exec --yes -- @kimuson/motion-kit@0.0.2 --help
# sh: line 1: motion-kit: command not found
```

A scratch directory with a different root name prints the usage instead, and in a project that installed the package `npx motion-kit --help` works:

```bash
mkdir /tmp/mk-check && cd /tmp/mk-check
npx --yes @kimuson/motion-kit --help     # Usage: motion-kit <render|frame> <entry> [options]
```

The failure is not a packaging defect: the published tarball carries `bin = { 'motion-kit': 'dist/cli.js' }`, `dist/cli.js` has the `#!/usr/bin/env node` shebang, is executable, and `node_modules/.bin/motion-kit` is linked in a consumer install.

## Workaround

Run the built CLI from the checkout:

```bash
pnpm build
node dist/cli.js --help
node dist/cli.js render <entry> --out out.mp4
```

To exercise the published bin rather than the local build, run `npx @kimuson/motion-kit …` from a directory whose `package.json` has another name, or from none.

## Why Not Fixed

`npm exec` resolves the spec against the tree rooted at the current `package.json`. The root package has that name and a matching version, so npm treats the dependency as already satisfied: it installs nothing, then looks for the bin in `node_modules/.bin/`, where the package's own bin is not linked — a project is not its own dependency. It then falls back to invoking the bare command name in a shell, which fails with exit 127.

A repo-side fix would have to link the package into its own `node_modules` (a self-dependency no package manager does for the root), and it would change what "run the CLI" means for a contributor. Consumers never hit this, so the workaround stays.
