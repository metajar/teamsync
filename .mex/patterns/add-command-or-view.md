---
name: add-command-or-view
description: Wiring a new Obsidian command, modal, or dashboard view to service-layer logic — the thin entry-point workflow.
triggers:
  - "new command"
  - "add view"
  - "dashboard"
  - "modal"
  - "settings tab"
edges:
  - target: context/conventions.md
    condition: layering rules — what the entry point may and may not do
  - target: context/architecture.md
    condition: how entry points fit the overall flow
  - target: patterns/ollama-feature.md
    condition: when the command/view triggers an AI action
grounds_to: []
last_updated: 2026-09-10
mex:
  id: mx_01M24JPHZJHJBPQDJPVJVWFBGZ
  type: pattern
  status: promoted
  revision: 4
  title: add-command-or-view
  relations:
    - type: related_to
      target: mx_01M24JPHRK2XQMG6CPDGC9HVTZ
      note: layering rules — what the entry point may and may not do
    - type: related_to
      target: mx_01M24JPHNGVN5Z0VG5AW508QY0
      note: how entry points fit the overall flow
    - type: related_to
      target: mx_01M24JPJ17GQBW3AXJ3811NKCM
      note: when the command/view triggers an AI action
---

# Add a Command, Modal, or View

## Context
Entry points are thin: parse input, call a service, render or notify. Business logic and all `vault.*` access live in services (see `context/conventions.md` Structure rules).

[No code exists yet — ground symbols here after first implementation.]

## Steps
1. Register the command in the plugin's command list (or the view via `registerView`), with an id, name, and hotkey-able callback.
2. In the callback: gather input (person picker modal, settings), then delegate to the matching service method. One line of delegation, not logic.
3. Handle the service result: `new Notice(...)` for errors/success, or update the view's render.
4. For dashboards: render from the metadata cache; never re-parse the whole vault. Compute rollups (last 1:1 date, open goals count, dev plan staleness) from cached frontmatter.
5. If the entry point triggers an AI feature, follow `patterns/ollama-feature.md` — including the send-preview step.

## Gotchas
- Commands/views calling `vault.*` directly is the #1 layering violation — reject it in review, including "just this once" reads.
- Person-picking UX: with 3–12 reports, a simple suggest modal beats a full picker UI; don't over-build.
- Dashboard performance: with years of 1:1 history, avoid loading note bodies — frontmatter from the cache is enough for rollups.
- Overdue indicators are passive (dashboard display) for now — active notifications are an open PRD question; don't add them preemptively.

## Verify
- [ ] Callback contains no business logic and no `vault.*` calls
- [ ] Errors surface as Notices with actionable text, never swallowed
- [ ] Dashboard reads come from the metadata cache, not file re-parsing
- [ ] Command id and name follow existing naming style

## Debug
- Command missing from the palette → check registration in the plugin's `onload` and the plugin id in manifest.
- Dashboard stale after a write → the metadata cache hadn't refreshed; re-read cache after vault events rather than caching frontmatter in view state.
- Modal returns undefined (user cancelled) → guard the callback against the cancel path before calling the service.

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update `context/architecture.md` Key Components if a new major view/component emerged
