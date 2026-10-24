# Model provider exhaustion (all delegates fail to launch)

## Symptom

Every delegated run fails immediately (within seconds, before any work):

| Provider / model              | Error                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `openai-codex/gpt-6-astra`    | `Codex error: The usage limit has been reached`                                             |
| `opencode-go/deepseek-v4-pro` | `503 {"type":"server_error","message":"Upstream request failed: Endpoint is unavailable."}` |
| `xai/grok-4.7`                | `402 "You have run out of credits or need a Grok subscription."`                            |
| `zai/glm-4.7`                 | `429 {"code":"1309","message":"Your GLM Coding Plan package has expired ..."}`              |
| `anthropic/*`                 | OAuth refresh expired (`invalid_grant`, "Refresh token expired") — needs `/login`           |

A one-line ping is enough to detect it: launch a probe with
`model: "<provider>/<model>"` and the task `Reply with exactly one line: pong. Do not use any tools.`
(see `/tmp/auto-pilot-launch/ping*.js`). Probing costs one short call, so probe before writing a long brief.

## What to do

1. Probe the providers in the order the context file lists them, cheapest first.
2. When one answers, use it for the turn and record in `.agents/auto-pilot/context.md` which provider currently works, so the next turn does not re-probe from scratch.
3. When none answers, the project cannot progress by delegation. Do this turn's _action_ as:
   - report to the user on Slack (`#times-kimuson`, mention the owner) that all providers are exhausted and exactly what each needs (credits, renewal, quota reset, or `/login` for Anthropic), with the current project state so the message is actionable;
   - keep the task in progress, record where any partial work survives (the harness saves a timed-out run's diff under `~/.pi/agent/sessions/**/subagent-artifacts/worktree-diffs/<runId>/*.patch`), and update its Backlog description with that path;
   - write down anything learned about the failure in this file.
4. Do not retry a provider that returned a quota/credit/expiry error in the same session more than once; those do not clear within minutes.

## Recovery after tokens return

A timed-out or failed run's worktree is deleted, so recover from the saved patch:

```sh
git -C <repo> fetch origin
git worktree add -b <branch> /tmp/<dir> origin/main
git apply --3way --whitespace=nowarn <artifact>/worktree-diffs/<runId>/task-0-delegate.patch
```

Then tell the recovering agent to **commit and push immediately** before verifying, and to keep pushing small verified commits — the delegate wall clock is 30 minutes and is not raised by `options.timeoutMs`.
