---
name: conventions
description: How code is written in this project — naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
  - target: context/data-model.md
    condition: when the convention involves note types, frontmatter, or folder paths
  - target: patterns/add-note-type.md
    condition: when adding a new note type — the full task workflow
# Add only nodes that embody the documented convention; do not ground examples broadly.
# grounds_to:
#   - node: "function:<tier-1-id>"
#     fingerprint: "mh:64:<hex>"
grounds_to: []
last_updated: 2026-09-10
mex:
  id: mx_01M24JPHRK2XQMG6CPDGC9HVTZ
  type: convention
  status: promoted
  revision: 3
  title: conventions
  relations:
    - type: related_to
      target: mx_01M24JPHNGVN5Z0VG5AW508QY0
      note: when a convention depends on understanding the system structure
    - type: related_to
      target: mx_01M24JPJ08JKNE4HT7C89EE1EK
      note: when adding a new note type — the full task workflow
---

# Conventions

<!-- Read broad, ground tight. Anchor concrete symbols while keeping prose readable:
```markdown
[`someFunction()`](mex://function:<tier-1-id>)
```
-->

<!-- mex:entity
id: mx_01M24JPHQVCY5YMDX0BB8WQJ6K
type: convention
status: promoted
revision: 1
-->
## Naming
- Note types in frontmatter: kebab-case (`one-on-one`, `dev-plan`, not `oneOnOne`).
- Frontmatter fields: snake_case (`action_items_open`, `target_date`).
- 1:1 note files: ISO date (`2026-09-09.md`); goal files: kebab-case (`2026-q3-improve-code-review-turnaround.md`).
- Code files: kebab-case with dot-separated role (`person.service.ts`, `ollama-client.ts`) and matching test file (`person.service.test.ts`). [VERIFY AFTER FIRST IMPLEMENTATION]
- Person folders: human-readable name as the user would write it (`/Team/Jane Doe/`).

<!-- mex:entity
id: mx_01M24JPHPZ31GWEFSP830MDSEK
type: convention
status: promoted
revision: 1
-->
## Structure
- Views/commands never call `vault.*` directly — all file I/O goes through a service.
- Services never import Obsidian UI classes (Modal, Notice, ItemView) — only the file/metadata APIs. UI feedback is the caller's job.
- One service per entity: PersonService, OneOnOneService, GoalService, DevPlanService.
- All note creation goes through the template engine; no service hardcodes note bodies.
- All vault paths derive from settings (root folder, per-person subfolders) — never hardcoded strings scattered in code.
- All AI calls go through OllamaClient only.

## Patterns
Frontmatter as schema — structured data lives only in YAML frontmatter with a fixed field set per note type; the body is free-form. Never parse structure out of the note body.

```markdown
# Correct — status is frontmatter
---
type: one-on-one
person: Jane Doe
date: 2026-09-09
mood: 4
action_items_open: 2
---

# Wrong — status buried in body text
**Status: done** ← never read or write this from code
```

Layering — commands stay thin, services do the work:

```typescript
// Correct — command delegates
this.app.commands... → OneOnOneService.create(person, carriedItems)

// Wrong — business logic in a command or view
const note = `# 1:1 with ${person}\n...`; // no hardcoded bodies, no vault writes here
```

<!-- mex:entity
id: mx_01M24JPHP82T8RAKA7VCK9P3X4
type: convention
status: promoted
revision: 1
-->
## Verify Checklist
Before presenting any code:
- [ ] No `vault.*` call outside a service
- [ ] No Obsidian UI imports inside a service
- [ ] Structured data written to frontmatter only, using the fixed field set for that note type
- [ ] Notes created via the template engine, not hardcoded bodies
- [ ] Vault paths come from settings, not literal strings
- [ ] Any AI call goes through OllamaClient and fails gracefully (timeout, unreachable, disabled)
- [ ] New service/pure logic is covered by Vitest tests with a mocked Obsidian API
