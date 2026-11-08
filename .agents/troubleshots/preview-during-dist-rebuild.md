# A command that reads dist/ fails while another command in the same checkout rebuilds it

## Symptom

A build empties `dist/` before it writes it again. Any command that reads `dist/` in that window fails, and the failure disappears on the next run. Two cases have been seen.

`motion-kit preview`, `render` or `frame` fails while another agent or terminal runs `pnpm build` in the same checkout:

```text
error: render.page-error: Loading service exited failed. — Check service exited and the project configuration; the loader uses bundled Vite 7.3.7.
```

`pnpm lint` (publint and attw pack `dist/`), `pnpm typecheck` and `pnpm test` (the built-artifact tests `src/cli/built-artifact.test.ts` and `src/motion/built-artifact.test.ts`) fail with a missing `dist/` file or an unresolved package entry while another process in the same checkout is building. `prelint`, `pretypecheck` and `pretest` each run `pnpm build` first, so two of these commands started together in one checkout rebuild `dist/` under each other. The exact failure text of this case was not recorded.

## Workaround

Do not run two of `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and the preview in one checkout at the same time; run them one after the other, or run each agent's commands in its own worktree, which has its own `dist/`. When one of them fails this way and nothing else is building now, run it again before investigating, and do not change the code or the example to chase the error.

For a preview, wait for the other build to finish (`ls dist/` lists `index.js`, `browser.js` and `preview.js` again), then reload the preview page (for `render` or `frame`, run the same command again).

## Why Not Fixed

The examples import the package by its own name, which resolves to `dist/` through `package.json#exports`, and `tsdown.config.ts` has `clean: true`, so a build empties `dist/` before writing it again. Anything that loads `dist/` in that window finds the files missing. Not cleaning would leave stale outputs from removed entries in the published tarball; building into a temporary directory and swapping it in would close the window, but it is a build-tooling change nobody has needed beyond this workaround yet. Whoever runs a build in a shared checkout has to keep every other command that reads `dist/` from running in it at the same time.
