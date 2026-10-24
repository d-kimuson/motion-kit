# Vite error messages change with color support

## Symptom

A Vite diagnostic test passes locally and fails on GitHub Actions with a less specific
Diagnostic than asserted. The text the loader matches on is wrapped in ANSI SGR codes:

```
+     "message": "Loading configuration failed.",
-     "message": "Loading configuration failed for \"configuration\" with bundled Vite 7.3.7.",
```

`\u001b[31m` precedes the first word of Vite's message (for example Vite's
`Error during dependency optimization:\n\n` banner) whenever picocolors decides the
stream supports color.

## Workaround

Reproduce the CI text locally by running the same command with `CI=true` or
`FORCE_COLOR=1`; the child process inherits the environment, so Vite inside it colorizes.

```sh
CI=true pnpm vitest run --project loading src/render/loading/loading.test.ts
```

Match Vite's message with `includes` rather than `startsWith`, and never compare the whole
message for equality.

## Why Not Fixed

Vite bundles picocolors in `dist/node/chunks/logger.js` and enables color when
`NO_COLOR` is absent and any of `FORCE_COLOR`, `--color`, Windows, a TTY, or `CI` is set.
GitHub Actions sets `CI`, so the same Vite build produces different message text per
environment. The loading child inherits the caller's environment on purpose (it runs the
project's config), so the loader cannot normalize it without changing what the project
sees; matching the unstyled substring is the durable rule.
