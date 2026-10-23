# Backlog

Tasks live in the taskroom project `motion-kit`, operated through the taskroom MCP tools.

## Location and operations

- List: `taskroom_list_projects` to find the project, `taskroom_list_tasks` filtered by its `projectId`; `taskroom_get_task` for one task.
- Create: `taskroom_create_task` with a new UUID as `id` and `projectId` set to the project.
- Update: `taskroom_update_task` with the task's current `revision` (read it right before updating; a stale revision is rejected).
- There are no comments on tasks; progress and findings go in the task `description`.

## State and priority

- `status`: `Idea` (not yet agreed), `Backlog` (agreed, not started), `In Progress`, `In Review` (PR open), `Done`.
- `priority`: `P0` (blocks everything), `P1` (next), `P2` (planned), `P3` (someday), or empty.
- `blocks`: ids of the tasks this one blocks. `links`: PR, ADR, or spike report URLs.
- `assignId`: the actor working on it. Set it when moving to `In Progress`.

## Filing

- Title: an imperative sentence naming the outcome, with the context in brackets when it belongs to one (`[core] Implement rational frame/time conversion`).
- Description: the goal, how it is verified, and the documents to read (design section, ADR, CONTEXT.md). Problems found outside the current task (`docs/guidelines/delegate.md`) are filed as `Backlog` with the finding and the location, and the `Bug` label when it is a defect.
- Dependencies go in `blocks` on the blocking task, not in prose.

## Ready

A task is ready to be picked up when its status is `Backlog`, every task that blocks it is `Done`, and its description says how the result is verified. Pick by priority, then by the roadmap order in `docs/tmp/design.md` (Phase 0 spikes before Foundation).
