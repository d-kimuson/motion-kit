# Design Doc

A Design Doc describes how a non-trivial piece of work will be built before it is built, so the design can be reviewed independently of the code. Write one when a change touches more than one context, introduces a new public API, or implements a spike's conclusion.

## Location

- Cross-context: `docs/design-doc/YYYYMMDD-<name>.md`.
- One context: `docs/contexts/<context>/design-doc/YYYYMMDD-<name>.md`.

When the work is done, the Design Doc stays as the record of why the code looks the way it does; decisions it contains that must outlive it become ADRs (`docs/guidelines/writing/adr.md`).

## Template

```markdown
# <Name of the work>

## Goal

<What the work achieves, and how it will be verified.>

## Non-Goals

- <What is explicitly out of scope>

## Design

<The structure: types and contracts first, then the behavior. Diagrams and code signatures where they say it faster than prose.>

## Alternatives

- <Alternative>: <why it was not chosen>
```
