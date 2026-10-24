# Worktree node_modules points at another checkout

## Symptom

`pnpm fix` fails with `ERR_MODULE_NOT_FOUND` for a package under the root checkout's `node_modules`, although `pnpm install` in the worktree reported success. `ls -ld node_modules` shows a symlink to the root checkout.

## Workaround

Before installing in a worktree, inspect `node_modules`. If it is a symlink to another checkout, remove only the link and install locally:

```sh
DIRENV_DISABLE=1 timeout 300 sh -c 'test -L node_modules && unlink node_modules'
DIRENV_DISABLE=1 timeout 300 pnpm install --frozen-lockfile
```

Verify `node_modules` is now a directory, not a checkout-level symlink. Individual pnpm package links into its package store are expected. Never install through the checkout-level symlink: pnpm can rewrite the target checkout's relative package links and command shims using the worktree's path depth.

## Why Not Fixed

The checkout-level link is created outside the repository's dependency setup. The repository cannot control worktree provisioning by an external agent harness. Fix that provisioning before removing this workaround.
