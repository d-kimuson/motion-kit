# Stale optional peer after replacing Vite 8 with Vite 7

## Symptom

`pnpm lint` reports `lightningcss@1.33.0: MPL-2.0` in the production closure even though Vite 7.3.7 only declares an optional Lightning CSS peer. `pnpm why lightningcss` shows it attached to Vite 7. Removing only `pnpm-lock.yaml` and running `pnpm install --ignore-scripts` reports `Lockfile is up to date, resolution step is skipped` and restores the stale peer.

## Workaround

For this dependency migration, back up the lockfile outside the checkout, remove the checkout's `node_modules` and `pnpm-lock.yaml`, then run `pnpm install --ignore-scripts`. Review the regenerated lockfile and rerun `pnpm lint`. Do not delete pnpm's shared store, copy another checkout's dependencies, or add a license exception. Restore hooks with `pnpm exec lefthook install` when needed.

## Why Not Fixed

pnpm 12.15.0 can restore the installed resolution from its virtual-store metadata when only the wanted lockfile is removed. The stale optional peer survives normal installation; a clean resolution removes it. Changing pnpm's resolver is outside the loading-session task.
