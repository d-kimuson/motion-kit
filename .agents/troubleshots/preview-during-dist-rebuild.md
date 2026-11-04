# `motion-kit preview` shows render.page-error while dist/ is being rebuilt

## Symptom

`node dist/cli.js preview examples/<name>/entry.tsx` shows `render.page-error` on the first load, and the Vite output reports that it cannot find or load a file under `dist/` (`dist/*.js`). At the same time another process (another agent, or a `pnpm build` in a different terminal) was running `pnpm build` in the same checkout.

## Workaround

Wait for the other build to finish (`ls dist/` lists `index.js`, `browser.js` and `preview.js` again), then reload the preview page. Do not change the example to chase the error. Running the preview from its own worktree avoids sharing `dist/` with other work.

## Why Not Fixed

The examples import the package by its own name, which resolves to `dist/` through `package.json#exports`, and `tsdown.config.ts` has `clean: true`, so a build empties `dist/` before writing it again. A preview that loads in that window finds the files missing. Not cleaning would leave stale outputs from removed entries in the published tarball; whoever runs a build in a shared checkout has to avoid running a preview from it at the same time.
