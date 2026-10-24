# Auto-pilot integrations are missing in the Command Code harness

## Symptom

Running the auto-pilot in Command Code (this session), the mechanisms named by
`docs/guidelines/auto-pilot.md` and `docs/guidelines/team-channel.md` are not
available:

- No taskroom tools (`taskroom_list_tasks`, `taskroom_get_task`, ...) and no
  Slack tools (`slack_send_message`, `slack_read_thread`). Both were served by
  Claude Code's hosted Personal MCP Portal
  (`mcp__claude_ai_Personal_MCP_Portal__*`); `~/.commandcode/mcp.json` has no
  equivalent server, and the portal is a claude.ai connector with no local
  endpoint or token to reuse. `cmd mcp auth` has nothing to authenticate.
- No `subagent` tool, no workflow-script worktree isolation, no `compact` tool.
  The harness offers the `agent` tool (`general` / `explore` / `plan`
  subagents), `cron_create`, `sleep`, and `schedule_wakeup`.

## Workaround

Keep the auto-pilot loop, with these substitutions until the integrations are
available:

| Guideline mechanism     | Command Code form                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backlog (taskroom)      | Local mirror `.agents/auto-pilot/backlog.md`, reconstructed from `context.md`. Treat it as the board; do not invent task ids that the mirror does not record. |
| Team channel (Slack)    | Ask the user in the session reply. Record the question in `context.md` under "Questions to the user" and keep working on other items.                  |
| Independent Agent       | `agent({ subagent_type: "general", run_in_background: true })`; tell it to create a persistent `git worktree` under `/Users/kaito/repos/worktrees/motion-kit/<name>` and commit/push early. |
| SubAgent (review/QA)    | `agent({ subagent_type: "general" })` with the verbatim instruction from `docs/guidelines/delegate.md`.                                                |
| Wait                    | `cron_create` with a one-shot prompt, or `sleep` for the interval.                                                                                     |
| `compact` at clean-up   | End the turn; the next turn starts from `docs/guidelines/auto-pilot.md` and `.agents/auto-pilot/context.md`.                                          |

A finished `agent` run keeps nothing: whatever lives in its worktree persists on
disk, so a second round is a new run pointed at the same worktree path.

## Subagents share one scratchpad

All SubAgents in a session share the same scratchpad directory. Two concurrent
agents that both write `review-body.md` overwrite each other; one review body was
posted as a JavaScript fragment because of it, and a submitted GitHub review body
cannot be edited. Give every temp file the task or run id in its name
(`pr28-review-body.md`), or write it under a per-run subdirectory.

## Heredocs are not preserved in `gh pr create --body`

`gh pr create --body "$(cat <<'EOF' … EOF)"` run through this tool's shell was
executed line by line: the heredoc body ran as commands instead of becoming one
argument. Use `--body-file <path>` (with a unique scratchpad path) for
`gh pr create`, `gh pr edit`, and any other long multi-line argument.

## Why Not Fixed

The missing MCP servers are an external-tool limitation: the portal is hosted by
Claude and its credentials are not reachable from Command Code. The guideline
itself is updated for the Command Code form (see the Independent Agent section);
the Backlog and team-channel substitution stays a workaround so the repository is
not taught to depend on a mirror that can drift from taskroom. When taskroom and
Slack become available again, drop the mirror, re-read the board, and reconcile
`.agents/auto-pilot/backlog.md` into it.
