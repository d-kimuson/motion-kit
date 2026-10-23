# Dependency Update

Update the dependencies in one go.

## Request

Ask an Independent Agent:

"Update every dependency within its current major version. Even when the manifest pins a version, raise it to the latest of the same major version. Treat dependencies that have to move together (peer dependencies and the like) as a group. Do not update unused dependencies; return them as candidates. Fix until every command of the AGENTS.md Feedback Loop passes, and take it to the definition of done in `docs/guidelines/delegate.md`. Do not update a dependency that cannot be updated without a major version bump; for each such dependency (each group when they move together), return a summary of the breaking changes, the affected locations, and the known vulnerabilities the update fixes. When a non-major update required a code fix, also return the dependency and the fixed locations."

## Output

- The update change (by the definition of done). When code was fixed for an update, name the dependency and the locations in the commit message.
- Each major version update (each group when they move together), filed in the Backlog by `docs/guidelines/backlog.md` with the returned summary. When it fixes a known vulnerability, use its severity (the criteria in `docs/guidelines/auto-pilot.md`) as the priority.
- The candidate unused dependencies, appended to the dead-code-removal task in the Backlog, or filed as one when there is none.
