# The result of `pnpm lint` is buried under build output, the attw table and warnings

## Symptom

`pnpm lint` runs `pnpm build` first and then its checks in parallel (`run-p lint:*`). It prints about 150 lines even when everything passes: the tsdown build log, the publint lines, the attw (are-the-types-wrong) table for every subpath with its `(ignored)` resolutions, and oxlint warnings. There is no summary line. A passing run ends with oxlint warnings that look like findings:

```text
src/render/render-video.test.ts:345:9: warning jest(no-conditional-expect): Unexpected conditional expect help: Avoid calling `expect` conditionally
```

A failing check prints its message somewhere in the middle of the same output, so a failure is easy to miss, and a pass is easy to mistake for one. The warnings (`jest(no-conditional-expect)` in `src/render/render-video.test.ts`, `jest(expect-expect)` in `src/three/canvas-failure.browser.test.tsx`) are known and do not fail the run.

## Workaround

Decide by the exit code, not by the output. Write the output to a file and read the exit code the Bash result reports; `0` is a pass:

```sh
pnpm lint > <scratchpad>/lint.out 2>&1
```

On a nonzero code, run the checks one by one and read only the one that fails: `pnpm lint:oxlint`, `pnpm lint:oxfmt`, `pnpm lint:publint`, `pnpm lint:attw`, `pnpm lint:licenses`, `pnpm lint:third-party`, `pnpm lint:tsconfig`, `pnpm lint:lean-spec`. In oxlint's output only lines with `error` are findings; lines with `warning` are not.

## Why Not Fixed

Quieting attw (`--format ascii`, `--no-summary`, `--quiet`) or adding one result line per check changes the lint script and what a maintainer sees on a failure; that is a decision about the script, not a workaround. The jest warnings come from `oxlint.config.ts` on purpose: its comment explains that matching `*.test.ts` with the jest-rules glob would make `src/render/render-video.test.ts` fail with `jest/no-conditional-expect` errors. Removing the warnings means rewriting those tests, which is a test-design change. Delete this troubleshot once `pnpm lint` ends with one summary line per check.
