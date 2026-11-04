# Authoring

A motion-kit video is a React tree plus the metadata that fixes its timeline. This page covers what
an entry file exports, the hooks that report time, the two structural components (`Sequence` and
`TransitionSeries`), the [motion values](#motion-values), asset loading, and audio declarations.
Everything it names is exported from `@kimuson/motion-kit`, except the motion values, which
come from the `@kimuson/motion-kit/motion` subpath; anything marked planned is not.

## The registry

An entry file exports a `compositions` registry:

```tsx
// entry.tsx
import { defineComposition, defineCompositions } from '@kimuson/motion-kit';
import { z } from 'zod';

export const compositions = defineCompositions([
  defineComposition({
    id: 'hello',
    component: Hello,
    schema: z.object({ title: z.string().default('Hello') }),
    width: 1920,
    height: 1080,
    fps: { numerator: 30, denominator: 1 },
    durationInFrames: 150,
  }),
]);
```

Both functions return a `Result`. `defineComposition` validates the declaration and returns
`Result<CompositionDefinition>`; `defineCompositions` takes the array of those results and returns the
registry, failing with the first declaration error it finds. Because the errors are values rather
than throws, a bad entry is reported as `render.page-error` or `composition.duration-invalid` with a
hint, not as a crash.

### Composition fields

| Field              | Type                         | Meaning                                                                           |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------- |
| `id`               | `string`                     | The id `--composition` selects. Unique in the registry, non-empty.                |
| `component`        | React component              | Receives the schema's output as props.                                            |
| `schema`           | Zod object schema            | Validates and normalizes props. Its defaults are the only defaults.               |
| `width`, `height`  | positive integers            | The captured viewport in pixels.                                                  |
| `fps`              | `{ numerator, denominator }` | The frame rate, as a rational. Never a number, never a rounded float.             |
| `durationInFrames` | nonnegative integer          | The length of the Composition in frames.                                          |
| `audio`            | `AudioTrack[]`, optional     | Clips the `.mp4` route muxes. See [audio](#audio).                                |
| `resolveMetadata`  | function, optional           | Derives metadata from the props. See [metadata from props](#metadata-from-props). |

Two declarations are rejected on purpose:

- a `duration` field in seconds — the timeline is frames, and a second duration would be a second
  clock (`render.page-error`);
- non-empty `defaultProps` on the component (including inherited ones) — schema defaults are the only
  defaults authority (`render.page-error`).

`durationInFrames: 0` is legal and lists one Composition with no output frame; an `.mp4` render of it
reports `encode.output-invalid` with `reason: "no-frames"`.

### Props

Props are the schema's output. The renderer validates them once per selection, before the first
frame, with two restrictions that come from how they cross into the page:

- they must be **JSON**: finite numbers, strings, booleans, null, arrays and plain objects. A `Date`,
  a class instance, a function or a `Map` fails as `composition.props-invalid`;
- the top-level object may not use the reserved names `key`, `ref`, `__self`, `__source` or
  `__proto__` (React consumes or copies them), which is also `composition.props-invalid`.

`--props '{"title":"Ship it"}'` on the CLI overrides them for one run; fields you omit fall back to
their schema defaults. `frame` accepts the same `--props` object for stills.

### Metadata from props

A generated script — synthesized audio, a transcript, a data file — often decides how long the
video is, so the length cannot be written into the entry. `resolveMetadata` derives the metadata
from the props: it receives the validated props (defaults applied) and the declaration, and returns
the fields it derives. Every field it omits keeps the declared value.

```tsx
defineComposition({
  id: 'episode',
  component: Episode,
  schema: z.object({ frames: z.number().int().nonnegative(), script: z.string() }),
  width: 1920,
  height: 1080,
  fps: { numerator: 30, denominator: 1 },
  durationInFrames: 1, // the baseline a list reports; the props decide the real length
  resolveMetadata: ({ props }) => ({ ok: true, value: { durationInFrames: props.frames } }),
});
```

```sh
motion-kit render entry.tsx --composition episode --props "$(cat script.json)" --out out.mp4
```

- It runs **once per mount**, in the page, after the schema and before anything renders, so `render`,
  `frame`, `check` and `preview` all read the same descriptor for the same props, and
  `useTimeline()` reports the resolved `durationInFrames`. A renderer pool resolves once per realm,
  so the resolver must be deterministic: same props, same metadata.
- It may derive `durationInFrames`, `width`, `height` and `fps`. It cannot change the `id` or the
  `audio` declarations. Audio clip times are **frame counts** (`startInFrames`, `endInFrames`,
  `offsetInFrames`), so an `fps` override keeps those clips on the same frames and moves them in
  seconds: deriving the frame rate shifts every declared clip in time, and a clip that then outlasts
  the video is trimmed. See [audio](#audio).
- It may be asynchronous (`async` or a promise) and gets a fresh loading timeout of its own. The page
  can `fetch` a project file but has no filesystem: to derive a duration from an audio file, probe it
  in your own Node script and pass the number through `--props`, or fetch the file and read it in the
  page.
- It returns a `Result`: `{ ok: true, value: { durationInFrames: 900 } }` or
  `{ ok: false, error: <Diagnostic> }`. An invalid duration is `composition.duration-invalid`, an
  invalid width, height or FPS is `render.page-error`, and a resolver that throws, returns something
  else or does not settle in time is `render.page-error` too. Nothing renders on failure.
- `listCompositions()` keeps reporting the declared metadata, because a list has no props to resolve
  against; treat `durationInFrames` there as the baseline.

## Time

The Composition's clock is its frame index. Every hook below derives from it, and none of them reads
the wall clock.

| Hook            | Returns                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `useFrame()`    | The global output frame index (`0` … `durationInFrames - 1`), never a rounded local frame.               |
| `useTime()`     | Local seconds inside the nearest `Sequence`; global seconds outside any.                                 |
| `useSequence()` | `{ time, duration, remaining, progress, localFramePosition, fps, globalTime, globalFrame }`              |
| `useTimeline()` | The same time fields plus `{ id, width, height, durationInFrames, frameRate }` for the whole Composition |

So a value that should be a pure function of time is written from one of them, and nothing else:

```tsx
const fadeIn = () => Math.min(1, useTime() / 0.3); // 0 → 1 over the first 300 ms
```

`useTimeline().width` and `.height` are how a component adapts to the Composition's size instead of
hard-coding it; `useSequence().progress` is `time / duration` of the sequence it sits in, which is
what a Ken Burns move or a slide transition needs.

## Motion values

`@kimuson/motion-kit/motion` turns a time into a value: interpolation between stops, a keyframe
track, the built-in easings and a closed-form spring. Every function is pure — the time is an
argument, nothing is remembered between frames — so a value computed here is as seekable as the
frame that asks for it.

```tsx
import { useTime } from '@kimuson/motion-kit';
import { easing, interpolate } from '@kimuson/motion-kit/motion';

const Fade = () => {
  const seconds = useTime();
  const opacity = interpolate(seconds, [0, 0.6], [0, 1], { easing: easing.easeOutCubic });
  return <div style={{ opacity: opacity.ok ? opacity.value : 0 }} />;
};
```

`easing.cubicBezier` is the one easing that can fail, because it validates its control points, so it
returns `Result<Easing>` rather than an `Easing`:

```tsx
const curve = easing.cubicBezier(0.25, 0.1, 0.25, 1); // Result<Easing>
const eased = interpolate(seconds, [0, 0.6], [0, 1], curve.ok ? { easing: curve.value } : {});
```

| Function                                                                | Returns                          | Notes                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `interpolate(input, inputRange, outputRange, options?)`                 | `Result<number>`                 | At least two strictly ascending input stops. Options: the extrapolation mode and the easing.                                |
| `keyframes(time, frames, options?)`                                     | `Result<number>`                 | `{ time, value }` stops; the same rules and options as `interpolate`.                                                       |
| `easing`                                                                | `Easing` values                  | `linear` and the cubic, exponential and Back in/out/in-out families: plain `Easing` functions.                              |
| `easing.cubicBezier(x1, y1, x2, y2)`                                    | `Result<Easing>`                 | A CSS curve. `x1` and `x2` must be in `[0, 1]`, so the call can fail: unwrap it before passing it on.                       |
| `spring(time, { from, to, start, velocity, stiffness, damping, mass })` | `Result<number>`                 | A damped spring evaluated in closed form; it holds `from` before `start`.                                                   |
| `springState(time, spring)`                                             | `Result<{ position, velocity }>` | The position and the analytic velocity at that time.                                                                        |
| `springSettleTime(spring, tolerance)`                                   | `Result<number>`                 | A duration in seconds from `start` until the spring's sustained last entry into ±`tolerance`; add `start` for a frame time. |
| `retarget(spring, time, { to, stiffness?, damping?, mass? })`           | `Result<Spring>`                 | A new spring that starts at `time` with the old one's position and velocity; the old one is never mutated.                  |

- Invalid input is a value, not a throw: an input range that is not strictly ascending, a
  non-positive stiffness, or an evaluation outside the finite range returns `{ ok: false, error }`
  with a `Diagnostic`. Programmer errors still throw — a custom `easing` callback that throws
  propagates out of `interpolate`/`keyframes`, because nothing catches it.
- `options.extrapolate` defaults to `clamp`; `extend` continues the outer segment's slope, and
  `identity` returns the input unchanged outside the range.
- Every exact input stop returns that stop's value without calling the easing, so a custom easing
  that does not preserve `0` and `1` cannot move a stop.
- A spring is determined by its seven fields alone. To change the target mid-flight, call `retarget`
  at the switch time and sample the spring it returns; sampling the old spring would keep the old target.
- The subpath ships values, not components. `Animate`, `Reveal` and `Stagger` are not part of it.

## `Sequence`

`Sequence` renders its children only inside `[from, from + duration)`, and shifts the local clock:

```tsx
<Sequence from={1.5} duration={2}>
  <Banner /> {/* useTime() runs 0 → 2 here, and the subtree is absent outside the window */}
</Sequence>
```

- `from` and `duration` are seconds, either as a number or as a rational (`{ numerator, denominator }`).
- `from` is relative to the enclosing Sequence's start, or to the Composition's start at the top.
- `duration` must be nonnegative; zero renders nothing.
- An ancestor's window clips visibility, not a descendant's declared interval: an inner `Sequence`
  that starts before its parent is still clipped by the parent.
- `name` (optional, nonempty) labels the span for host tools that read `runtime.sequences()`. Nested names
  form a path like `intro > title`; unnamed Sequences add nothing. It never changes what renders.
  `TransitionScene` accepts the same `name`.

## `TransitionSeries`

`TransitionSeries` lays out scenes back to back with optional overlaps. Its direct children are
`TransitionScene`s, and a `Transition` may sit between two adjacent scenes:

```tsx
<TransitionSeries>
  <TransitionScene duration={2}>
    <Intro />
  </TransitionScene>
  <Transition duration={0.4}>
    <CrossFade />
  </Transition>
  <TransitionScene duration={2}>
    <Outro />
  </TransitionScene>
</TransitionSeries>
```

- A scene occupies its own `duration`; the series is `sum(scenes) − sum(overlaps)` long, and with no
  `Transition` between two scenes the cut is hard.
- A `Transition`'s `duration` is the overlap, and it may be at most the smaller of the two adjacent
  scene durations.
- Each `TransitionScene` stays mounted for its whole `duration`, so **both adjacent scenes are
  mounted during an overlap**. A `Transition`'s children are mounted in addition, **only during the
  overlap**, drawn after (above) the scenes, and they are the only code that can read
  `useTransitionProgress()` (0 → 1 across the overlap). A scene cannot read it.
- To animate a scene across an overlap you therefore have two options: fade each scene itself from
  `useSequence().time` / `.remaining` (the scene sits in its own Sequence, so `remaining` counts down
  to its end) and let the `Transition` child draw only an overlay such as a wipe bar; or declare both
  sides again inside the transition's children (below) and draw them over the scenes.
- `TransitionScene` must be a direct child of `TransitionSeries`, with at most one `Transition`
  between adjacent scenes; anything else is a malformed tree and fails the frame as
  `render.page-error`.
- Both sides of a crossfade are drawn over the same pixels, so two translucent layers sum their
  alpha. When one side is opaque, fade only the incoming layer over the outgoing one as its base
  instead of fading both — otherwise the overlap dips towards the background.

A crossfade component that redraws both sides reads the progress once and applies it to both layers.
It is drawn over the scenes, which are still mounted underneath:

```tsx
const CrossFade = () => {
  const progress = useTransitionProgress();
  return (
    <>
      <div style={{ opacity: 1 - progress }}>
        <Intro />
      </div>
      <div style={{ opacity: progress }}>
        <Outro />
      </div>
    </>
  );
};
```

## `useAsset`

Fonts and images are loaded through `useAsset`, which suspends until the asset is decoded and ready:

```tsx
import { useAsset } from '@kimuson/motion-kit';
import { Suspense } from 'react';

const Logo = () => {
  const image = useAsset({ kind: 'image', id: 'logo', source: '/assets/logo.svg' });
  return <img src={image.src} width={160} height={160} alt="" />;
};

const Title = () => {
  const face = useAsset({
    kind: 'font',
    id: 'noto-sans-jp',
    family: 'Noto Sans JP',
    source: '/assets/fonts/NotoSansJP[wght].woff2',
    weight: 400,
  });
  return <p style={{ fontFamily: face.family, fontSize: 72 }}>…</p>;
};

<Sequence from={0.5} duration={1}>
  <Suspense fallback={null}>
    <Logo />
  </Suspense>
</Sequence>;
```

- `source` is a **root-relative URL** against the project root (the directory the CLI runs in), never
  a JavaScript import of the file. An absolute file path is not a URL and does not load.
- `id` is your cache key within the Composition; for a font, `family` is the CSS family the face is
  registered under.
- `useAsset({ kind: 'image' })` returns an `HTMLImageElement`, `useAsset({ kind: 'font' })` a
  `FontFace`, and `useAsset({ kind: 'font-family' })` the `FontFace` objects it waited for; the
  overloads keep the result types apart.
- **Put every `useAsset` consumer inside a local `<Suspense>`** with a `fallback` of your choice. A
  throw that reaches the root suspends the whole Composition, and the page never acknowledges the
  frame: the render waits for its deadline and then reports `render.frame-timeout` /
  `asset.not-ready` instead of the real cause.
- A missing or undecodable asset throws a diagnostic-backed error that surfaces as
  `asset.load-failed`, naming the source. Video is not an asset kind.

### Fonts that CSS declares

`@fontsource/*` splits one family into dozens of `@font-face` rules by `unicode-range`, one file per
subset. Import the CSS and require the family for the text the frame renders: `useAsset` waits for
only the subsets that text needs, and the frame is captured after they are loaded.

```tsx
import '@fontsource/noto-sans-jp/400.css';

const Title = () => {
  useAsset({
    kind: 'font-family',
    id: 'title',
    family: 'Noto Sans JP',
    weight: 400,
    text: 'こんにちは世界',
  });
  return <h1 style={{ fontFamily: 'Noto Sans JP', fontSize: 72 }}>こんにちは世界</h1>;
};
```

- `text` is **required** and must be the text the frame draws. It selects the subsets: a frame of
  Japanese characters loads the Japanese subsets and never the Latin one.
- `family`, `weight` and `style` are matched the way CSS matches them, so declare the faces you
  imported. The requirement is keyed by all four fields, including `text`.
- A family no stylesheet declares, or one whose declared faces do not cover the text at all, fails
  the frame with `asset.load-failed` and names the family instead of capturing the system fallback.
  A character that no subset covers still falls back; glyph coverage is not checked.
- The stylesheet has to be in the page before the frame renders. An `import` of the CSS in your
  entry is; a `<style>` element rendered inside the suspending subtree is not.
- The returned faces are the ones that were loaded, so `faces[0].family` is the CSS family. Most
  scenes only need the wait and ignore the return value.
- A subset file that fails to load stays failed for the life of the page: a script cannot replace a
  stylesheet’s `@font-face`. The frame reports `asset.load-failed` (phase `load`) and the hint says
  to reload the preview or start a new renderer; a retry in the same page fails the same way.

## Audio

Audio is Composition data, declared next to the frames. Times are frame counts, not seconds, so the
muxer places each clip through the same timeline the frames use:

```tsx
defineComposition({
  // …id, component, schema, width, height, fps, durationInFrames
  audio: [
    { src: 'audio/voice.wav', startInFrames: 30 },
    { src: 'audio/music.mp3', endInFrames: 450, volume: 0.25 },
  ],
});
```

| Field            | Default                  | Meaning                                                                         |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `src`            | required                 | File path, resolved against the project root; absolute paths are used as given. |
| `startInFrames`  | `0`                      | Timeline frame where the clip starts.                                           |
| `endInFrames`    | the source's natural end | Exclusive timeline frame where the clip stops. Must exceed `startInFrames`.     |
| `offsetInFrames` | `0`                      | Frames to trim from the head of the source.                                     |
| `volume`         | `1`                      | Linear gain; `1` is the file's own level, `0` is silent.                        |

- All clips are mixed into **one 48 kHz stereo AAC stream** inside the same FFmpeg invocation that
  encodes the frames, and the stream ends with the Composition rather than with the longest clip.
- `volume: 1` is the file's own level: a mono source is duplicated into both channels at unity gain,
  so a mono clip and a stereo clip at the same amplitude render at the same level, and the balance
  between narration and music is the one you heard in the files.
- Overlapping clips are summed without normalization, so adding a track never changes another
  track's gain.
- An invalid declaration — `endInFrames <= startInFrames`, a negative or non-integer frame, a
  non-finite volume — is rejected at `defineComposition` time as `render.page-error`. A declared file
  that cannot be opened is `asset.load-failed` before any frame is encoded.
- Audio plays in the rendered `.mp4`, and also in [`motion-kit preview`](cli.md#preview), where each
  source can be muted and the mix is approximate, so check the `.mp4`. The frames route writes
  pictures without sound.

## Three.js

A Composition can draw with Three.js through React Three Fiber: `ThreeCanvas` advances the R3F root
from motion-kit time instead of the browser clock, and `CameraRig` gives the camera an absolute pose
derived from time. The peer dependencies, the rules a seekable scene follows and what makes a canvas
uncontrolled are in [Three.js](three.md).

## Styles and markup

The Composition renders in Chromium at `width × height`, so the page is a normal browser page:

- inline styles, CSS files imported by the entry, inline SVG and `<canvas>` all work; Vite processes
  your entry's imports;
- the project root is served, so root-relative asset URLs resolve;
- there is no network policy and no filesystem access from the page: a remote URL is your own risk,
  and it breaks determinism, since a network fetch is not a pure function of time.

## Types

Everything worth naming is exported from the package root: `CompositionDefinition`,
`CompositionDescriptor`, `CompositionRegistry`, `SequenceProps`, `TransitionSeriesProps`,
`TransitionSceneProps`, `TransitionProps`, `SequenceContext`, `TimelineContext`, `AssetDescriptor`,
`FontAssetDescriptor`, `ImageAssetDescriptor`, `AudioTrack`, `SequenceSpan`, `Diagnostic`, `DiagnosticCode`,
`Result`, `FrameRate`, `TimelineTime`, `RationalInput`, `Seekability`, `CompositionMetadataInput`,
`CompositionMetadataOverride`, `MetadataResolver`.

`/three` names its own: `ThreeCanvas`, `ThreeCanvasProps`, `CameraRig`, `CameraRigProps`,
`CameraPose`, `Vector3Tuple`.

`/motion` names its own: `Easing`, `InterpolateOptions`, `Keyframe`, `Spring`, `SpringState`,
`RetargetOptions`, and re-exports `Result`.

`Composition`, `CompositionContent` and `useCompositionFrame` are exported too, but they are the page
bootstrap's own API: an entry never renders `Composition` itself.

## Not available yet

`Animate`, `Reveal` and `Stagger` — the components that apply values to a wrapper element, which
`/motion` does not ship; `defineTheme` and tokens (`/theme`); the scene presets (`/presets`);
`inspect` and `validate`. Until those land, a component writes its own motion over the
[motion values](#motion-values), which is what the [reference examples](examples.md) do.

## Related

- [CLI](cli.md) — how `--props`, `--composition` and `--out` reach the registry.
- [Determinism](determinism.md) — the rules that keep `useFrame()`-derived output reproducible.
- [Three.js](three.md) — the 3D canvas, its absolute camera, and software WebGL.
- [Examples](examples.md) — the same APIs in four complete videos.
