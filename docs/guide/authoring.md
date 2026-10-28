# Authoring

A motion-kit video is a React tree plus the metadata that fixes its timeline. This page covers what
an entry file exports, the hooks that report time, the two structural components (`Sequence` and
`TransitionSeries`), asset loading, and audio declarations. Everything it names is exported from
`@kimuson/motion-kit` in 0.0.1; anything marked planned is not.

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

| Field              | Type                         | Meaning                                                               |
| ------------------ | ---------------------------- | --------------------------------------------------------------------- |
| `id`               | `string`                     | The id `--composition` selects. Unique in the registry, non-empty.    |
| `component`        | React component              | Receives the schema's output as props.                                |
| `schema`           | Zod object schema            | Validates and normalizes props. Its defaults are the only defaults.   |
| `width`, `height`  | positive integers            | The captured viewport in pixels.                                      |
| `fps`              | `{ numerator, denominator }` | The frame rate, as a rational. Never a number, never a rounded float. |
| `durationInFrames` | nonnegative integer          | The length of the Composition in frames.                              |
| `audio`            | `AudioTrack[]`, optional     | Clips the `.mp4` route muxes. See [audio](#audio).                    |

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
their schema defaults. `frame` has no `--props`, so a still always renders the defaults.

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
- A `Transition`'s children mount **only during the overlap**, and they are the only code that can
  read `useTransitionProgress()` (0 → 1 across the overlap). Both sides therefore have to be declared
  inside the transition's children to be animated.
- `TransitionScene` must be a direct child of `TransitionSeries`, with at most one `Transition`
  between adjacent scenes; anything else is a malformed tree and fails the frame as
  `render.page-error`.
- Both sides of a crossfade are drawn over the same pixels, so two translucent layers sum their
  alpha. When one side is opaque, fade only the incoming layer over the outgoing one as its base
  instead of fading both — otherwise the overlap dips towards the background.

A crossfade component reads the progress once and applies it to both layers:

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
- `useAsset({ kind: 'image' })` returns an `HTMLImageElement` and `useAsset({ kind: 'font' })` a
  `FontFace`; the overloads keep the two result types apart.
- **Put every `useAsset` consumer inside a local `<Suspense>`** with a `fallback` of your choice. A
  throw that reaches the root suspends the whole Composition, and the page never acknowledges the
  frame: the render waits for its deadline and then reports `render.frame-timeout` /
  `asset.not-ready` instead of the real cause.
- A missing or undecodable asset throws a diagnostic-backed error that surfaces as
  `asset.load-failed`, naming the source. There is no image or font type beyond these two: video is
  not an asset kind in 0.0.1.

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
- Audio plays in the rendered `.mp4` only: there is no preview UI yet, and the frames route writes
  pictures without sound.

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
`FontAssetDescriptor`, `ImageAssetDescriptor`, `AudioTrack`, `Diagnostic`, `DiagnosticCode`, `Result`,
`FrameRate`, `TimelineTime`, `RationalInput`.

`Composition`, `CompositionContent` and `useCompositionFrame` are exported too, but they are the page
bootstrap's own API: an entry never renders `Composition` itself.

## Not available in 0.0.1

`interpolate`, `spring`, `keyframes`, easing, `Animate`, `Reveal` and `Stagger` (`/motion`);
`defineTheme` and tokens (`/theme`); the scene presets (`/presets`); `ThreeCanvas` and React Three
Fiber integration (`/three`); the preview UI; `inspect` and `validate`. Until `/motion` lands, motion
is plain arithmetic on `useTime()` / `useSequence()`, which is exactly what the
[reference examples](examples.md) do.

## Related

- [CLI](cli.md) — how `--props`, `--composition` and `--out` reach the registry.
- [Determinism](determinism.md) — the rules that keep `useFrame()`-derived output reproducible.
- [Examples](examples.md) — the same APIs in four complete videos.
