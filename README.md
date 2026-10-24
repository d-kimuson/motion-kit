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

## CLI

The `motion-kit` bin renders Compositions from a registry entry file. Both commands
accept `--json`, which writes exactly one [versioned envelope](docs/contexts/agent/adr/20261024-cli-output-contract.accepted.md)
to stdout; without it, the same data is printed as a short human summary.

```bash
# Capture one frame as a PNG.
motion-kit frame <entry> [--composition <id>] --frame <n> --out <png>

# Render a whole Composition.
motion-kit render <entry> [--composition <id>] --out <dir> [--props <json>] [--json]
```

`--composition` may be omitted only when the registry exports exactly one
Composition; otherwise the command fails with `cli.invalid-arguments` naming the
available ids.

Encoding is not implemented yet (TASK-150/159), so `render` produces a directory of
PNG frames plus a `manifest.json` and reports `"format": "frames"` in `data` — never a
fake MP4.

Exit codes: `0` success, `1` domain failure (e.g. invalid props), `2` invocation error
(e.g. missing entry or unknown id), `3` unexpected internal error. Failures are always
Diagnostics in the envelope.

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
