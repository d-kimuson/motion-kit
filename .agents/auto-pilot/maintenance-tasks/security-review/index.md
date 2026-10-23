# Security Review

Read the code and look for security problems.

## Request

Ask a SubAgent:

"Review, from a security standpoint, the changes since the last run (the `security-review` commit in `.agents/auto-pilot/maintenance-tasks/last-run.json`; the whole repository when there is none) and the places they touch. For the whole repository, read from the attack surface (where input is accepted, authentication and authorization, secrets, file and outbound I/O). Cover both server and frontend code, and look for missing input validation, injection, path traversal, client-side attacks (XSS and the like), gaps in authentication and authorization, handling of secrets, and known vulnerabilities and unsafe use of dependencies. Where it can be confirmed, start the product locally by the steps of `docs/guidelines/quality-assurance/exploratory-testing.md` and confirm the reproduction. For each finding, return the location, the attack path, whether it was reproduced, the severity (the criteria in `docs/guidelines/auto-pilot.md`), and how to fix it. Do not copy the values of secrets; point only to where they are. Do not change code."

## Output

- In a public repository (`gh repo view --json visibility`; private when there is no remote), do not write findings in public issues. Make critical and medium findings GitHub draft security advisories and tell the user by `docs/guidelines/team-channel.md`. File minor findings in the Backlog by `docs/guidelines/backlog.md` (it is not public).
- In a private repository, file the findings in the Backlog by `docs/guidelines/backlog.md`, and also tell the user about critical ones by `docs/guidelines/team-channel.md`.
- When there are no findings, file nothing.
