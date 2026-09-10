---
name: add-note-type
description: Adding or extending a note type (person, 1:1, goal, dev-plan) — template, frontmatter schema, service, and command wiring.
triggers:
  - "new note type"
  - "add note type"
  - "extend note type"
  - "frontmatter field"
  - "new entity"
edges:
  - target: context/data-model.md
    condition: the schema contract and folder layout this task must follow
  - target: context/conventions.md
    condition: layering and naming rules for the new service and template
  - target: patterns/add-command-or-view.md
    condition: when the note type needs a new command, modal, or dashboard entry point
grounds_to: []
last_updated: 2026-09-10
mex:
  id: mx_01M24JPJ08JKNE4HT7C89EE1EK
  type: pattern
  status: promoted
  revision: 3
  title: add-note-type
  relations:
    - type: related_to
      target: mx_01M24JPHRK2XQMG6CPDGC9HVTZ
      note: layering and naming rules for the new service and template
    - type: related_to
      target: mx_01M24JPHZJHJBPQDJPVJVWFBGZ
      note: when the note type needs a new command, modal, or dashboard entry point
---

# Add or Extend a Note Type

## Context
Load `context/data-model.md` (the schema contract) and `context/conventions.md` (layering rules). Note types are the core extension point of this plugin — every entity (person, 1:1, goal, dev plan) is markdown + fixed frontmatter fields, created via the template engine.

[No code exists yet — ground symbols here after first implementation.]

## Steps
1. Define the frontmatter field set for the type in `context/data-model.md` first — schema changes start there, not in code.
2. Add or edit the user-editable template with `{{placeholders}}` for every dynamic field.
3. Create/extend the entity's service: template load → placeholder fill → vault write. All file I/O stays in the service.
4. Derive all paths from settings (root folder, per-person subfolders).
5. Wire a command or button that calls the service (see `add-command-or-view.md`).
6. Update the metadata-cache-driven dashboards if the type adds dashboard-visible fields.
7. Write Vitest tests for the service with a mocked Obsidian API (placeholder fill, frontmatter round-trip).

## Gotchas
- Frontmatter fields are additive; renaming/removing breaks existing vaults — record a decision in `context/decisions.md` before any breaking change.
- Never parse structure out of the note body — the only sanctioned body read is 1:1 action-item checkboxes (see carry-forward rule in `context/data-model.md`).
- The service must not import Obsidian UI classes; user-facing notices belong to the caller.
- Keep fields optional wherever possible — rigid templates kill usage (PRD risk).

## Verify
- [ ] Schema documented in `context/data-model.md` before code
- [ ] Note created through the template engine, no hardcoded bodies
- [ ] Frontmatter only for structured data; fixed field set honored
- [ ] Paths from settings, not literals
- [ ] Service has Vitest coverage with mocked vault
- [ ] Existing notes of other types still load (no schema bleed)

## Debug
- Note created but dashboards don't see it → check frontmatter `type` value (kebab-case) and that the dashboard reads via metadata cache, not ad-hoc parsing.
- Placeholders unfilled → the service passed no value for them; decide default (empty string) vs error per template contract.
- Existing vault notes fail to parse → a field was renamed rather than added; add back-compat reading of the old name.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update `context/data-model.md` with the finalized field set
- [ ] If this task type grew a new gotcha, update this pattern
