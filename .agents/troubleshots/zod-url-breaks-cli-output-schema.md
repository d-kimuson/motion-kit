# `z.url()` in the CLI output schema breaks Ajv compilation

## Symptom

After a URL field in `src/agent/cli-output.ts` is declared with `z.url()`, every test that compiles `docs/contexts/agent/schema/cli-output.v1.schema.json` with Ajv fails at compile time:

```
Error: unknown format "uri" ignored in schema at path "#/..."
```

## Workaround

Declare URLs and paths in the CLI envelope as plain `z.string()` (optionally `.min(1)`), as the existing fields do. Regenerate the JSON schema from the Zod schema; do not hand-edit it.

## Why Not Fixed

Zod emits `format: "uri"` for `z.url()`. The repository's `Ajv2020` instance does not load `ajv-formats`, so strict mode rejects the unknown format. Fixing it means adding `ajv-formats` (a dependency, `docs/guidelines/local-dev.md`) to every Ajv instance in the tests and to the consumers the published schema is meant for, which the contract does not require. Delete this troubleshot if the formats plugin is adopted.
