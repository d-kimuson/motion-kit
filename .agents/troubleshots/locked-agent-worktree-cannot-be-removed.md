# `git worktree remove` fails on an agent worktree because it is locked

## Symptom

```sh
git worktree remove /Users/kaito/repos/motion-kit/.claude/worktrees/agent-<id>
```

fails with `cannot remove a locked working tree`, and `git worktree list` marks the entry `locked`. The lock reason names the agent and its process:

```sh
git worktree list --porcelain | grep -A0 '^locked'
# locked claude agent agent-ac5d4f6176e222f1e (pid 17653 start Mon Nov  2 08:39:23 2026)
```

The agent runtime that created the worktree takes the lock and may keep it after the agent has finished.

## Workaround

Make sure the worktree is no longer in use (its agent finished, and its branch is pushed or merged), then unlock and remove it:

```sh
git worktree unlock <path>
git worktree remove <path>
```

Do not use `git worktree remove -f -f`: it also removes a worktree whose agent is still running, with its uncommitted work. A worktree with uncommitted changes still needs a decision of its own, not `--force`.

## Why Not Fixed

The lock is taken by the agent runtime, outside the repository. It cannot know when the harness is done with the worktree, so cleaning up is a manual step. Delete this troubleshot when the runtime releases the lock at the end of the agent.
