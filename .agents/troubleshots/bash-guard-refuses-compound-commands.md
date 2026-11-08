# The Bash guard in Claude Code worktree sessions refuses compound commands

## Symptom

In a Claude Code worktree session (an agent started with `isolation: "worktree"`), the Bash tool refuses these shapes before running them. The refusal comes from the tool's guard, not from the shell:

- Compound commands: `a && b`, `a; b`, a pipe into a loop.
- `$PWD` and `$?` expansions.
- `sed -i ''` and Python heredocs.
- A command that begins with `sleep`.
- `gh pr create --body "..."` with backticks or `##` inline in the argument.

A refused call returns this text and runs nothing:

```text
This agent is isolated in the worktree <path>, but this command is too complex to verify that it stays inside the worktree. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Split it into plain, separate commands and run them from <path>.
```

`dev-docs/guidelines/delegate.md` (CI Pass) gives exactly the refused shape for the CI wait:

```sh
sleep 60; while gh pr checks <number> >/dev/null 2>&1; [ $? -eq 8 ]; do sleep 30; done; gh pr checks <number>
```

The same wait fails in the foreground, too: a foreground command over about 180 s is moved to the background by the tool, and the agent then receives repeated notifications for it.

## Workaround

Send one plain command per Bash call, with absolute paths instead of `cd` and `$PWD`.

- Long text for GitHub: write it to a file in the scratchpad and pass `--body-file <path>` (`gh pr create`, `gh pr edit`). The same goes for any multi-line argument.
- File edits: use the Edit tool, `perl -pi -e` or `node`, not `sed -i ''` or Python.
- Waiting for CI: start one background command (`run_in_background: true`) and end the turn's work on it; the tool notifies when it exits, so do not poll its output and do not start a second waiter for the same PR.

  ```sh
  gh pr checks <number> --watch --interval 30
  ```

  It exits `0` when every check passed and `1` when one failed (add `--fail-fast` to stop at the first failure). Right after a push no check is registered yet and it prints `no checks reported`; run it again after a few seconds. An `until` loop in a background command works as well.

- `gh pr checks --watch` can fail with a GraphQL timeout while it polls. Run the same command again; nothing is lost.

## Why Not Fixed

The guard belongs to the agent runtime, not to the repository, and the repository cannot configure it. `dev-docs/guidelines/delegate.md` keeps the one-liner because it works in sessions without the guard (the user's own terminal, other harnesses). Delete this troubleshot when the guard accepts that one-liner, or when the guideline's wait command is replaced by one that every harness accepts.
