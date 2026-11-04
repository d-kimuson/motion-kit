# CI fails once in asset-readiness.test.ts and passes on rerun

## Symptom

The `check` workflow fails in the step "Run frame transport and PNG determinism tests" on a change that does not touch `src/render` (observed on a CLI-text PR and a docs-only PR):

```text
FAIL frame-transport src/render/capture/asset-readiness.test.ts > asset readiness barrier > publishes both failed assets when the error boundary throws
AssertionError: expected [ 'asset.load-failed' ] to deeply equal [ 'asset.load-failed', …(1) ]
```

## Workaround

If the PR does not change `src/render/capture` and this is the only failure, rerun the failed job without changing anything:

```sh
gh run rerun <run-id> --failed
```

If it fails again, or the PR touches the asset readiness barrier, treat it as a real failure.

## Why Not Fixed

A timing race between the second asset's failure being recorded and the error boundary settling the barrier; the loaded CI runner exposes it. Making the test (or the barrier) deterministic is TASK-310. Delete this troubleshot when TASK-310 is Done.
