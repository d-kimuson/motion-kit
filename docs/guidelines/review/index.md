# Review

The single source of truth for reviewing a change. Internal reviews (`docs/guidelines/delegate.md`) and AI review tools follow it; tool-facing files hold only a reference to this file.

## Common

- The target (PR, branch, commit range, working tree) and the output format (PR comments, a report, ...) follow the caller.
- Before raising a finding, read the surrounding code and documents and confirm it is a real problem.
- Do not raise what lint, type checking, or tests enforce; those are checked mechanically.
- For each finding, give the location and either the problem it causes or the rule it breaks.
- Findings that model untrusted input are out of scope only where a context's Trust model excludes it: `docs/contexts/render/CONTEXT.md` (Trust model) treats project config and plugins as trusted Node code and implements no untrusted mode, so a hostile plugin, config, or Composition is one that model would have to exclude. A defect in trusted code that uses a public hook — a plugin's `configResolved` or `configEnvironment` rewriting alias or dedupe — is a defect to raise.

## Precedence

Text can disagree; the newer wins: (a) the product owner decision recorded on the task, (b) accepted ADRs and Design Docs, (c) `docs/tmp/design.md`, (d) everything else. A product owner decision newer than an accepted document supersedes it.

- At (a) a marker is a section or a paragraph of the task description whose label names the product owner (`## Product owner ...`, or a paragraph starting `Product owner ...:`, as in `Product owner note:` or `Product owner decision (2026-10-24):`), or a line that starts with `DECIDED:`, the form `docs/guidelines/team-channel.md` writes in place of a waiting paragraph. A `DECIDED:` inside a labelled product-owner paragraph belongs to that marker; requirement prose that only quotes `DECIDED:` without an owner label is not a marker.
- The newest marker is the one to follow. A marker that carries a `YYYY-MM-DD` date of its own beats one that carries none; between markers with the same date, and between markers with none, the later one in the description wins. When the date and the position point at markers that contradict each other, the date decides the text, and the contradiction itself is a question for the product owner, not a guess.
- Check the task at (a) before raising a finding that would revert behavior the product owner scoped — every finding, not only one that cites a document: a finding worded as a code defect ("check the plugin bindings", "validate the nested keys") can rest on a sentence of an accepted ADR or a Design Doc, at (b), so find what requires that behavior before classifying it.
- When a marker supersedes that requirement, the finding is "the document needs amending", not "the code must change": raise that, and do not widen the change for it. When the document already carries the amendment, no requirement is left and no finding is raised. `docs/tmp/design.md` is gitignored and absent from a worktree (`AGENTS.md`), so at (c) check the task instead and say the file was unavailable.
- The implementer's side and the round rule are in `docs/guidelines/auto-pilot.md` (Precedence when documents disagree); the reviewer prompt that carries the task key is in `docs/guidelines/delegate.md` (Definition of done); recording an amendment is in `docs/guidelines/writing/adr.md` and `docs/guidelines/writing/design-doc.md`.

## Patterns

Pick the patterns that apply from the content of the change.

| Pattern                       | When                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `Code Review`                 | Code changed. Not for documentation-only changes                                |
| `Guideline Review`            | Always                                                                          |
| `Docs Review`                 | Documentation (`docs/`, `AGENTS.md`, skills, troubleshots) changed              |
| `Quality Assurance`           | Product behavior changed                                                        |
| `Seekability and Determinism` | `src/core`, `src/motion`, `src/render`, or any code that evaluates time changed |
| `Public API`                  | Exports, component props, or Zod schemas changed                                |
| `Spec`                        | A `.lean` file or an `*.oracle.test.ts` changed                                 |
| `Dependencies`                | `dependencies` or `devDependencies` in `package.json` changed                   |

### Code Review

Defects in the change itself: wrong behavior, missed boundaries, missing error handling, ordering or concurrency problems, security problems, mixed responsibilities and other design problems. Guideline compliance belongs to `Guideline Review`.

### Guideline Review

1. From the References table in AGENTS.md, pick every guideline whose "When to read" matches the change.
2. Read each picked guideline in full.
3. Raise the places where the change breaks a guideline. `docs/guidelines/writing/` belongs to `Docs Review`.

### Docs Review

1. Read `docs/guidelines/writing/index.md` in full.
2. For each changed document, read the guide for its document type (`docs/guidelines/writing/`). A document no guide covers is reviewed with `index.md` alone.
3. Read each changed document in full, not only the diff. Whether it has one line of argument and avoids repetition is decided by the whole.
4. Raise each violation, quoting the sentence and the rule it breaks.

### Quality Assurance

1. Read `docs/guidelines/quality-assurance/index.md` and the guides under `docs/guidelines/quality-assurance/` that the AGENTS.md References table maps to the change.
2. Run the change by the guide's steps and report in the guide's format.
3. If no guide applies, report that and stop.

### Seekability and Determinism

Every frame must be a pure function of time (`docs/contexts/core/CONTEXT.md`). Look for:

- State carried between frames: refs, closures, or module-level variables that make a frame depend on the previously rendered one; `useEffect` or `useState` driving a value that should come from time.
- Order dependence: a result that differs between sequential rendering and a random seek. Compare the two mentally for the changed component; ask for the determinism test when unsure.
- Rounding or time conversion done outside the Time Module (`src/core`): float arithmetic on frames, hand-written fps math, `Math.round` on timeline time.
- Seekability Tier claims (A/B/C) without a test or a documented reason, and components that silently fall from Tier A.

### Public API

The surface consumers see (`exports` in `package.json`, component props, Zod schemas, CLI input and output). Look for:

- Prop naming that departs from the shared vocabulary (`delay`, `duration`, `easing`, `from`, `to`) or from the terms in the context's `CONTEXT.md`.
- Code reachable from the wrong subpath: Three.js from anything but `/three`, Node.js APIs from anything but `src/render` and `src/cli`.
- A public export without types and tests, or a Zod schema that is not the single source of the type.
- Wrapper components that inject styles or restrict the wrapped library's expression; motion-kit owns time and values, not rendering.

### Spec

A Lean spec is trusted only if its doc comments, theorems, and differential test agree (`docs/guidelines/quality-assurance/lean-spec.md`). Look for:

- A doc comment that says something other than what the declaration states, or a theorem whose doc describes the proof instead of the claim.
- Rules from the requirement and boundaries (exact thresholds, zero, empty, upper limits) that have no theorem.
- A differential test whose generators step outside the Lean types and constraints, or do not aim at the boundaries the theorems name.
- JSON conversion between Lean and the implementation leaking out of the test into the implementation.

### Dependencies

A new or changed dependency affects consumers (`docs/guidelines/local-dev.md`). Look for:

- A dependency placed in `dependencies` that only one optional subpath (`/three`, rendering) needs; it belongs to `peerDependencies` or `optionalDependencies`, or the import belongs behind the subpath.
- Browser bundle impact of a dependency reachable from the root, `/motion`, `/theme`, or `/presets` exports.
- License concerns the allowlist cannot see: copyleft in a transitive dependency's optional parts, or external binaries (FFmpeg builds with GPL components) the code invokes.
