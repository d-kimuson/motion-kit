# Dead Code Removal

Remove unused code, files, and dependencies.

## Request

Ask an Independent Agent:

"Find and remove unused code, files, and dependencies. Get candidates with a tool suited to the language (knip for TypeScript), and before removing one, confirm that it has no dynamic reference, is not part of the public API, is not referenced from configuration, scripts, or HTML, and is not a script run directly. Find the candidates the tool does not see (functions that are not exported, references that exist only to silence a warning) by reading the code. Do not remove what you cannot confirm, or what a person has to decide on even when unused (what `docs/guidelines/quality-assurance/human-check-criteria.md` covers); return those as candidates with the reason. Fix until every command of the AGENTS.md Feedback Loop passes, and take it to the definition of done in `docs/guidelines/delegate.md`."

## Output

- The removal change (by the definition of done).
- The candidates that could not be confirmed, filed together as one task in the Backlog by `docs/guidelines/backlog.md`.
- The candidates a person decides on, filed one user task per candidate.
