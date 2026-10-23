# Quality Assurance

How to run a QA Check that verifies a change by executing it, and the map of defects to the methods that catch them, which the check's focus comes from.

## Defects and methods

| Defect                                                                                        | Types | oxlint | Unit (vitest) | PBT (fast-check) | Lean spec | License check | gitleaks |
| --------------------------------------------------------------------------------------------- | ----- | ------ | ------------- | ---------------- | --------- | ------------- | -------- |
| Time arithmetic errors (frame/time conversion, rational fps rounding, sequence bounds)        | —     | —      | ○             | ◎                | ◎         | —             | —        |
| Non-determinism (wall clock, animation frame, randomness, state between frames)               | —     | ◎      | —             | ○                | —         | —             | —        |
| Dependency boundary violation (Three.js outside `/three`, Node.js outside render/cli, cycles) | —     | ◎      | —             | —                | —         | —             | —        |
| Wrong motion values (interpolate, spring, keyframes, easing endpoints and monotonicity)       | —     | —      | ○             | ◎                | —         | —             | —        |
| Wrong theme resolution (priority props > nested > composition > default)                      | —     | —      | ◎             | —                | —         | —             | —        |
| Preset schema and type mismatch                                                               | ◎     | —      | ○             | —                | —         | —             | —        |
| Rendering and capture in a real browser (readiness, fonts, WebGL)                             | —     | —      | —             | —                | —         | —             | —        |
| Environment differences (Chromium build, FFmpeg build, GPU)                                   | —     | —      | —             | —                | —         | —             | —        |
| Public API drift (exports, prop names, subpath contents)                                      | ○     | —      | —             | —                | —         | —             | —        |
| Gaps in the spec, unexpected use cases                                                        | —     | —      | —             | —                | —         | —             | —        |
| Dependency with a disallowed license                                                          | —     | —      | —             | —                | —         | ◎             | —        |
| Committed secret                                                                              | —     | —      | —             | —                | —         | —             | ◎        |

◎ mainly caught by, ○ partly caught by, — not caught.

## Exploratory testing focus

In a QA Check, verify in particular whether the change touches the following.

- Changed a preset, theme, motion component, or anything under `src/render`: render representative frames (start, a transition overlap, the end) and look at the images.
- Changed `src/render` capture or anything that evaluates time: render the same frames sequentially and by random seek, and compare the outputs.
- Changed exports, props, or schemas: import the package the way a consumer would (root and each subpath) and check that the names and types are what the design names, and that `/three` does not reach the root.
- Always: gaps in the spec and unexpected inputs (empty compositions, zero-length sequences, a seek past the end, a theme without the requested token).

## QA Check

1. From the change summary and the diff, pick the features touched and the applicable items from the focus above.
2. Start the product by `docs/guidelines/quality-assurance/exploratory-testing.md` and verify the picked items by operating it.
3. Check whether the change meets a criterion in `docs/guidelines/quality-assurance/human-check-criteria.md`.
4. Report as below.

## Report

Write the following in the format of the destination (Markdown for a PR or issue; the requested format when returning to the caller).

- status: one of
  - `approve`: every picked item was verified and nothing is wrong.
  - `reject`: a behavior differs from what is expected.
  - `human-check`: nothing is wrong, but the change meets a criterion in `human-check-criteria.md`, or an item could not be verified.
- What was verified: the operations performed and the results observed, facts only, one operation per item.
- On `reject`: the behavior that differed, and the steps to reproduce it.
- On `human-check`: what a person should look at, and why the agent could not cover it.

## Reproducing a failure

- One test file: `pnpm vitest run src/path/to/file.test.ts`; one test: add `-t "<test name>"`.
- A property-based test prints `seed` and `path` on failure. Replay with `fc.assert(property, { seed: <seed>, path: "<path>", endOnFailure: true })` in that test, then remove the options.
- A differential test reports the counterexample (the input) and the two results. Ask the oracle by hand: `echo '{"fn":"<Name>","args":{...}}' | .lake/build/bin/spec-oracle`. If `.lake/build/bin/spec-oracle` is missing, run `lake build`.
