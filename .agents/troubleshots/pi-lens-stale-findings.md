# pi-lens keeps reporting diagnostics that are already fixed

## Symptom

During a session, pi-lens reports the same blocking findings after the code has been changed to fix them, and keeps reporting them for line numbers whose content no longer matches the message. Seen in this repository:

```text
No overload matches this call.   # for useAsset({ kind: 'font-family' })
'controller' is declared but its value is never read.   # src/core/assets/registry.ts
```

Both were fixed, yet the findings persisted. At the same time the real checks are clean:

```sh
pnpm exec tsc -p . --noEmit; echo "exit=$?"
# exit=0
```

and a fresh lens probe over the same files returns nothing:

```jsonc
lens_diagnostics({ "source": "lsp", "scope": "paths", "paths": ["src/core/assets/registry.ts", "<other changed paths>"] })
// -> 0 diagnostics
```

## Workaround

Treat a repeated finding as stale once the fix is applied and nothing changed since. Before acting on it, confirm with the whole TypeScript program and a fresh probe over exactly the changed paths:

```sh
pnpm exec tsc -p . --noEmit
```

```jsonc
lens_diagnostics({ "source": "lsp", "scope": "paths", "paths": ["src/core/assets/registry.ts", "<other changed paths>"] })
```

Act only on what that fresh probe reports. If it returns 0 diagnostics and `tsc` exits 0, ignore the cached findings and continue.

## Why Not Fixed

pi-lens serves findings from its own diagnostic cache, which is not invalidated reliably when a file is edited (or when the error disappears because a type now resolves). The repository's typecheck and lint are not involved: they are accurate throughout, which is why the workaround compares against `pnpm exec tsc -p . --noEmit` and a source=lsp probe rather than trusting the cached list. Fixing it means fixing pi-lens' cache invalidation, which is outside this repository.
