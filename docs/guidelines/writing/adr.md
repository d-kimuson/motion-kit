# ADR

An Architecture Decision Record captures a decision that is hard to reverse or that later work must respect: a departure from `docs/tmp/design.md`, a Phase 0 spike conclusion that becomes a rule, a library choice, a boundary between contexts.

## Location and status

- Cross-context: `docs/decisions/YYYYMMDD-<name>.<status>.md`.
- One context: `docs/contexts/<context>/adr/YYYYMMDD-<name>.<status>.md`.
- `<status>` is one of `proposed`, `accepted`, `rejected`, `deprecated`, `superseded`. Change the status by renaming the file; a superseded ADR links to its successor in `Consequences`.
- Amend an accepted ADR in place, with an `_Amended <date> (<task key>):_` sentence at the changed paragraph saying what it supersedes and what supersedes it (for example `_Amended 2026-10-25 (TASK-159):_`). The task key is required for a new amendment; the ones written before this rule carry only a date, or a note such as `(review)`.
- An amendment changes neither the status nor the file name: the rename in the line above is for an ADR a successor replaces (`docs/guidelines/auto-pilot.md`, Precedence when documents disagree).

## Template

```markdown
# <Decision as a sentence>

## Context

<The situation and the forces: what made a decision necessary, what constrains it.>

## Decision

<What was decided, in the present tense.>

## Consequences

<What becomes easier, what becomes harder, what must be done as a result.>

## Alternatives

- <Alternative>: <why it was not chosen>
```
