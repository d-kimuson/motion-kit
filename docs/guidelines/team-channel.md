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
