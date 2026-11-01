# Coding

Principles that apply to all code. Rules enforced statically by lint and types are not written here; they are kept by fixing what the checks report.

## Principles

- Time is an input. A frame is a pure function of its time: no wall clock, no animation frame callbacks, no randomness without a seed, no state carried from the previous frame. Conversions between frames and time, and rounding, happen only in the Time Module (`src/core`); do not round early elsewhere.
- Dependencies point toward `core`. Each context imports only what `docs/CONTEXT-MAP.md` lists for it; lint enforces the Three.js, Node.js, and cycle boundaries, the rest is kept by review.
- Schema first. Props the outside world supplies (presets, CLI input) are defined once as a Zod schema that is the source of the type. Validate at the boundary (preset entry, CLI), never inside the render path.
- motion-kit owns time and values; rendering libraries (React, Three.js, motion) own expression. Do not wrap a library in a thin component that only renames its API or injects styles, and do not restrict what it can express.
- Separate concerns and separate state from logic. Contracts (public types, schemas, the Time Module's API) are written as algebraic data types (discriminated unions) and kept stable; implementations behind them are regenerable.
- Every public export has types and tests, and is reachable only through the `exports` map in `package.json`.
- Prefer a mature library over writing the same thing (see Libraries). When a library's behavior forces a departure from the design, record it as an ADR.

## Failures and exceptions

- Recoverable failures (invalid composition, a preset that does not fit a theme, an asset that cannot become ready, a CLI input that fails validation) are returned as a `Result` discriminated union with a `Diagnostic` payload defined by [`DiagnosticSchema`](../../../src/lib/diagnostic.ts) and the [accepted CLI output contract](../../contexts/agent/adr/20261024-cli-output-contract.accepted.md). The `Result` type lives in `src/lib/result.ts`; create it with its first use, without a library. Callers branch on it; they do not throw it.
- Exceptions are for programmer errors and contract violations only (a hook used outside its provider, an impossible state). Do not catch them to continue.
- External exceptions (Playwright, FFmpeg, the file system) are converted to `Result` at the boundary where they occur, in `src/render` and `src/cli`. Nothing above those boundaries sees a raw exception.

## Libraries

Each purpose has one library. Do not write a function that duplicates one.

| Purpose                                     | Library                                                              | Where                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Schemas and validation                      | zod                                                                  | Preset props, theme definitions, CLI input (add when first needed)                                   |
| Property-based tests                        | fast-check                                                           | `*.test.ts`, `*.oracle.test.ts`                                                                      |
| Unit tests                                  | vitest                                                               | `*.test.ts`                                                                                          |
| Spring and value interpolation inside React | motion                                                               | `src/motion/integration` (add when first needed; whether its values are seekable is a Phase 0 spike) |
| 3D                                          | three, @react-three/fiber, @react-three/drei                         | `src/three` only (add when first needed)                                                             |
| Browser capture                             | playwright                                                           | `src/render/browser` (add when first needed)                                                         |
| Encoding                                    | FFmpeg through a Node wrapper                                        | `src/render/encoding` (add when first needed; Mediabunny later)                                      |
| Preview UI components and styling           | shadcn/ui on Base UI, Tailwind, lucide-react, react-resizable-panels | `src/preview` only, bundled into `dist/preview.js` as devDependencies                                |
