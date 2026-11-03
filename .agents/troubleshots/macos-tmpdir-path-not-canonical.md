# On macOS a temp path is `/var/folders/...` in the test but `/private/var/folders/...` from the CLI

## Symptom

A test that compares a path reported by a child CLI against the path it created itself fails only on macOS (Darwin, Node 26):

```ts
const root = mkdtempSync(join(tmpdir(), 'motion-kit-audio-export-'));
// assertion: cli-reported path === join(root, 'audio.wav')
// Expected: /var/folders/xx/…/T/motion-kit-audio-export-abc123/audio.wav
// Received: /private/var/folders/xx/…/T/motion-kit-audio-export-abc123/audio.wav
```

`tmpdir()` returns the symlinked `/var/folders/...` form, while the child process (Vite, Playwright, `process.cwd()`, `realpath` inside the CLI) reports the resolved `/private/var/folders/...` form. The two strings differ although they name the same file.

## Workaround

Canonicalize the test's expectation before comparing, i.e. build expected paths from `realpathSync(root)` rather than from `root`:

```ts
import { mkdtempSync, realpathSync } from 'node:fs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'motion-kit-audio-export-')));
```

Canonicalizing at the assertion works too, and keeps the `beforeEach` unchanged:

```ts
const missing = join(realpathSync(projectRoot), 'audio', 'absent.wav');
```

`src/cli/cli.test.ts` and `src/render/loading/preview-session.test.ts` already do one of the two. Do not loosen the assertion to a suffix or `includes` match: it hides real path bugs. Mac-only failures on absolute paths should be suspected of this before anything else.

## Why Not Fixed

`/var` is a symlink to `/private/var` on macOS, and the kernel plus each process's notion of its own paths decide which form surfaces; Node's `tmpdir()` reads `TMPDIR`, which is the uncanonicalized form. A repository-side fix would mean canonicalizing every path that crosses a process boundary, which would change the reported paths users see for no functional gain; the platform difference is tolerated instead. Linux and Windows have no equivalent (`tmpdir()` is already canonical there), so the tests stay correct without the extra call.
