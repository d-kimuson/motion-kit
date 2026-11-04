# presets

Reusable scene components. A preset is a normal React component with a Zod schema for its props and metadata an agent can search; it works without a theme and uses tokens when one is present.

## Ubiquitous Language

| Term            | Code             | Definition                                                                                             |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| Preset          | `definePreset`   | A React component plus schema and metadata, registered for discovery.                                  |
| Preset Metadata | `PresetMetadata` | `id`, `title`, `category`, `tags`, and `capabilities` (`seekability`, `requiresGPU`, `supportsTheme`). |
| Preset Registry | `presets.list()` | The searchable list of registered presets with their metadata and JSON Schema.                         |
| Schema          | `schema` (Zod)   | The single source of a preset's prop types, JSON Schema, and validation.                               |
| GPU Capability  | `requiresGPU`    | Which rendering backend a preset needs: none, software WebGL, hardware GPU, or a specific API.         |

## Invariants

- A preset's TypeScript props type is derived from its Zod schema, never written separately.
- Props are validated at the preset's entry during inspect and development, not inside the render path.
- A preset's declared seekability is backed by a determinism test.
