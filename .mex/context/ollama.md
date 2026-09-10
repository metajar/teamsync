---
name: ollama
description: The Ollama integration boundary — settings, API endpoints, context assembly, transparency preview, and graceful degradation. Load when working on any AI feature.
triggers:
  - "ollama"
  - "ai"
  - "prep brief"
  - "model"
  - "summarize"
  - "draft assist"
edges:
  - target: context/architecture.md
    condition: when understanding where the AI path sits in the system
  - target: context/stack.md
    condition: when choosing HTTP client details or endpoints
  - target: patterns/ollama-feature.md
    condition: when implementing a new AI feature — the full task workflow
  - target: context/decisions.md
    condition: when the local-only AI decision is questioned or needs revising
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh:64:<hex>" }
grounds_to: []
last_updated: 2026-09-10
---

# Ollama Integration

All AI features call a user-configured Ollama server and nothing else. This is the product's core privacy promise — see the "Local Ollama only" decision in `context/decisions.md`.

## Boundary Rules
- **OllamaClient is the only module that makes AI requests.** No scattered `fetch` calls to the AI server anywhere else in the codebase.
- One shared timeout/error wrapper lives in OllamaClient so graceful degradation is enforced in one place.
- AI is entirely optional: every feature works with Ollama unreachable or disabled. An AI failure must never block note creation or corrupt data — surface a clear error and continue.

## Settings (Obsidian plugin settings, not env vars)
- `ollamaUrl` — server URL, default `http://localhost:11434`
- `ollamaModel` — default `''` (empty = AI disabled); dropdown populated from the server's `/api/tags` via the settings tab's "Test connection" button; free-text fallback when the server is unreachable or lists nothing
- `ollamaTemperature` — default 0.4
- `ollamaTimeoutMs` — default 60000
- `prepContextNotes` — how many past 1:1 notes feed the prep brief, default 5
Single shared model — the per-feature-model PRD question is still open; don't build per-feature plumbing until decided.

## Endpoints
- `GET /api/tags` — list installed models (populates the model dropdown)
- `POST /api/generate` — generation. **Decided 2026-09-10:** `/api/generate` non-streaming (`stream: false`, read `data.response`) over `/api/chat` — our prompts are one-shot and formatted, no multi-turn structure. Transport: Obsidian's `requestUrl` (bypasses renderer CORS to localhost:11434; `fetch` would need server-side CORS config). Timeout enforced in the client's shared wrapper via `Promise.race` — `requestUrl` has no abort support.

## Shipped vs Planned
1. **Prep for 1:1 — SHIPPED (2026-09-10).** `assemblePrepContext()` gathers the last `prepContextNotes` 1:1 bodies (via OneOnOneService) + open goals (GoalService) + person profile; `buildPrepPrompt()` is pure and tested. Token budgeting: each note truncated to `MAX_NOTE_CHARS = 4000` (~1k tokens; 5 notes fits small context windows). Dev-plan context is a marked TODO seam until Phase 2. Flow: `SendPreviewModal` (exact content + destination indicator, explicit confirm) → `generate` → `PrepDraftModal` (editable draft, source citations, copy or insert-into-new-1:1 via the service). Not hooked into any core flow.
2. **Summarize patterns** — Phase 4. themes/blockers/sentiment across a date range for one person or the team.
3. **Draft assist** — Phase 4 (optional). rough notes → structured summary; free text → drafted action items.

## Transparency & Trust Rules
- Before any send, show a preview of exactly what note content will be sent, with a clear UI indicator that an AI feature is about to transmit content to the model.
- AI output is a draft, not a source of truth — frame it as such in the UI and always cite which notes it drew from.

## Context Assembly
Prep-brief context is gathered via the service layer (OneOnOneService, GoalService, DevPlanService) — OllamaClient never reads the vault itself. Token budgeting: `MAX_NOTE_CHARS = 4000` per note, `prepContextNotes` (default 5) notes total — truncate rather than raising the timeout when briefs degrade.
