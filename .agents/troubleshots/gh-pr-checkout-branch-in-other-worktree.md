# `gh pr checkout <n>` fails when the PR branch is checked out in another worktree

## Symptom

```sh
gh pr checkout 110
```

```text
fatal: 'feat/agent-inspect-timeline' is already used by worktree at '/Users/kaito/repos/motion-kit/.claude/worktrees/agent-ae5421a223cb9164f'
failed to run git: exit status 128
```

Agents work in many worktrees of one repository, and git allows a branch in only one of them.

## Workaround

To read or test the PR's code, check it out detached; no branch is involved, so the other worktree does not matter:

```sh
gh pr checkout 110 --detach
```

To commit on top of the PR, fetch the branch and create a new local branch name from it, then push to the PR's branch:

```sh
git fetch origin feat/agent-inspect-timeline
git switch -c review-110 FETCH_HEAD
git push origin HEAD:feat/agent-inspect-timeline
```

Edit in the worktree that owns the branch instead when its agent is still working there.

## Why Not Fixed

It is git's rule that one branch is checked out in at most one worktree. Delete this troubleshot only if the repository stops using one worktree per agent.
