# Human Check Criteria

What an agent cannot vouch for and a person verifies. When a change meets one, the QA Check reports `human-check`. Change the criteria only after agreeing with the user.

- Changed what rendered output looks like (a preset, a theme, a motion component, a transition): whether the motion, timing, and typography read as intended, not only whether the frames are deterministic.
- Changed the public API shape (new or renamed exports, prop names, Zod schemas, what a subpath exports): whether the names fit the vocabulary consumers and agents will use, and whether the subpath boundaries still hold.
- Added or replaced a dependency: whether it belongs in core or behind an optional subpath, and whether its license and size are acceptable for consumers.
- Departed from the design (`docs/tmp/design.md`), a Phase 0 spike conclusion, or an ADR: whether the departure is accepted and should become an ADR.
