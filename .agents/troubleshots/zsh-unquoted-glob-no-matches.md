# zsh aborts commands with an unquoted glob: "no matches found"

## Symptom

The agent shell is zsh. A command whose argument contains an unquoted `*`, `?` or `[...]` fails before the command runs when the pattern matches no file in the current directory:

```sh
grep -rn renderFrame src --include=*.ts
# zsh: no matches found: --include=*.ts
ls examples/*/package.json
# zsh: no matches found: examples/*/package.json
```

The same happens with `jq`, `gh --jq`, `find -name` and `rg -g` arguments that contain `*` or `[]`. Nothing is executed and the exit status is 1, which can look like "no results".

## Workaround

Quote every argument that contains glob characters and is meant for the command, not the shell:

```sh
grep -rn renderFrame src --include='*.ts'
jq '.[] | .name' package.json
find . -name '*.lean.md'
```

When the shell glob is intended but may match nothing, use `(N)` (zsh null glob) or run the line under `sh -c '...'`.

## Why Not Fixed

zsh's default `nomatch` option makes an unmatched glob an error instead of passing it through as bash does. The agent shell is the user's login shell, outside the repository; setting `setopt no_nomatch` there would change the user's interactive shell too.
