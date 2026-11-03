# Compose a Contact Sheet in a Chromium page and take one screenshot of it

## Context

A coding agent can capture single frames (`motion-kit frame`) and a whole video (`render`), but it
has no way to read the pacing of a Composition without opening one image per frame, and a full
render is minutes of work for a question about composition. What is missing is one image holding a
sample of the whole timeline — every nth frame, plus the end — which sits between "look at one PNG"
and "watch the MP4" and lets an agent judge pacing and per-scene layout from an image it can read.
`contact-sheet` is already the agent context's term for exactly that artifact.

The pieces exist: `frame` captures one or more frames ascending through one renderer, the CLI maps
its writes to `render.output-unwritable`, `--from`/`--to` resolve a half-open Global Frame range
from the Time Module, and the descriptor carries the frame count the props resolved to. What is not
decided is how the tiles become one image, and how the tiles are chosen.

Determinism is the constraint that decides the first question: the same input has to produce the
same bytes. The repository compares PNG bytes across runs and across capture histories, so a sheet
whose bytes move between two runs would be unusable as evidence.

## Decision

### Compositing: one Chromium page, one screenshot

`contact-sheet` lays the captured tiles out in a CSS grid on a page it builds itself, then takes one
screenshot of that page (`composeContactSheet` in `src/render/contact-sheet/compose.ts`). The page is
a static document — no clock, no animation, no randomness, no network — whose every dimension comes
from a pure layout function, so two runs of the same argv render the same document and Chromium
encodes the same bytes. The tiles are the byte-identical PNGs the renderer captured.

The compositing browser is the command's own, launched after the captures and torn down whatever the
outcome; the capture renderer's realm belongs to the Composition, and the sheet is not part of it.
`--software-webgl` and `--disable-sandbox` are passed to it, so a container that needs them gets the
same treatment for both browsers.

### Frame selection

`--every <n>` walks the region from its first frame in steps of `n` and always ends on the region's
last frame (`endFrame - 1`), so the sheet shows where the video starts and where it finishes. The
last frame is not repeated when the walk already landed on it. `--frame <n>[,<n>...]` is a set: the CLI
sorts it ascending and a repeated frame is refused. Exactly one of the two is required: `--every` with `--frame` is
`cli.invalid-arguments`, as is neither.

`--from`/`--to` bound the region with `resolveFrameRange`, the same function and the same notation
`render` uses, so both commands name the same interval for the same words. An explicit `--frame`
outside the Composition is `composition.props-invalid` (`location.frame`), the finding `frame` and
`check` already report for it; one inside the Composition but outside the written region is
`cli.invalid-arguments`, because the caller's own two options disagree.

### Grid geometry

`src/render/contact-sheet/layout.ts` is a pure function of the tile count, the Composition's aspect
ratio and two options: `--tile-width <px>` (default 320) and `--columns <n>` (default 4, capped at
the tile count so no cell is empty). Each tile keeps the Composition's aspect ratio, and the gutters,
the outer padding and the label strip scale with the tile, so one sheet looks the same at any tile
width. Every tile carries its frame number and its Presentation Time underneath it, in a monospaced
label: that is what makes a tile identifiable without a second document.

Three caps keep one screenshot rasterisable and affordable: 64 tiles, 16384 pixels on either side
of the sheet (Chromium's own capture limit) and 32 million pixels in total (the raster budget, so a
sheet that is legal per side cannot still ask for a gigabyte of pixels). All three are
`cli.invalid-arguments`, decided once the descriptor is known and before a frame is captured, and
each hint names the option that fixes it (`--every`, `--tile-width`, `--columns`, `--from`/`--to`);
the `--frame` path is told to name fewer frames, because the CLI forbids combining it with `--every`.
The per-side number is Chromium's documented limit; the total is a bound this command keeps, and
`compose.test.ts` renders a 2 MP sheet to prove the screenshot path is not exercised only at the
small fixture.

### Output and refusals

`--out` must be a `.png` path — a sheet is one file, never a directory — and the extension is
checked with the rest of argv, before a renderer opens. The output path is touched as late as the
write allows: once the image exists, the command creates the parent directory and writes the PNG,
so a refused invocation, a failed capture and a cancellation all leave the file system as they
found it — no directory and no partial sheet. A file system that refuses that directory or the write
is `render.output-unwritable` (exit 1, `location.file` and `details.output`/`details.code`), the code
the CLI's other writes already use.

## Consequences

- The artifact is exactly the bytes Chromium produces for this document on this machine. Two runs
  agree; a different Chromium build may differ in the last bit of a glyph's antialiasing, which is
  also true of every frame `render` captures, and nothing in this product promises byte identity
  across environments.
- The sheet costs one capture per tile and one extra browser launch. 64 tiles is the ceiling, so a
  long video is an overview (`--every 150`), not a storyboard; a closer look is `--from`/`--to` on a
  section, or `frame` for one still.
- No dependency is added: the compositing uses the Playwright Chromium the renderer already
  requires, and the document is a string.
- The envelope gains `command: "contact-sheet"` and `ContactSheetDataSchema`
  ([CLI output contract](20261024-cli-output-contract.accepted.md)), `schemaVersion` stays `1`, and
  no Diagnostic code is added.

## Alternatives

- **FFmpeg's `tile`/`xstack` filters**: rejected as the default. It adds a second required external
  binary to a command that otherwise needs only Chromium (the MP4 route needs FFmpeg, the sheet does
  not), the filter graph would have to be built and kept in step with the label layout, and its PNG
  encoder's bytes differ between FFmpeg builds, so the sheet would be less stable than the frames it
  is made of.
- **Compositing in Node.js** (decode every tile, paste pixels, encode PNG): rejected because the
  tiles carry frame labels. Text needs a rasteriser and a font file, which is a new dependency and a
  new cross-machine variable, and it would duplicate an encoder the project does not have. Pure
  nearest-neighbour pasting alone would trade readable labels for bytes nothing else in the product
  promises.
- **Screenshotting the Composition's own page after injecting the grid**: rejected because the
  page is the Composition's — its runtime keeps repainting it, and a sheet that depends on when the
  injection happened is the state-carrying capture the determinism rules forbid.
- **A directory of tiles plus a separate stitching step**: rejected because reading N images is the
  problem the command exists to solve.
