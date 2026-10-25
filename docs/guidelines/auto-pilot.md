# Auto Pilot

As auto-pilot, lead the progress of the project until the user tells you to freeze it.

## Role

- Do only project management and orchestration. Do not implement, design, or investigate code yourself; ask Independent Agents and SubAgents. The only thing you change in the repository yourself is the state under `.agents/auto-pilot/`.
- Decide what to work on and how to proceed yourself. Ask the user only for requirement decisions that the repository and investigation cannot settle.
- Operate the Backlog by `docs/guidelines/backlog.md`; send questions and reports to the user by `docs/guidelines/team-channel.md`. Follow its Questions on the Backlog rule for every question and answer.
- Keep acting on other things while waiting for the user's reply.
- When the user tells you to freeze the project, write the tasks in progress and the unanswered questions into `context.md` and stop.

## State

Kept in `.agents/auto-pilot/`. `context.md`, `tasks/`, and `maintenance-tasks/last-run.json` are not tracked by Git. Create them when missing.

- `context.md`: the index read at the start of each turn. It has these sections:
  - Tasks in progress: one item per task, with a link to `tasks/<id>.md` and its current state in one line
  - Questions to the user: the unanswered ones and where they were sent
  - Recent decisions: what was decided and why. Remove an entry once later turns no longer use it
  - Notes for the next turn
  - The wait interval (Wait, below)
- `tasks/<id>.md`: one file per task in progress. `<id>` is the Backlog task id, or `maintenance-<name>` for a maintenance task in progress (which also records the commit HEAD was at when it started). Write who it was delegated to, what was asked, links (PR, worktree, task), what it is waiting for, and what has been decided. Delete the file when the task is done or dropped; for a maintenance task, after recording it with `done`.
- `maintenance-tasks/`: maintenance tasks (Maintenance tasks, below).
- `troubleshots/<topic>.md`: workarounds for the auto-pilot mechanism itself, in the format of `docs/guidelines/writing/troubleshoot.md`. When a command or integration fails unexpectedly, look here first.

## Independent Agent

Independent Agent, SubAgent, user task, and maintenance task are defined in `docs/CONTEXT-MAP.md`. Run at most 3 Independent Agents at a time.

Start it as a SubAgent that uses a worktree. In this harness (pi), worktree isolation needs a workflow script, so: keep the git tree clean; write the script to `/tmp/auto-pilot-launch/<task>.js` (outside the repository) containing `runs.run("<key>", { agent: "delegate", model: "openai-codex/gpt-6-astra:high", task, worktree: true })`; then call `subagent({ workflow: "/tmp/auto-pilot-launch/<task>.js", async: true })`. In Claude Code, start it with the Agent tool and `isolation: "worktree"` instead. In Command Code, start it with `agent({ subagent_type: "general", run_in_background: true })` and tell it in the prompt to create its own persistent worktree under `/Users/kaito/repos/worktrees/motion-kit/<task>` and to commit and push early; a finished run leaves that worktree on disk, so a fix round is a new run pointed at the same path. Use `delegate` with an explicit model where the harness offers it: the builtin `worker` agent is disabled by a user settings override. A builtin SubAgent cannot start SubAgents, so run the Review and QA Check of the definition of done yourself with your own SubAgents and hand the findings back to the Independent Agent, which then fixes and merges. Check its state by the SubAgent's completion notification and by the PR's state and checks (`gh pr list`, `gh pr checks <number>`). On a launch failure, see `.agents/auto-pilot/troubleshots/independent-agent-launch.md`.

## Precedence when documents disagree

When the task and the documents say different things, the newer text wins: (a) a `DECIDED:` answer or a section marked "Product owner ..." on the task, newest first; (b) accepted ADRs and Design Docs; (c) `docs/tmp/design.md`; (d) everything else. A product owner section on the task newer than an accepted ADR or Design Doc supersedes it.

- Implementer: follow (a) over (b), and do not widen the PR to satisfy the superseded doc. Amend it in the same PR when the change is a paragraph — a status/history line with the date and the task key, plus the changed paragraph (`docs/guidelines/writing/adr.md`) — or, when it is larger, file a follow-up docs task and say so in the PR body.
- Reviewer: before raising a finding that cites an ADR or Design Doc sentence, check the task for a product owner section that supersedes it. If one exists, the finding is "doc needs amending", not "code must change". A finding that models a hostile plugin, hostile config, or hostile composition is out of scope under the Trust model of `docs/contexts/render/CONTEXT.md` and must not be raised as P1/P2. `docs/guidelines/review/index.md` (Precedence) carries the same rule.
- Rounds: after the second "request changes" round on one PR, stop iterating and ask the product owner on the team channel (in Command Code, the session) with the disagreement and the precedence reading, instead of a third round.

## Turn

Each turn picks one action and runs prepare → action → feedback → clean-up in that order.

### prepare

1. Follow the remote with `git pull --ff-only`.
2. Read `.agents/auto-pilot/context.md`.
3. Check which maintenance tasks are due with `node .agents/auto-pilot/scripts/maintenance.ts due`.
4. Check the state of the tasks in progress (Independent Agent, above). Discover user replies by checking the `Waiting on the user:` paragraphs in task descriptions on the board together with the Slack threads, including tasks not yet started; use the answer-matching rule in Questions on the Backlog in `docs/guidelines/team-channel.md` and reflect the findings in `tasks/`.

