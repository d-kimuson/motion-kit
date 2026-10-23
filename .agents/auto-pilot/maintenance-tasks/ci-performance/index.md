# CI Performance

Measure how long CI takes and make it faster.

## Request

Ask an Independent Agent:

"From the recent CI runs (`gh run list`, `gh run view --json jobs`), find the duration of each job and step and how it has changed. Fix what can be made faster without changing the result of the checks (caching, parallelization, removing duplicated or unneeded steps), and take it to the definition of done in `docs/guidelines/delegate.md`. Do not make changes that narrow what is checked (filtering runs by changed files, shrinking a version matrix, thinning out tests); return them as proposals with an estimate of the effect. Measure durations from CI runs; for a change whose effect does not reproduce locally (dependency caching and the like), state what it saves instead of a number measured locally. If the CI run history cannot be read, change nothing and say so. If a job always fails, return the cause of the failure, apart from speed."

## Output

- The change that makes CI faster (by the definition of done), with the durations before and after, or what it saves.
- The proposals that narrow what is checked, filed as user tasks by `docs/guidelines/backlog.md`.
- A job that always fails, filed in the Backlog by `docs/guidelines/backlog.md`.
- If the history could not be read, tell the user by `docs/guidelines/team-channel.md`.
