# `promo`

A 46-second silent promotion video for motion-kit itself, made with motion-kit. Eight scenes say what
the framework is: the product name, a scene written as a React component, the claim that every frame
is a pure function of time, a Three.js scene on the same clock, the render pipeline, the CLI an agent reads, the preview review loop that hands a comment on an element to a coding agent, and how to install it. It is
a showcase rather than one of the four reference targets: it adds no new axis, so it has a smoke test
but no determinism probe (see [Why there is no probe](#why-there-is-no-probe)).

## Compositions

| id         | Resolution | fps | Frames | Rendered by                          |
| ---------- | ---------- | --- | ------ | ------------------------------------ |
| `promo`    | 1920×1080  | 30  | 1371   | a local QA Check; eight stills in CI |
| `promo-ci` | 960×540    | 30  | 60     | `promo.smoke.test.ts` (CI)           |

- Both Compositions render the **same** `PromoScene` from a storyboard in `plan.ts`. `promo` uses
  `promoStoryboard` (eight scenes); `promo-ci` uses `promoCiStoryboard`, the opening scene, one handoff
  and the start of the code scene. Each `durationInFrames` is `storyboardFrames(board)`, so the
  declaration and the board cannot disagree.
- The scenes are drawn on a 1920×1080 design grid that `Stage` scales to the Composition's own size,
  so `promo-ci` is the same tree at half resolution.
- No props: every word on screen is a module constant in `copy.ts`.

## Files

| File                  | What it is                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `plan.ts`             | The storyboard: scene order, scene lengths, the overlap, and `placeScenes`                                                           |
| `copy.ts`             | Every word on screen, including the tokenised code and JSON the scenes type out                                                      |
| `look.ts`             | Colours, type stacks and the design grid                                                                                             |
| `motion.ts`           | `ease`, `pop` and `phase` over `/motion`'s `interpolate` and `spring`; `steps`, `revealed` and `hundredths`, counted in whole frames |
| `review.ts`           | The review scene's choreography as data: the mock preview's layout, the beats, the pointer path and the transcript timing            |
| `strip.ts`            | The 3D scene's layout as plain arithmetic: card positions, the playhead, card lifts and the camera pose                              |
| `parts.tsx`           | `Stage`, `useLocalFrame`, `Backdrop`, `SceneShell`, `Wipe`, `Heading`, `Window` and `CodeView`                                       |
| `scenes.tsx`          | Six of the scenes                                                                                                                    |
| `ThreeScene.tsx`      | The `three` scene: a strip of frame cards in a `ThreeCanvas`, a sweeping playhead and a `CameraRig`                                  |
| `ReviewScene.tsx`     | The `review` scene: a terminal starts the preview, a mock preview takes a comment on an element, and a coding agent fixes it         |
| `PromoScene.tsx`      | The storyboard laid out as a `TransitionSeries`                                                                                      |
| `entry.tsx`           | The `promo` and `promo-ci` registry                                                                                                  |
| `plan.test.ts`        | Property tests for the storyboard arithmetic                                                                                         |
| `review.test.ts`      | Property tests for the review choreography: beat order, clicks on their controls, the reload after the edit                          |
| `strip.test.ts`       | Property tests for the 3D layout arithmetic                                                                                          |
| `motion.test.ts`      | Unit tests for the motion helpers                                                                                                    |
| `promo.smoke.test.ts` | The CI smoke test (descriptors, the `promo-ci` MP4 and `ffprobe`, and one `promo` still per scene)                                   |

No `fetch-assets.ts`: this example has no media to generate or fetch.

## The storyboard

Eight scenes in one `TransitionSeries`, each named after its kind so the preview timeline labels them,
with a 12-frame (0.4 s) overlap between neighbours:

| Scene      | Frames | Starts at | What it shows                                                                                                                               |
| ---------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `intro`    | 120    | 0         | The mark pops in, the wordmark lands letter by letter, then the tagline and three tags                                                      |
| `code`     | 180    | 108       | An editor types a `useTime` + `interpolate` scene while a preview window plays the ball it describes                                        |
| `time`     | 180    | 276       | Eight thumbnails of one scene, captured out of order, then the eight determinism traversal modes                                            |
| `three`    | 180    | 444       | Nine frame cards of one clip in 3D; a playhead sweeps them, lifting each card, while the camera cranes                                      |
| `pipeline` | 150    | 612       | React/TSX → Chromium → FFmpeg → MP4, with packets on the links and a frame counter filling to 1371                                          |
| `agent`    | 180    | 750       | A terminal types `npx @kimuson/motion-kit render … --json`, a progress bar fills, and the JSON envelope appears                             |
| `review`   | 315    | 918       | `npx @kimuson/motion-kit preview` opens a mock preview; a comment on its title goes to a coding agent, and the preview reloads with the fix |
| `outro`    | 150    | 1221      | The mark and wordmark again, the tagline, the install command with a blinking caret, the repository                                         |

`TransitionSeries` keeps both neighbours mounted during an overlap and mounts a `Transition`'s
children only then. So each scene fades itself in and out over its own half of the handoff
(`SceneShell`), and the `Transition` only draws a gradient bar sweeping across the frame (`Wipe`).

## The expected look

A near-black ground (`#090b14`) with a violet-to-cyan accent (`#8b6cff` → `#2fe3d0`), amber for
numbers and pink for the terminal prompt. The review scene adds the preview's own comment-mode magenta (`#e12afb`) for the stage frame, the hovered element and the draft. The backdrop moves through the whole clip: two glows drift,
a dot grid slides diagonally, a timecode and frame counter tick in the top-right corner, and a
progress rule grows along the bottom edge.

## Running it

Every command runs from the repository root, because the CLI's `projectRoot` is `process.cwd()` and
React, ReactDOM and Zod resolve against it:

```bash
pnpm install
pnpm build                                   # the loading session resolves @kimuson/motion-kit to dist/
pnpm exec playwright install chromium        # once; the renderer launches Chromium
mkdir -p out                                 # gitignored, so a clean checkout has no out/

# Watch it in the browser (prints a URL; stop with Ctrl-C)
node dist/cli.js preview examples/promo/entry.tsx --composition promo

# The full promo (needs FFmpeg 6.0+ with libx264 on PATH for the .mp4 route)
node dist/cli.js render examples/promo/entry.tsx --composition promo --out out/promo.mp4 --json

# One still per scene
for frame in 60 170 340 520 678 818 1185 1301; do
  node dist/cli.js frame examples/promo/entry.tsx --composition promo --frame "$frame" --out out/promo-stills
done
```

`--composition` is always required: the entry holds two Compositions.

## The CI gate

```bash
pnpm test --project cli examples/promo/promo.smoke.test.ts
```

The smoke test renders `promo-ci` to `out/examples/promo-ci.mp4` through `node dist/cli.js render …
--json` and asserts the envelope and the file with `ffprobe`: 60 frames, `30/1`, 960×540, a 2.000 s
duration and a clean FFmpeg decode.
Because `promo-ci` reaches only the first two scenes, the same file also renders one 1920×1080 still
of each of the eight scenes of `promo` (frames 60, 170, 340, 520, 678, 818, 1185 and 1301) through `node
dist/cli.js frame … --software-webgl --json`, so a scene that throws or fails to mount fails CI. The
`three` scene draws WebGL and CI's Linux runner has no GPU, hence `--software-webgl`.

## Why there is no probe

The four reference targets each carry a `-probe` Composition for the determinism gate, and the probes
draw only opaque, whole-pixel rectangles because the gate compares exact PNG bytes across macOS and
Linux. This video is made of text, gradients and fractional opacity, so a probe built from its real
components could not pass that gate, and one built from rectangles would test nothing the teaser's
probe does not. Its determinism is the framework's: every value is computed from the sequence or
timeline time, with no clock and no randomness.

## Known limitations

- **The type is the system sans and monospace stacks**, so the look is fixed per machine, not across
  machines; a frame rendered on another OS will differ in its glyphs.
- **The 3D card faces are 2D canvas textures, not live DOM.** HTML-in-Canvas (`drawElementImage`,
  `texElementSubImage2D`) would let the cards be React elements, but Chromium exposes it only behind
  `--enable-blink-features=CanvasDrawElement`, which the renderer does not pass, and its paint is
  asynchronous, so it would need its own frame settlement. Each face is drawn once into a
  `<canvas>` and used as a `canvasTexture`.
- **The 3D scene's pixels depend on the WebGL backend**: a hardware GPU and `--software-webgl`
  (SwiftShader) antialias and light it slightly differently.
- **The review scene's preview is a drawing, not the preview page.** It follows the real page's layout and English labels (the comment-mode hint, the Comments tab, Copy Markdown), and the transcript quotes the head of the review Markdown, but it is a mock in the design grid, so a change to the preview page does not show up here on its own.
- **No audio.** The video is silent; adding a music bed would need a generated or licensed track and
  an `assets.manifest.json`.

## Assets and credit

**This example commits no asset and needs no credit line.** There is no media, no font file and no
image: the whole video is text, inline SVG, CSS gradients and arithmetic.
