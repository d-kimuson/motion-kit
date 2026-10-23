# Harness

Where the things agents read (AGENTS.md, guidelines, skills, troubleshots) live, and how to update them.

## Principles

- Keep AGENTS.md, which is always loaded, thin. It holds only the product overview, a directory description about two levels deep, the commands run on every change (Feedback Loop), and the mapping table to the guidelines.
- Split details into guidelines and register each in the AGENTS.md table with "When to read". Guidelines are read on demand (progressive disclosure), so one file covers one situation.
- Rules that lint, types, tests, or scripts can enforce are enforced there and not written in a guideline. Guidelines keep only the judgment calls and principles that cannot be checked mechanically.
- AGENTS.md, REVIEW.md, guidelines, skills, and troubleshots contain only what an agent uses to do the work. Explanations an agent does not use (how a file came to be, which other tools read it) are left out.
- One source of truth. Tool-specific locations point to it with a symlink or a reference (Claude Code and Codex read AGENTS.md directly, so there is no CLAUDE.md; Claude Code skills `.claude/skills` → `.agents/skills`).

## Placement

| Kind                 | Location                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Guideline            | `docs/guidelines/<name>.md`. When split, `docs/guidelines/<name>/*.md` with the shared part in `index.md`                                   |
| Review patterns      | `docs/guidelines/review/index.md`. `REVIEW.md` and the `Code Review Rules` section of AGENTS.md only point to it; no other tool-facing file |
| Agent Skills         | `.agents/skills/<name>/` (`SKILL.md` and `README.md`)                                                                                       |
| Workarounds          | `.agents/troubleshots/<topic>.md` (`docs/guidelines/writing/troubleshoot.md`)                                                               |
| Terms and invariants | Cross-context: `docs/CONTEXT-MAP.md`. Per context: `docs/contexts/<context>/CONTEXT.md` (`docs/guidelines/writing/context.md`)              |
| ADR                  | Cross-context: `docs/decisions/`. Per context: `docs/contexts/<context>/adr/` (`docs/guidelines/writing/adr.md`)                            |
| Design Doc           | Cross-context: `docs/design-doc/`. Per context: `docs/contexts/<context>/design-doc/` (`docs/guidelines/writing/design-doc.md`)             |
| Lean spec            | Next to the implementation under `src/core` (`docs/guidelines/quality-assurance/lean-spec.md`)                                              |

## Updating

- When a guideline is added, removed, or renamed, update the AGENTS.md mapping table in the same change.
- When a directory change shows at the granularity of the AGENTS.md Directory Structure, update it in the same change.
- Harness defects found during work are handled by the boy scout step at commit time (`docs/guidelines/commit.md`).
