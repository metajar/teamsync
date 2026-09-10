---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
  - target: context/conventions.md
    condition: when writing code that must follow the layering rules shown in the overview
  - target: context/data-model.md
    condition: when working with note types, frontmatter schemas, or folder layout
  - target: context/ollama.md
    condition: when working on the AI path or Ollama integration boundary
# Broad overview: keep this empty unless a claim depends on a few specific symbols.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh:64:<hex>" }
grounds_to: []
last_updated: 2026-09-10
mex:
  id: mx_01M24JPHNGVN5Z0VG5AW508QY0
  type: architecture
  status: promoted
  revision: 2
  title: architecture
  relations:
    - type: related_to
      target: mx_01M24JPHRK2XQMG6CPDGC9HVTZ
      note: when writing code that must follow the layering rules shown in the overview
---

# Architecture

<!-- Read broad, ground tight. Architecture usually grounds sparsely. When a
     specific symbol is worth navigating to, use this inline form:
```markdown
[`someFunction()`](mex://function:<tier-1-id>)
```
-->

## System Overview

```
Command/View layer (Obsidian commands, ItemViews, modals, settings tabs)
  → Service layer (PersonService, OneOnOneService, GoalService, DevPlanService)
    → Data layer: Obsidian vault + metadata cache
      → notes are plain markdown + YAML frontmatter under /Team/<Person>/...
  Dashboards read via the metadata cache — no full vault re-parse.

AI path: AI panel/view → OllamaClient (thin HTTP client, only code that
  talks to the AI server)
  → context assembled from services (last N 1:1 notes + open goals + dev plan)
  → preview of outbound content → user confirms → response rendered.
  Every step is optional; nothing on this path can block core features.

Typical action: manager runs "New 1:1 note" → OneOnOneService loads the
user-editable template, fills placeholders (date, person, carried-forward
action items from the last 1:1) → writes the note → dashboards pick it up
via the metadata cache.
```

<!-- mex:entity
id: mx_01M24JPHMS9YM6GM828KJ7PTET
type: component
status: promoted
revision: 1
-->
## Key Components
- **Command/View layer** — Obsidian commands, dashboards, modals, settings UI. Entry points only; never touches `vault.*` directly.
- **Service layer** — one service per entity (Person, OneOnOne, Goal, DevPlan). All business logic and all file I/O live here.
- **OllamaClient** — the isolated AI boundary; the only module permitted to make AI requests, with a single timeout/error wrapper enforcing graceful degradation.
- **Template engine** — hand-rolled `{{placeholder}}` substitution; owns the shape of every created note. Services never hardcode note bodies.
- **Dashboards** — team/person rollups (last 1:1 date, open goals, dev plan freshness) built from the metadata cache.

<!-- mex:entity
id: mx_01M24JPHKZTZE1ZAF5A43KXR98
type: component
status: promoted
revision: 1
-->
## External Dependencies
- **Obsidian platform + plugin API** — runtime environment, vault access, metadata cache, UI primitives. Desktop-first; mobile is a stretch goal.
- **Ollama server (optional)** — user-configured local/private endpoint for prep briefs, pattern summaries, and draft assist. All AI features degrade gracefully without it.
- **Dataview plugin (optional, user-installed)** — we never depend on it, but frontmatter stays Dataview-compatible so users can query their own data.

<!-- mex:entity
id: mx_01M24JPHHBCKQN13FA1BPY1EHN
type: component
status: promoted
revision: 1
-->
## What Does NOT Exist Here
- No server, sync backend, or multi-user collaboration — single-manager vault; sync is whatever Obsidian itself provides.
- No cloud AI APIs, telemetry, or any third-party network call — Ollama endpoint only.
- No database (SQLite/IndexedDB) — the vault is the datastore.
- No HRIS, performance-review cycles, comp data, or calendar/scheduling — the plugin logs and preps; scheduling lives elsewhere.
