# Team Channel

Where to send questions and reports to the user or the team, and how to write them.

## Destination

- Tool: Slack (Kaito's Workspace). Send with `slack_send_message` of the Personal MCP Portal (in Claude Code, `mcp__claude_ai_Personal_MCP_Portal__slack_slack_send_message`).
- Channel: `#times-kimuson` (channel id `C0C8K9DTTL4`).
- Mention: put `<@U096QNDAA7M>` at the start of the message.
- Replies: received in the thread of the sent message. Check for replies by reading the thread with `slack_read_thread` (`channel_id: C0C8K9DTTL4`, `message_ts: <ts>`), using the dotted `ts` stored below.

## Writing

- One question per message, with the options, the recommendation, and its reason in one sentence.
- Give only as much background as the reader needs to decide on the spot; pass the detailed material as a link to the Backlog task.

## Questions on the Backlog

- Before asking a question with no task, file it as a user task by `docs/guidelines/backlog.md`, then ask. Include the task key in the form `TASK-<number>` (for example, `TASK-143`, not the UUID `id`) in every question sent to the team channel.
- When a question is sent, the auto-pilot appends a paragraph to the end of that task's description: the exact prefix `Waiting on the user:`, then the question and options, then the recommendation and its reason, all copied from the Slack message, then the Slack permalink and `ts: <ts>` with the original dotted `ts` returned by `slack_send_message`. Build the permalink as `https://<workspace>.slack.com/archives/<channel_id>/p<ts-without-dot>`; `<workspace>` is the subdomain in the Slack URL for Kaito's Workspace, and `<channel_id>` is the channel id above. Read the workspace URL from Slack rather than guessing it. Keep every unanswered question there, not only in local state or Slack.
- When a question is sent, a task in `In Progress` or `In Review` becomes `In Progress` for the duration of the wait; a task that has never started stays `Backlog`.
- A user edit to the task description counts as an answer only if it answers one of the waiting questions, not merely reports progress. For an answer in the task description or the Slack thread, the auto-pilot replaces the waiting paragraph whose question it answers with a `DECIDED: <answer>` line at that location in the same edit; if it is unclear which question the reply answers, ask the user rather than guess. If other waiting paragraphs remain, keep the waiting status; otherwise, set the status to `In Review` if a PR is open, else `In Progress` if work is still in progress, else `Backlog`.

Example paragraph (illustrative workspace and timestamp):

> Waiting on the user: Should TASK-143 use option A or option B (I recommend option A because it avoids a new dependency)? https://example.slack.com/archives/C0C8K9DTTL4/p1770000000000000 ts: 1770000000.000000
