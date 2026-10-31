# python3 hangs while DEVELOPER_DIR points at a Nix apple-sdk

## Symptom

Any `python3` invocation never returns and prints nothing:

```sh
timeout 20 python3 -c 'print(1)'; echo "exit=$?"
# exit=124 (killed by timeout, no output)
```

`command -v python3` reports `~/.local/share/mise/shims/python3`, but bypassing the shim does not help: `/usr/bin/python3` hangs the same way. `echo "$DEVELOPER_DIR"` prints a Nix store path ending in `-apple-sdk-14.4`. `node`, `perl` and `pnpm` are not affected.

## Workaround

Unset `DEVELOPER_DIR` for the Python command:

```sh
env -u DEVELOPER_DIR python3 -c 'print(1)'   # prints 1
```

For repository edits, `node` (the repository's own runtime), `perl -pi -e` or the editor's replace tool work without it.

## Why Not Fixed

`/usr/bin/python3` is the Xcode stub, and it resolves the interpreter through `DEVELOPER_DIR`. The shell environment exports `DEVELOPER_DIR` pointing at a Nix `apple-sdk` store path, which has no Python, and the stub never returns. The mise shim has no Python version set and falls through to the same stub. With the variable unset, `xcode-select -p` reports `/Applications/Xcode.app/Contents/Developer`, and `python3` runs `/Applications/Xcode.app/Contents/Developer/usr/bin/python3`. Fixing it means not exporting `DEVELOPER_DIR` into agent shells. That is the machine's shell configuration, not the repository's. Delete this troubleshot once `timeout 20 python3 -c 'print(1)'` prints `1` without unsetting `DEVELOPER_DIR`.
