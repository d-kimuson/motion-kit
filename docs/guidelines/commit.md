# Commit

## Message

- Conventional Commits: `<type>(<scope>)?: <summary>`, with `<type>` one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`. The scope, when used, is a context name from `docs/CONTEXT-MAP.md` (`core`, `motion`, `theme`, `three`, `presets`, `render`, `agent`).
- The summary is English, imperative, lower-case, without a trailing period. The body, when needed, says why.
- Good: `chore: pin node 26 devshell and install gitleaks`
- Bad: `Fixed the timeline bug.`

## Boy scout

Right before committing, look back at the trouble met during the work and feed it back into the harness. It is not the main line of work, so delegate it to a SubAgent.

Hand over:

- The list of trouble met during the work (failed commands with their errors, wrong or missing documentation, detours in investigation). If there was none, skip the boy scout step.
- The criteria below.

Criteria:

- **Fix on the spot**: a problem on the harness side (guideline, lint, script, configuration) whose fix involves no judgment call (a factual error, missing information, an obvious bug). Commit it separately from the main change.
- **Write a troubleshot**: a fix that needs a decision, or an external tool's behavior the harness has to tolerate and only needs a workaround. Write `.agents/troubleshots/<topic>.md` in the format of `docs/guidelines/writing/troubleshoot.md`.

Have the SubAgent return the list of what it fixed and wrote, and include it in the report to the user.
