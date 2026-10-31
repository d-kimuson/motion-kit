# `pueue add -- bash -c '…'` loses the nested quoting

## Symptom

Queueing a shell loop by wrapping it in `bash -c` (pueue 4.0.4) fails in under a second, before the loop runs:

```sh
pueue add -- bash -c 'for i in 1 2 3; do echo $i; done'
# New task added (id 786).
pueue log 786
# Task 786:    failed with exit code 2
# Command: bash -c for i in 1 2 3; do echo $i; done
# output:
# sh: -c: line 1: syntax error near unexpected token `do'
# sh: -c: line 1: `bash -c for i in 1 2 3; do echo $i; done'
```

The error comes from `sh`, not from the wrapped command, so it looks like a broken queue rather than a quoting problem. `pueue log` echoing the command without its quotes is the tell.

## Workaround

Put the loop in a script file and queue the script:

```sh
printf '%s\n' '#!/usr/bin/env bash' 'for i in 1 2 3; do echo "$i"; done' > /tmp/job.sh
chmod +x /tmp/job.sh
pueue add -- /tmp/job.sh
```

Or pass the whole command as one pre-quoted argument, so the quotes survive the join:

```sh
pueue add -- "bash -c 'for i in 1 2 3; do echo \$i; done'"
```

Both complete and print `1 2 3`.

## Why Not Fixed

pueue joins the arguments after `--` with spaces into a single string and re-executes that string through `sh -c`. In `bash -c 'for …; do …; done'` the quotes are consumed by the caller's shell before pueue sees them, so `;` and `do` end up at the top level of the string `sh` parses. Changing the shell (`shell_command` in `pueue.yml`, `sh -c` by default) does not help: `bash -c` on the same joined string fails identically. Fixing it at the root needs quote-aware joining in pueue, which is upstream and not ours to change; queue a script or a single pre-quoted argument instead.
