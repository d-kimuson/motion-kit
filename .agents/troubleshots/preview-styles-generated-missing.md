# A fresh worktree fails to typecheck on the missing generated preview stylesheet

## Symptom

In a fresh `git worktree`, before anything has been built, the whole-program typecheck fails on a gitignored generated file:

```sh
pnpm exec tsc -p . --noEmit
# src/preview/view.tsx(12,29): error TS2307: Cannot find module './styles.generated.ts' or its corresponding type declarations.
```

`src/preview/styles.generated.ts` does not exist in the worktree: `.gitignore` ignores it, and it is only produced by `pnpm build`. The failure is unrelated to the change under test, and no test has run yet.

## Workaround

Generate the stylesheet once in the worktree before typechecking:

```sh
node scripts/preview-css.ts
pnpm exec tsc -p . --noEmit   # exit 0
```

`pnpm build` runs the same script (first step, before `tsdown`), so building is the equivalent route. `pnpm vitest run <file>` skips `pretest` and needs the file too, which is why `docs/guidelines/quality-assurance/index.md` already says to run `pnpm build` first in a fresh worktree.

## Why Not Fixed

The generated module is deliberately gitignored (`src/preview/styles.css` is the source; `scripts/preview-css.ts` compiles it with Tailwind's scanner). Committing the output would let it drift from the stylesheet, and generating it as part of `pnpm install` would slow every install for a preview-only artifact. CI generates it through the build step, and the gap is worktree provisioning outside the repository, so the workaround stays. Delete this troubleshot if typecheck stops depending on a build artifact.
