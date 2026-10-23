# motion

Deterministic values from time. motion provides the pure functions (interpolate, spring, keyframes, easing) and the components (Animate, Reveal, Stagger) that turn Local Time into style values. The motion library owns the rich expression; motion-kit owns time and values and never wraps the library thinly.

## Ubiquitous Language

| Term        | Code                                                                    | Definition                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure Motion | `interpolate`, `spring`, `keyframes`, `easing`                          | A function from time (and parameters) to a value, with no state.                                                                             |
| Spring      | `spring(time, { from, to, start, velocity, stiffness, damping, mass })` | A damped spring evaluated in closed form at a time.                                                                                          |
| Retarget    | `retarget`                                                              | Replacing a Spring by a new Spring that starts at the switch time with the old one's position and velocity; never a mutation of the old one. |
| Animate     | `Animate`                                                               | A component that applies `from`/`to` values to a dedicated wrapper element over `delay`/`duration` with an `easing`.                         |
| Reveal      | `Reveal`                                                                | An Animate whose values are a reveal (mask, clip, slide) of its content.                                                                     |
| Stagger     | `Stagger`                                                               | A component that gives each child an explicit delay rule and animation.                                                                      |
| Wrapper     | `as` prop                                                               | The element Animate renders and animates; children are never style-injected.                                                                 |

## Invariants

- Every Pure Motion function returns the same value for the same inputs, and the value at the end of the range equals `to`.
- A Spring is determined by start time, initial value, target, initial velocity, and physical parameters; nothing else.
- Motion components are Tier A; a raw motion-library element is not Tier A unless the integration has verified it.
