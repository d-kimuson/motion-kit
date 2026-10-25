# Delegate

The boundary of responsibility between the user and the agent, and how far an implementation task is taken.

## Boundary of responsibility

- The user decides the Goal (what to achieve and to what extent). How to get there is left to the agent.
- The approach (whether to use SubAgents, whether to do everything at once, the order of steps) is the agent's decision within the guidelines. Do not ask the user to approve the approach.
- Do not change the Goal on your own. Reporting completion while part of the scope is deferred because it seemed large, or finishing with a narrower scope than instructed, is a change of Goal. Ask the user only when the Goal cannot be achieved without changing it.
- When a product owner decision recorded on the task supersedes an accepted document, the task wins; follow `docs/guidelines/auto-pilot.md` (Precedence when documents disagree).
- Problems outside the Goal found during work (another bug, a mismatch with the design) are not fixed; attach them to the completion report. File them in the Backlog (`docs/guidelines/backlog.md`) and attach the task link.

## Definition of done

When given an implementation task, take it to the target below without being told, and report completion only after every verification below passes. When the instruction or a command (skill, prompt) names its own target or verification, follow that instead.

- This applies to every change to the repository, harness and documentation changes included. A command whose steps end before committing (a report, a review) does not name a narrower target; take its change to the target as well.
- Being told to commit or to go ahead is not a narrower target either. The target is the user's standing instruction: do not ask again before the push, PR, or merge it includes.

### Target

Target: **Merge PR**.

1. Start from the latest `main` on a branch named after the change: `git switch -c <type>/<slug>` (`<type>` as in `docs/guidelines/commit.md`).
2. Commit by `docs/guidelines/commit.md`.
3. Push the branch: `git push -u origin HEAD`.
4. Open the PR: `gh pr create --fill`. The title follows the commit message format; the body says what changed and how it was verified.
5. After the verifications below pass, merge: `gh pr merge --squash --delete-branch`.

Until the repository has a GitHub remote (`git remote -v` prints nothing), the target is **Main Push**: commit on `main` by `docs/guidelines/commit.md`; the push happens once the remote exists. Review and QA Check results are then returned to the main agent instead of posted on a PR.

### Verification

- **Feedback Loop**: before committing, run every command in the Feedback Loop of AGENTS.md whose "When to run" applies, and fix what fails.
- **CI Pass**: after pushing, wait for CI with `gh pr checks --watch` and fix what fails.
- **Review**: delegate to a SubAgent with this instruction, verbatim: "Review PR #<number> for TASK-<number> by `REVIEW.md` and post the findings as review comments on the PR." (Main Push: "Review the commits <range> for TASK-<number> by `REVIEW.md` and return the findings as a list.") Fix the findings and repeat until there are none, or until the round rule of `docs/guidelines/auto-pilot.md` (Precedence when documents disagree) stops the loop.
- **QA Check**: delegate to a SubAgent with this instruction, verbatim: "Verify <summary of the change> by the QA Check steps in `docs/guidelines/quality-assurance/index.md` and comment the result on PR #<number>." (Main Push: "... and return the result.") `approve` passes. On `reject`, fix and ask again. On `human-check`, attach the human-check content of the result to the completion report as it is, for the user to verify.

The main agent does not read `REVIEW.md` or the QA guidelines itself; it hands them to the SubAgents.

Operations beyond the target (a push, PR, or merge past the target; rewriting pushed history; touching production or other shared resources) are done only when explicitly instructed.
