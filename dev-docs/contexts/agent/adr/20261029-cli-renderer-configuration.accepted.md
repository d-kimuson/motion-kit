# Resolve renderer configuration from flags, environment and defaults

## Context

CLI renders need the same project and Vite configuration locally and in CI, while Chromium's sandbox and software WebGL remain explicit choices.

## Decision

`render` and `frame` accept `--project-root <dir>`, `--vite-config <path>`, `--software-webgl` and `--disable-sandbox`. Their environment counterparts are `MOTION_KIT_PROJECT_ROOT`, `MOTION_KIT_VITE_CONFIG`, `MOTION_KIT_SOFTWARE_WEBGL` and `MOTION_KIT_DISABLE_SANDBOX`. Flags override environment values, which override defaults. Boolean environment values accept `1` and `true` as true, and `0`, `false` and empty as false; any other value is an invocation error unless overridden by a flag.

The project root defaults to the working directory; the config defaults to Vite's discovery under that root. Relative configuration paths resolve against the working directory. The root must be an existing directory and an explicit config an existing file. Failures use `cli.invalid-arguments` with a corrective hint. The project root also resolves relative audio sources in MP4 renders.

Software WebGL and sandbox disabling default to false. Sandboxing is disabled only by the explicit flag or environment override, never by container detection. The settings reach every renderer in a pool. These invocation options add no envelope fields or Diagnostic codes.

## Consequences

A CI job can opt into a different configuration without changing the project. An explicit config executes trusted project code like a discovered config. The caller remains responsible for the security implications of disabling sandboxing.

## Alternatives

- Automatically disable the sandbox in containers: rejected because it silently weakens the default.
- A separate motion-kit configuration file: rejected because invocation flags and environment overrides cover the requested local and CI use without another configuration layer.
- Discover Vite configuration only by name: rejected because projects may need a different config for rendering.
