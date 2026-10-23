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

- Before asking a question with no task, file it as a user task by `docs/guidelines/backlog.md`, then ask. Include the task key (for example, `TASK-143`) in every question sent to the team channel.
- When a question is sent, the auto-pilot appends a paragraph beginning `Waiting on the user:` to the end of that task's description, with the question in one sentence, the recommendation with its reason, and the Slack message link. Keep every unanswered question there, not only in local state or Slack.
- While waiting, keep the task `In Progress` (even if a PR is open), or `Backlog` if it has never started.
- When the user replies on the task or in Slack, the auto-pilot removes the corresponding `Waiting on the user:` paragraph, records the answer in the description as `DECIDED:`, and updates the task's status to reflect the work's state.
