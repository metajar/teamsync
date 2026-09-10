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
- `model` — dropdown populated from the server's `/api/tags`
- temperature / context-size settings
[TO BE DETERMINED — PRD open question: single shared model vs per-feature model selection (e.g. smaller/faster for prep briefs, larger for pattern synthesis). Default to a single shared model until decided.]

## Endpoints
- `GET /api/tags` — list installed models (populates the model dropdown)
- `/api/generate` or `/api/chat` — generation. [VERIFY AFTER FIRST IMPLEMENTATION — pick one; `/api/chat` if we want structured multi-turn, `/api/generate` for one-shot with a formatted prompt]

## Planned Features (Phase 3–4)
1. **Prep for 1:1** — send last N 1:1 notes + open goals + dev plan as context; get back a structured brief: talking points, open action items, follow-ups on past concerns, goal check-in prompts.
2. **Summarize patterns** — themes/blockers/sentiment across a date range for one person or the team.
3. **Draft assist** (optional) — rough notes → structured summary; free text → drafted action items.

## Transparency & Trust Rules
- Before any send, show a preview of exactly what note content will be sent, with a clear UI indicator that an AI feature is about to transmit content to the model.
- AI output is a draft, not a source of truth — frame it as such in the UI and always cite which notes it drew from.

## Context Assembly
Prep-brief context is gathered via the service layer (OneOnOneService, GoalService, DevPlanService) — OllamaClient never reads the vault itself. [VERIFY AFTER FIRST IMPLEMENTATION — token budgeting: how many notes/what truncation fits the model's context window]
