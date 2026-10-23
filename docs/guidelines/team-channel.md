# Team Channel

Where to send questions and reports to the user or the team, and how to write them.

## Destination

- Tool: Slack (Kaito's Workspace). Send with `slack_send_message` of the Personal MCP Portal (in Claude Code, `mcp__claude_ai_Personal_MCP_Portal__slack_slack_send_message`).
- Channel: `#times-kimuson` (channel id `C0C8K9DTTL4`).
- Mention: put `<@U096QNDAA7M>` at the start of the message.
- Replies: received in the thread of the sent message. Keep the `ts` returned when sending, and check for replies by reading the thread with `slack_read_thread` (`channel_id: C0C8K9DTTL4`, `message_ts: <ts>`).

## Writing

- One question per message, with the options, the recommendation, and its reason in one sentence.
- Give only as much background as the reader needs to decide on the spot; pass the detailed material as a link to the Backlog task.

## Questions on the Backlog

- Before asking a question with no task, file it as a user task by `docs/guidelines/backlog.md`, then ask. Include the task key in the form `TASK-<number>` (for example, `TASK-143`, not the UUID `id`) in every question sent to the team channel.
- When a question is sent, the auto-pilot appends a paragraph to the end of that task's description: the exact prefix `Waiting on the user:`, then the question and options, then the recommendation and its reason, all copied from the Slack message, then the Slack permalink. Build the permalink as `https://<workspace>.slack.com/archives/<channel_id>/p<ts-without-dot>` using the `ts` saved from `slack_send_message`. Keep every unanswered question there, not only in local state or Slack.
- When a question is sent, a task in `In Progress` or `In Review` becomes `In Progress` for the duration of the wait; a task that has never started stays `Backlog`.
- When the user answers in the task description or the Slack thread, the auto-pilot deletes the corresponding waiting paragraph and inserts a `DECIDED: <answer>` line at that location in the task description in the same edit. If other waiting paragraphs remain, keep the waiting status; otherwise, return the task to the status of the work: `In Review` if a PR is open for review, or `In Progress` if work continues (a task that has not started remains `Backlog`).

Example paragraph (illustrative workspace and timestamp):

> Waiting on the user: Should TASK-143 use option A or option B (I recommend option A because it avoids a new dependency)? https://example.slack.com/archives/C0C8K9DTTL4/p1770000000000000