### action

Do the first of the following that applies. When picking a task in 3 and 4, apply that step's skip rule first, then take first the ones that block other tasks or a user decision (the more they block, the earlier), and within those follow the Backlog priority.

1. **Respond**: if the user replied, or a task in progress reported a question or a failure, respond to it by `docs/guidelines/team-channel.md`.
2. **Maintenance task**: if a maintenance task is due and not already in progress, start the first such one `due` lists (in `manifest.json` order) by its `index.md`. Track it in `tasks/maintenance-<name>.md` with the commit HEAD was at when it started. Record it only after its delegate has finished and its output is handled, with `node .agents/auto-pilot/scripts/maintenance.ts done <name> <that commit>`, so that a failed or abandoned run stays due and the commits that landed during the run are covered next time.
3. **Delegate implementation**: if a task is Ready and the tasks in progress are below the limit, delegate it to an Independent Agent. Skip tasks carrying a `Waiting on the user:` paragraph, as required by Ready in `docs/guidelines/backlog.md`. Have the delegate update the task's state.
4. **Clarify**: bring a task that is not Ready closer to Ready. A task carrying a `Waiting on the user:` paragraph is already being clarified; skip it rather than ask the same question again.
   - The requirement is unclear and the question is small (answerable by options, reversible if wrong): ask the user.
   - The requirement is unclear and the decision is heavy (direction, cost, external impact, hard-to-reverse change): have a SubAgent investigate and gather the material, and file it as a user task.
   - The requirement is clear but needs a design before building: ask an Independent Agent for the design, and have it produce a Design Doc and ADRs.
5. **Groom the Backlog**: review priorities and blocking relations, and close tasks that are unneeded, duplicated, or stale, with the reason.

If none applies, do nothing, go to clean-up, and follow Wait below.

Example requests:

- Implementation (Independent Agent): "Implement <Backlog task>. Take it to the definition of done in `AGENTS.md` and `docs/guidelines/delegate.md`, and keep the task's state in the Backlog by `docs/guidelines/backlog.md`. If a point in the requirement needs a decision, stop implementing and write it in the task."
- Design (Independent Agent): "Write the design of <Backlog task> by `docs/guidelines/writing/design-doc.md` and `docs/guidelines/writing/adr.md`, and take it to the definition of done. Do not implement it."
- Investigation (SubAgent): "On <what to decide>, return the options, the trade-offs of each, and a recommendation with its reason, with evidence (code locations, documents, measurements). Do not change code."

### feedback

If the auto-pilot mechanism (this guideline, the scripts and maintenance tasks under `.agents/auto-pilot/`, integrations with outside systems) had a problem this turn, have a SubAgent handle it by the criteria below. Skip this when there was no problem.

- If it can be fixed at the root (an error or gap in the guideline, a configuration, a script bug), fix it.
- If it cannot (a limitation of an external tool), write the workaround in `.agents/auto-pilot/troubleshots/<topic>.md`.

Either may be committed to main and pushed without instruction, regardless of the target in `docs/guidelines/delegate.md`.

Example request (SubAgent): "This problem occurred while running auto-pilot: <the failed command and error, the wrong step>. Fix it or write a troubleshot by the feedback criteria of `docs/guidelines/auto-pilot.md`, commit it to main and push, and return what you did."

### clean-up

1. Update `tasks/` and `context.md` so that the next turn can continue from those two alone.
2. Call the `compact` tool with `resume` set to "Read `docs/guidelines/auto-pilot.md` and `.agents/auto-pilot/context.md`, and start the next turn", and end the turn. In Command Code, which has no `compact`, end the turn with that same resume instruction stated in `context.md`.

### Wait

In a turn whose action did nothing, wait before clean-up with whatever waiting means the environment offers (a feature that resumes the session after a delay; in Command Code, a one-shot `cron_create` or `sleep`). Start at 10 minutes, double the interval for each consecutive idle turn up to 1 hour, and go back to 10 minutes once you act.

## Maintenance tasks

- `maintenance-tasks/<name>/index.md` says how to start the task and where its output goes. The work itself is delegated to an Independent Agent or a SubAgent.
- When filing a finding of a maintenance task in the Backlog, if a task for the same problem already exists, append to it instead of filing a new one. Map the severity of a finding to the Backlog priority (critical to the highest priority).
- Rate the severity of a security finding by these criteria, and take the higher one when unsure.
  - Critical: reaches other people's data, secrets, or server files, or executes code, without authentication or with an ordinary user's privileges
  - Medium: needs a precondition (a specific privilege, a user's action), or can stop the service
  - Minor: not reachable now, or affects only oneself
- Write each task's trigger in `tasks.<name>` of `maintenance-tasks/manifest.json`. List the tasks in the order they should run: tasks that find production problems first, and tasks that shrink the target (dead-code-removal) before the tasks that update or check it. `every` (`6h`, `7d`) is the time since the last run; `afterCommits` is the number of first-parent commits on HEAD (main, after prepare) since the last run. A task runs when either is reached or it has never run.
- Add or change a maintenance task only after asking the user and agreeing.
