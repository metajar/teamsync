---
name: data-model
description: Note types, frontmatter schemas, folder layout, and carry-forward semantics — the vault-as-database contract. Load when creating or changing note types, frontmatter fields, or path conventions.
triggers:
  - "note type"
  - "frontmatter"
  - "schema"
  - "folder"
  - "data model"
  - "carry forward"
  - "action items"
edges:
  - target: context/architecture.md
    condition: when understanding how the data layer fits the overall system
  - target: context/conventions.md
    condition: when writing code that reads or writes notes
  - target: patterns/add-note-type.md
    condition: when implementing or extending a note type
  - target: context/decisions.md
    condition: when changing the vault-is-the-database decision or a schema in a breaking way
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh:64:<hex>" }
grounds_to: []
last_updated: 2026-09-10
---

# Data Model

The vault is the database. Every note type is plain markdown with a fixed YAML frontmatter field set; the body is free-form and never parsed for structure. Frontmatter stays Dataview-compatible so users can query their own data.

## Folder Layout
```
/Team/                      ← root folder, configurable in settings
  /Jane Doe/
    _index.md               ← person profile, links to everything below
    /1-on-1s/
      2026-09-02.md         ← one note per 1:1, named by ISO date
    /Goals/
      2026-q3-improve-code-review-turnaround.md
    Development-Plan.md     ← single evolving note per person
```
- Archiving/offboarding a person preserves history — never delete person folders. [TO BE DETERMINED — populate after first implementation: exact archive mechanism]

## Note Types & Frontmatter Schemas

### `person` (`_index.md`)
| Field | Purpose |
|-------|---------|
| `type` | `person` (required) |
| `name` | person name (required) |
| `status` | `active` / `archived` (required; archive flips this field only — never delete or move files) |
| `role` | optional — omitted entirely when unset, not written empty |
| `start_date` | optional, ISO date — omitted entirely when unset |
Discovery: people are found by frontmatter `type: person` (any md file), not by filename. `listActivePeople`-style reads are lenient about a missing `type` on `_index.md`; only `status: archived` or an explicit non-person type excludes.

### `one-on-one`
| Field | Purpose |
|-------|---------|
| `type` | `one-on-one` |
| `person` | person name — links note to person |
| `date` | ISO date of the meeting |
| `mood` | optional pulse rating — currently serialized as an empty-string placeholder (`mood: ''`) the user fills; scale is still an open PRD question |
| `action_items_open` | count of open action items, for dashboards/carry-forward; at creation it is written as the carried-forward open-item count (not a literal 0) |
Body sections come from the template: agenda/talking points, notes, wins/concerns, action items (checkboxes), pulse. Same-day collision → `-2`, `-3`, … filename suffixes; originals are never overwritten.

### `goal`
| Field | Purpose |
|-------|---------|
| `type` | `goal` |
| `person` | person name |
| `title`, `description` | content |
| `status` | `not-started` / `in-progress` / `blocked` / `done` |
| `target_date`, `created_date` | dates |
| `discussed_in` | optional — wiki-links to 1:1 note(s) where it was set/updated; stored as a scalar `[[link]]` when single, block list when multiple; accepts bare paths or `[[links]]` on input |
Filenames are slugified kebab-case titles with `-2`/`-3` suffixing on duplicates. `status` is exactly `not-started` / `in-progress` / `blocked` / `done`; a corrupted (non-union) value throws on read rather than being silently normalized. `updateStatus` rewrites only the status line, preserving every other field and the body byte-for-byte. Grouping under themes/quarters and optional OKR-style objective+key-results: Phase 2 — keep OKR as an optional template, not a forced framework.

### `dev-plan` (`Development-Plan.md`)
| Field | Purpose |
|-------|---------|
| `type` | `dev-plan` |
| `person` | person name |
| `last_reviewed` | drives the stale-plan reminder banner (configurable cadence, default 90 days) |
Body: growth areas, skills, target role/level, stretch opportunities, dated revision log. Links goals and 1:1 notes as evidence.

## Carry-Forward Rule
Incomplete action items from a person's most recent 1:1 automatically become agenda items in the next 1:1 note. Completion is tracked by checkbox state in the body — the only body content the plugin reads. Implemented by the exported pure parser `extractOpenActionItems(body)`:
- An open item is a body line matching `/^- \[ \] +(\S.*)$/` — column-0 list item, empty checkbox, non-whitespace text; captured text trimmed, order preserved.
- Not matched: `- [x]`/`- [X]`, indented (nested) checkboxes, prose, non-list lines, ordered lists, textless checkboxes (so template scaffolding never propagates).
- Carried items render in the new note's agenda under `### Carried forward from <previous frontmatter date>` as unchecked `- [ ]` items.

## Schema Change Rules
- Frontmatter fields are additive by default; removing or renaming a field breaks existing vaults — record a decision in `context/decisions.md` first.
- Never migrate user data destructively; prefer reading both old and new field names during any transition.
