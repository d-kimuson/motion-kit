# Editor tsserver keeps reporting TS2307 for a new `tsconfig.json#paths` entry

## Symptom

After a subpath alias is added to `tsconfig.json#paths` (for example
`"@kimuson/motion-kit/motion": ["./src/motion/index.ts"]`), the editor's `typescript-language-server`
(tsserver 5.9.3) reports `error TS2307: Cannot find module '@kimuson/motion-kit/motion' or its
corresponding type declarations` on the importing file, followed by `TS18046`/`TS2571` (`'x' is of
type 'unknown'`) on every value derived from that import.

Both compilers resolve the same entry, so the error is the language server's alone:

```sh
pnpm exec tsc -p . --noEmit; echo $?                                # 0 (TypeScript 7.0.2)
/nix/store/...-typescript-5.9.3/bin/tsc -p . --noEmit; echo $?      # 0
pnpm exec tsc -p . --noEmit --traceResolution | grep -A7 "motion'"
# 'paths' option is specified, looking for a pattern to match module name
# matched pattern '@kimuson/motion-kit/motion'
# resolved to '/…/src/motion/index.ts'
```

Files whose specifier was already in `paths` stay clean, so only the newly added entry fails. Touching
`tsconfig.json` or re-saving the importing file does not clear it.

## Workaround

Run `pnpm typecheck` and trust it; it is what CI gates on. Restart the language server before trusting
its diagnostics for those files (in an editor, restart the TypeScript server; a fresh `tsserver` picks
the entry up). Keep the package-name import: do not switch to a relative path only to silence the stale
server.

## Why Not Fixed

The running `tsserver` keeps the `paths` snapshot its project loaded when it opened and does not reload
`tsconfig.json` after the file changes. Clearing it needs a server restart, which is outside the
repository's control; `pnpm exec tsc -p . --noEmit` is the authoritative check. Confirmed: a fresh
`tsserver` 5.9.3 started after the entry exists reports no `TS2307` for the same file.
