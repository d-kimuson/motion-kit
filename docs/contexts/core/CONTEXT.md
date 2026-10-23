# core

The master clock. core defines the Composition, the timeline it runs on, how Sequences and Transitions place scenes in time, and the Time Module that converts between frames and time. It is not responsible for how anything looks.

## Ubiquitous Language

| Term              | Code                             | Definition                                                                                                                                                     |
| ----------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition       | `Composition`                    | The root of a video: fps, duration, resolution, and a tree of scenes placed in time.                                                                           |
| Global Frame      | `globalFrame`                    | The integer index of an output frame, counted from 0 over the whole Composition.                                                                               |
| Timeline Time     | `TimelineTime`                   | A time on the Composition timeline, kept as an exact rational value until the Time Module converts it.                                                         |
| Local Time        | `time` (from `useTime`)          | Time relative to the start of the enclosing Sequence, in seconds.                                                                                              |
| Presentation Time | `presentationTime`               | The timeline time at which an output frame is sampled.                                                                                                         |
| Time Module       | `src/core/timeline`              | The only place that converts seconds, timeline time, and frames, and defines rounding and comparison. Specified in Lean.                                       |
| Sequence          | `Sequence`                       | A scene's display period on the timeline, the half-open interval `[start, end)`.                                                                               |
| Transition        | `Transition`                     | A period in which two adjacent scenes of a `TransitionSeries` are mounted at once and share a progress value.                                                  |
| Seekability Tier  | `seekability: 'A' \| 'B' \| 'C'` | How far a component's output at a time is independent of the frames rendered before: A guaranteed, B controlled by an integration, C uncontrolled.             |
| Asset Readiness   | `useAsset`                       | Whether every asset a frame needs (font, image, video frame, model, texture) is loaded, reported before capture; a failure is a diagnostic, not a silent skip. |

## Invariants

- A frame is a pure function of its Presentation Time: rendering frame N gives the same output whatever frame was rendered before.
- A Sequence contains time `t` exactly when `start <= t < end`; adjacent Sequences share no frame.
- Frame boundaries are not rounded to integers before the Time Module converts them; fps may be rational (30000/1001).
- The total duration of a `TransitionSeries` is the sum of its scenes minus the sum of its overlaps.
- A component that cannot be identified is never assumed to be Tier A.
