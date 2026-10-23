# Writing

Rules shared by every document (guidelines, ADRs, Design Docs, CONTEXT.md, troubleshots, code comments). Each document type has its own guide next to this file.

## Language

All documents and code comments are written in English. Keep the existing language of what is already written (some code comments are Japanese; do not translate them in passing).

## Principles

- Write for an agent that has no context beyond the document and the code. Say what to do, not how the document came to be.
- One document, one line of argument. Cut what the reader does not act on, and link instead of repeating what another document says.
- Lead with the conclusion. Headings name what is below; bullets carry parallel items; prose carries the argument.
- Prefer concrete over general: a command, a path, an example value, a Good/Bad pair.
- Use the ubiquitous language below. Introduce a term by adding it to the relevant `CONTEXT.md`, not by defining it inline.
- State what is decided and what is open. Do not write an undecided design as if it were decided.

## Ubiquitous language

Terms are defined once: cross-context terms in `docs/CONTEXT-MAP.md`, context-specific terms in `docs/contexts/<context>/CONTEXT.md`. Documents and code use the term and its code name exactly as defined there.

## Review

Documents are reviewed by the `Docs Review` pattern of `docs/guidelines/review/index.md`, which reads this file and the type guide.
