# Spike A: Motion seekability

Run `pnpm spike:motion` to compare sequential, random/repeated, and isolated frame captures in real Chromium. This is an experiment, not shipped code or a public integration API. Findings and limits are in the [report](../../docs/contexts/motion/knowledge/spike-a-seekability.md); the historical integration proposal is a [superseded ADR](../../docs/contexts/motion/adr/20261023-explicit-motion-seeking.superseded.md).

## Run

From the repository root, with the Node/pnpm versions in `.node-version` and `package.json`:

```sh
pnpm install --frozen-lockfile --ignore-scripts --config.strictDepBuilds=false
pnpm exec playwright install chromium
pnpm spike:motion
```

On Linux, provision Playwright's OS libraries with `pnpm exec playwright install --with-deps chromium` instead (may require sudo). Chromium must be Playwright's pinned build, not a system Chrome. No FFmpeg, external assets, network services, or API keys are used during the test.

The install override is a local workaround for pnpm 12 rejecting the existing unapproved `lefthook` build even with `--ignore-scripts`; it does not approve or execute dependency scripts. If `node_modules` is a symlink to another checkout, unlink that symlink first so installation remains local to this worktree.

For a single feature:

```sh
pnpm spike:motion -t 'animate-dom:'
```

Each test prints JSON measurements (frame order, match counts, stale immediate reads, sample DOM values, native animation state, or a negative-control counterexample). PNGs are compared exactly in memory, not against OS-dependent checked-in golden images. A mismatch fails the command. No generated output needs committing.

## Method

- `fixture.tsx`: a 40×40 blue square on a fixed 300×80 white crop; explicit values, paused controls, a freshly sampled spring, and four uncontrolled counterexamples.
- `seekability.browser.test.ts`: evaluate every frame 0–60 at 30 fps; capture frames `[0,1,7,15,29,30,31,45,59,60]`; compare a seeded random permutation plus repeated/reverse seeks and a fresh React root for each selected frame. Compare computed styles/geometry and exact PNG bytes. Also hold time at 0.5 s for three render acknowledgements and capture again.
- `vitest.config.ts`: a separate Vitest Browser Mode setup using Playwright Chromium. The normal root test configuration does not include this directory.

The `frame / 30` conversion is a fixture input, not a replacement Time Module. The browser clock remains real; it services Motion's render queue but does not determine the controlled animation values. The negative controls intentionally use that uncontrolled clock. They compare frames 0–30 followed by capture at 1 s with a fresh mount directly at 1 s; mismatches are the expected result.

The completion check is `flushSync` for React changes, followed by Motion's public `frame.postRender` acknowledgement after setting each value/time. Read the report before reusing it: this is not an asset, GPU, layout, or universal animation completion barrier.

## Test placement

This runs **separately from `pnpm test`**. The final measured full suite took 29.38 s locally (10 tests, 218 PNG captures), already near the task's ~30 s CI ceiling. Linux is qualified: 5/5 runs passed on `ubuntu-latest` in 29.48–30.06 s ([record](../../docs/contexts/render/knowledge/20261031-linux-spike-qualification.md)). It still runs outside the CI gates ([ADR](../../docs/decisions/20261031-spike-suites-stay-out-of-ci.accepted.md)). Lint/typecheck still cover all spike TypeScript, and the package's `files` allowlist excludes the spike.

The seven packages listed in the report are pinned devDependencies; see the report for versions/licenses. React peerDependency promotion remains TASK-149.
