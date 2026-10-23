# motion-kit

A type-safe toolkit for motion timing primitives.

## Installation

```bash
pnpm add motion-kit
```

## Usage

```ts
import { currentTimestamp } from 'motion-kit';

const startedAt = currentTimestamp();
```

## Clock boundary

Application code never reads the global `Date`; everything goes through the clock
boundary so time can be frozen in tests.

- `currentDate()` / `currentTimestamp()` — the current time
- `dateFromIsoString(value)` — a fixed date from an ISO 8601 string
- `setFixedDateForTest()` / `setClockForTest()` — freeze the clock in tests
- `systemClock` / `createFixedClock()` — explicit clock implementations
- `typedIncludes(array, value)` — `Array#includes` that narrows the value type

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

## Phase 0 spikes

These browser experiments are separate from `pnpm test`; each README records setup,
measurements, and limits.

- [Spike A: Motion seekability](spikes/a-motion/README.md) — `pnpm spike:motion`
- [Spike B: React Three Fiber seekability](spikes/b-r3f/README.md) — `pnpm spike:three` and `pnpm spike:three:flags`
- [Spike C: browser clock](spikes/c-clock/README.md) — `pnpm spike:clock`
- [Spike D: asset readiness](spikes/d-assets/README.md) — `pnpm spike:assets`

## License

MIT
