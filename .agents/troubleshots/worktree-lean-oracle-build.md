# A fresh worktree has no Lean oracle, so the differential tests fail

## Symptom

In a fresh `git worktree` (`~/repos/worktrees/<repo>/<task>`), `pnpm test` reports four failed files and the unit project fails with:

```text
Error: .lake/build/bin/spec-oracle not found: run `lake build` first
 ❯ evalSpecs spec/oracle.ts:22:11
 ❯ src/core/transition/overlap.oracle.test.ts:110:13
 Test Files  4 failed | 36 passed (40)
```

The failures have nothing to do with the change under test: `.lake/` is gitignored, so a new worktree starts without the oracle binary even though `node_modules` was installed.

## Workaround

Build the specs once in the worktree before running the tests that consult the oracle:

```sh
DIRENV_DISABLE=1 timeout 900 lake build   # "Build completed successfully (11 jobs)."
```

`pnpm test` is green afterwards.

When the Lean inputs (`src/core/**/*.lean`, `spec/`, `lakefile.toml`, `lean-toolchain`, `lake-manifest.json`) are identical to another checkout that already has `.lake/`, linking its build is faster than building. The link is valid only while the inputs stay identical; once any of them differs from the linked checkout, build in the worktree instead, and remove the symlink first (`rm .lake` removes only the link) so `lake build` does not write through it into the other checkout's build output:

```sh
ln -s <other checkout>/.lake .lake   # link while the inputs are identical
rm .lake                             # before `lake build` in the worktree, once any input differs
```

`.gitignore` ignores `.lake` as a symlink as well as a directory. `pnpm test --project cli` (and any project without `*.oracle.test.ts`) does not need it.

## Why Not Fixed

CI runs `leanprover/lean-action` with `build: true` before the test steps (`.github/workflows/check.yaml`), so the artifact exists there; the gap is worktree provisioning outside the repository, which cannot pre-build a Lean artifact it does not install. A test-side skip would hide a missing oracle in CI, so the failure stays hard.
