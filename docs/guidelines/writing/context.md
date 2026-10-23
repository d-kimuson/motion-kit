# Context documents

The bounded contexts and their terms. `docs/CONTEXT-MAP.md` lists the contexts, their responsibilities, and the dependencies between them; `docs/contexts/<context>/CONTEXT.md` holds each context's terms and invariants, with `adr/`, `design-doc/`, and `knowledge/` beside it.

## CONTEXT-MAP.md

A table of contexts (`Context | Responsibility | Implementation`) and a `## Relations` section that says which context depends on which and what crosses the boundary. Update it when a context is added, split, or its dependency changes; the lint boundaries in `oxlint.config.ts` follow it.

## CONTEXT.md

```markdown
# <Context>

<One paragraph: what this context is responsible for and what it is not.>

## Ubiquitous Language

| Term   | Code           | Definition                                             |
| ------ | -------------- | ------------------------------------------------------ |
| <Term> | `<identifier>` | <One sentence. What it is, not how it is implemented.> |

## Invariants

- <A rule that always holds in this context, stated so that a test or review can check it.>
```

- A term enters the table when it appears in a public API, a document, or a conversation with the user. Its `Code` column is the identifier in `src/`; keep them identical.
- An invariant is a property, not a plan. When one is proved in Lean, name the theorem.

## knowledge/

Facts learned about the context that are not decisions (a library's behavior found in a spike, a measurement, a browser quirk). One file per topic, `knowledge/<topic>.md`, stating the fact, how it was confirmed, and the date.
