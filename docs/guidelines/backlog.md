# Backlog

Tasks live in the taskroom project `motion-kit`, operated through the taskroom MCP tools.

## Location and operations

- List: `taskroom_list_projects` to find the project, `taskroom_list_tasks` filtered by its `projectId`; `taskroom_get_task` for one task.
- Create: `taskroom_create_task` with a new UUID as a top-level `id` and `value: { projectId, title, description, status, priority, links, blocks }`. A `blocks` entry that names a task that does not exist yet fails with NOT_FOUND, so create tasks in dependency order (blockers first).
- Update: `taskroom_update_task` with `task` (`TASK-n`), the task's current `revision` (read it right before updating; a stale revision is rejected), and `changes: { ... }`. `taskroom_get_task` takes `task` (`TASK-n`) too.
- There are no comments on tasks; progress and findings go in the task `description`. For questions and answers, follow Questions on the Backlog in `docs/guidelines/team-channel.md`; its waiting-status rule overrides the status list below.

## State and priority

- `status`: `Idea` (not yet agreed), `Backlog` (agreed, not started), `In Progress`, `In Review` (PR open), `Done`.
- `priority`: `P0` (blocks everything), `P1` (next), `P2` (planned), `P3` (someday), or empty. A task in `Idea` does not keep its priority; set it when moving to `Backlog`.
- `blocks`: ids of the tasks that block this one (blocked-by; the API returns them as `blockerKeys`, and the reverse as `blockingKeys`). `TASK-246` with `blocks=[TASK-247]` cannot start until `TASK-247` is `Done`. `links`: PR, ADR, or spike report URLs.
- `assignId`: the actor holding the task. Set it when moving to `In Progress`. A user task (`docs/CONTEXT-MAP.md`) is assigned to the user's actor: the actor with `kind: user` and `name: kaito` in `taskroom_list_actors`. Look the id up there; do not assume it.

## Filing

- Title: an imperative sentence naming the outcome, with the context in brackets when it belongs to one (`[core] Implement rational frame/time conversion`).
- Description: the goal, how it is verified, and the documents to read (design section, ADR, CONTEXT.md). Problems found outside the current task (`docs/guidelines/delegate.md`) are filed as `Backlog` with the finding and the location, and the `Bug` label when it is a defect.
- A task that asks for a decision says in its description what to decide, the options, the trade-offs of each, and the recommendation with its reason. Its verification says what has to be finished once the decision is made (implementing the chosen option, an ADR).
- Dependencies go in `blocks` on the blocked task, listing the tasks that must finish first, not in prose.

## Ready

A task is Ready to be picked up when its status is `Backlog`, every task that blocks it is `Done`, and its description says how the result is verified, except that a task carrying a `Waiting on the user:` paragraph is never Ready. Pick Ready tasks by priority, then by the roadmap order in `docs/tmp/design.md` (Phase 0 spikes before Foundation). For tasks that are not Ready, follow the Clarify step and its skip rule in `docs/guidelines/auto-pilot.md`.
