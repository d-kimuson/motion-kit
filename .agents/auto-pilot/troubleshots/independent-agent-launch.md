# Independent Agent launch fails

## Symptom

The recipe in `docs/guidelines/auto-pilot.md` (start the Independent Agent as a SubAgent with worktree isolation) does not work in this harness (pi with the pi-subagents package).

- An inline workflow block in the reply is rejected with:

  ```
  The assistant message that issued this call has no text in the session
  ```

- Launching the builtin `worker` agent fails with:

  ```
  runs.run: Agent 'worker' is disabled by a settings override
  ```

  followed by the list of available agents. `worker` is disabled by `subagents.agentOverrides.worker.disabled: true` in `~/.pi/agent/settings.json`.

## Workaround

Start the Independent Agent from a workflow script that lives outside the repository, and use `delegate` with an explicit model instead of `worker`.

1. Make sure the repository git tree is clean: a worktree is created from it.
2. Write the launch script to `/tmp/auto-pilot-launch/<task>.js` (outside the repository, so the tree stays clean):

   ```js
   runs.run('<key>', {
     agent: 'delegate',
     model: 'openai-codex/gpt-6-astra:high',
     task,
     worktree: true,
   });
   ```

3. Start it with:

   ```
   subagent({ workflow: "/tmp/auto-pilot-launch/<task>.js", async: true })
   ```

   The workflow must be a file path; an inline workflow block is rejected (Symptom).

## Why Not Fixed

- pi-subagents gives a SubAgent run worktree isolation only when it is launched from a workflow script, and the script must be a file path. The Claude Code form (the Agent tool with `isolation: "worktree"`) has no equivalent in this harness.
- The builtin `worker` agent is disabled by a user settings override in `~/.pi/agent/settings.json`; re-enabling it needs a user decision, so `delegate` with an explicit model is used instead.
