# theme

Defaults and direction for expression. theme defines themes as tokens (color, typography, spacing, motion, three, effects), resolves them by priority, and exposes them as CSS variables scoped to the provider. A theme never prevents a component from expressing something.

## Ubiquitous Language

| Term           | Code                   | Definition                                                                                            |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Theme          | `defineTheme`          | A typed set of tokens with defaults.                                                                  |
| Token          | `theme.<group>.<name>` | One named value in a theme; custom tokens extend the type.                                            |
| Theme Priority | `resolveToken`         | The order in which a value is found: component props, nested theme, composition theme, default theme. |
| Scope          | `ThemeProvider`        | The subtree whose CSS variables a provider sets; variables are never set on `:root`.                  |

## Invariants

- A component prop always wins over any theme.
- Components work without a provider; the default theme applies.
- Nested providers override only the tokens they define; the rest resolve from the outer scope.
