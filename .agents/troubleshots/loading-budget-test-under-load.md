# A loading budget test fails while the machine is busy

## Symptom

A full-suite run beside another heavy `pnpm dev` task fails one test:

```sh
DIRENV_DISABLE=1 pnpm test
```

```text
Test Files  1 failed | 87 passed (88)
Tests       1 failed | 1087 passed (1088)

FAIL |loading| src/render/loading/loading.test.ts > supervised loading session > restarts individual defaults and later props budgets, kills a blocked later parse, and never keeps the poisoned realm
src/render/loading/loading.test.ts:376:24
```

The failing assertion is `expect(result.ok).toBe(true);` for `open(root, 3000)`, and that file took 100095 ms for 44 tests. Re-running the same file in isolation passes, and an earlier full-suite run of the same code passed all 1088 tests:

```sh
pnpm vitest run --project loading src/render/loading/loading.test.ts -t "restarts individual defaults"
```

## Workaround

Re-run that file in isolation before investigating:

```sh
pnpm vitest run --project loading src/render/loading/loading.test.ts
```

A pass in isolation on a code path that does not touch `src/render/loading` means the machine was saturated, not a regression. Treat it as a real defect only when it fails at the same assertion on an idle machine.

## Why Not Fixed

The fixture's `entry.tsx` awaits 1600 ms per props parse while the test asserts that a 3000 ms budget succeeds, so a saturated machine's module transform and browser start can consume the budget before the parse finishes. The real fix times only the parse, or gives the budget margin over the fixture's delays; that changes what the test measures, so it is out of scope here.
