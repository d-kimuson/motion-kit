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

## Workaround

Send one plain command per Bash call, with absolute paths instead of `cd` and `$PWD`.

- Long text for GitHub: write it to a file in the scratchpad and pass `--body-file <path>` (`gh pr create`, `gh pr edit`). The same goes for any multi-line argument.
- File edits: use the Edit tool, `perl -pi -e` or `node`, not `sed -i ''` or Python.
- Waiting: do not write a `sleep` loop; for CI use the command in `dev-docs/guidelines/delegate.md` (CI Pass).

## Why Not Fixed

The guard belongs to the agent runtime, not to the repository, and the repository cannot configure it. Delete this troubleshot when the guard accepts these shapes.
