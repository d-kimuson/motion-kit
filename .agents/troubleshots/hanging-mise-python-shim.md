# mise's python3 shim hangs

## Symptom

Any `python3` invocation in the repository never returns and prints nothing:

```sh
timeout 20 python3 -c 'print(1)'; echo "exit=$?"
# exit=124 (killed by timeout, no output)
```

The same command is what a scratch script uses to rewrite a file. `command -v python3` reports `~/.local/share/mise/shims/python3`. `python` (without the 3) is not affected: it exits at once with `mise ERROR No version is set for shim: python`. `node`, `perl` and `pnpm` are not affected.

## Workaround

Do not script repository edits through `python3`. Use `node` (the repository's own runtime), `perl -pi -e`, or the editor's replace tool instead:

```sh
node -e "const fs=require('node:fs');const p='file.ts';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(a,b))"
```

## Why Not Fixed

The hang is in the mise shim, not in the repository: mise resolves the `python3` shim before the script runs and never returns, with or without `MISE_DISABLE_TOOLS=1`, while `~/.local/share/mise/installs/python` holds several versions (`3`, `3.11`, `3.11.0`, `latest`). Fixing it needs a working `mise use -g python@3.11.0` (or the removal of the stale `python3` shim) on the machine, which the repository does not own. Delete this troubleshot once `python3 -c 'print(1)'` returns.
