# `git push` prints "cannot lock ref" although the push succeeded

## Symptom

`git push -u origin HEAD` prints an error line containing `cannot lock ref` after the remote accepted the update, and the command's result looks like a failure. Seen when a branch was pushed while another process updated refs of the same repository.

## Workaround

Do not retry blindly. Compare the remote branch with the local commit first:

```sh
git ls-remote origin refs/heads/<branch>
git rev-parse HEAD
```

When both print the same commit, the push succeeded; go on. When the remote has an older commit or no line, push again.

## Why Not Fixed

Which side printed the error was not investigated; the push result is the remote's state, so `git ls-remote` is the source of truth. Delete this troubleshot if a cause is found and removed.
