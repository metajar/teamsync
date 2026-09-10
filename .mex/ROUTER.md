---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: context/data-model.md
    condition: when creating or changing note types, frontmatter schemas, or folder conventions
  - target: context/ollama.md
    condition: when working on any AI feature or the Ollama integration boundary
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
last_updated: 2026-09-10
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Current Project State
**Working (Phase 1 MVP, verified 2026-09-10 — build clean, 113/113 tests):**
- Build tooling: package.json (dev/build/test), esbuild, Vitest with `obsidian` aliased to a stub, manifest.json (id `teamsync`, minAppVersion 1.4.0)
- Person roster: PersonService — quick-add folder scaffolding (`_index.md` + `1-on-1s/` + `Goals/`), metadata-cache listing, archive (status flip only, history preserved)
- 1:1 logging: OneOnOneService — dated notes from template, same-day suffix collision handling, carry-forward via exported pure checkbox parser `extractOpenActionItems()`
- Goals: GoalService — create/list/get, four-state status machine, byte-for-byte-safe `updateStatus`, `openGoalCount`
- Team dashboard: ItemView fed by a pure model (`team-dashboard-model.ts`) — last 1:1 date, days since, open goals, open action items, passive 21-day overdue badge; metadata-cache reads only, no body loads
- Ollama integration (Phase 3, verified 2026-09-10 — build clean, 150/150 tests): `OllamaClient` is the sole AI boundary (requestUrl transport, `/api/tags` + `/api/generate` non-streaming, shared timeout/error wrapper with typed errors); Ollama settings section with Test-connection model dropdown + free-text fallback; "Prep 1:1 with AI" command with mandatory send-preview modal and editable-draft result with citations (see `context/ollama.md`)
- Contracts for the above pinned in `src/CONTRACTS.md`

**Not yet built:**
- Phase 2: development plans + review reminders, person dashboard, OKR-style sub-items, custom templates (a TODO seam for dev-plan context exists in `src/ai/prep-context.ts`)
- Phase 4: pattern/theme summarization, draft assist, mobile (stretch)

**Known issues:**
- Stale services: `one-on-one.commands.ts` and `goal.commands.ts` construct their services once at registration; a settings change mid-session leaves them stale (person.commands.ts correctly builds per invocation)
- `OneOnOneService.listActivePeople()` and `GoalService.listPersonNames()` are now unused (pickers consolidated onto `PersonService.listPeople()`) — candidates for retirement
- Carry-forward heading `### Carried forward from <date>` is a literal in `one-on-one.service.ts`, not a template slot — accepted as generated dynamic content
- Overdue threshold hardcoded at 21 days (`OVERDUE_THRESHOLD_DAYS` exported, not yet a setting)
- No lint setup (`npm run lint` does not exist)
- AI is disabled by default (`ollamaModel: ''`) — the prep command exits with a setup hint until a model is configured
- A goal note with corrupted status frontmatter surfaces as a Notice in the prep flow rather than being skipped (GoalService's loud-corruption contract)
- Open questions from PRD §10: mood/pulse capture format (currently an empty-string frontmatter slot), shared vs per-feature Ollama model (single shared model shipped), person-summary export, passive vs active reminders, visibility toggles

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Creating or changing note types, frontmatter, or folder conventions | `context/data-model.md` |
| Working on any AI feature or the Ollama integration | `context/ollama.md` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it.
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. Read `mex logging --json` before optional `mex log` notes: `significant` records material rationale, `checkpoints` batches useful notes at task/session boundaries, and `manual` avoids unsolicited notes. Honor explicit user log requests in every mode; mandatory workflow Activity and recovery audits remain required.
