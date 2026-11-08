# `motion-kit preview` shows render.page-error while dist/ is being rebuilt

## Symptom

`node dist/cli.js preview examples/<name>/entry.tsx` (or `render`, `frame`) fails while another agent or terminal runs `pnpm build` in the same checkout (`pnpm lint` runs one too):

```text
error: render.page-error: Loading service exited failed. — Check service exited and the project configuration; the loader uses bundled Vite 7.3.7.
```

The same window gives false failures to anything else that reads `dist/` while another process in the same checkout rebuilds it: `pnpm lint` (publint and attw pack `dist/`), `pnpm typecheck`, and the built-artifact tests (`src/cli/built-artifact.test.ts`, `src/motion/built-artifact.test.ts`). `prelint`, `pretypecheck` and `pretest` each run `pnpm build` first, so two of these commands started together in one checkout rebuild `dist/` under each other.

## Workaround

Do not run `pnpm lint`, `pnpm typecheck`, `pnpm test` or a preview in one checkout at the same time as another command that builds; run them one after the other. When one of them fails with a missing `dist/` file or an unresolved package entry and nothing else is running now, run it again before investigating. Wait for the other build to finish (`ls dist/` lists `index.js`, `browser.js` and `preview.js` again), then reload the preview page (for `render` or `frame`, run the same command again). Do not change the example to chase the error. Running the preview from its own worktree avoids sharing `dist/` with other work.

## Why Not Fixed

The examples import the package by its own name, which resolves to `dist/` through `package.json#exports`, and `tsdown.config.ts` has `clean: true`, so a build empties `dist/` before writing it again. A preview that loads in that window finds the files missing. Not cleaning would leave stale outputs from removed entries in the published tarball; building into a temporary directory and swapping it in would close the window, but it is a build-tooling change nobody has needed beyond this workaround yet. Whoever runs a build in a shared checkout has to avoid running a preview from it at the same time.
