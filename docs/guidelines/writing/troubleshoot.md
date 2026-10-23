# Troubleshoot

A troubleshot records a problem in the tooling or environment that cannot be fixed at its root now, so the next agent recognizes it and applies the workaround instead of re-investigating. Location: `.agents/troubleshots/<topic>.md`, one file per problem.

Do not write a troubleshot for something that can be fixed; fix it (`docs/guidelines/commit.md`, Boy scout). Delete the troubleshot when the root cause is fixed.

```markdown
# <Short name of the problem>

## Symptom

<The exact command and the error text, so it can be matched by search.>

## Workaround

<The steps that get past it.>

## Why Not Fixed

<What the root cause is, as far as known, and what would be needed to fix it.>
```
