---
name: ollama-feature
description: Adding any AI-assisted feature that calls the local Ollama server — context assembly, send preview, generation, graceful degradation.
triggers:
  - "ai feature"
  - "prep brief"
  - "ollama feature"
  - "summarize patterns"
  - "draft assist"
  - "ai button"
edges:
  - target: context/ollama.md
    condition: the boundary rules, endpoints, and transparency requirements
  - target: context/architecture.md
    condition: where the AI path sits relative to services and views
  - target: context/decisions.md
    condition: if the feature tempts a cloud-API or env-var shortcut — both decided against
grounds_to: []
last_updated: 2026-09-10
mex:
  id: mx_01M24JPJ17GQBW3AXJ3811NKCM
  type: pattern
  status: promoted
  revision: 2
  title: ollama-feature
  relations:
    - type: related_to
      target: mx_01M24JPHNGVN5Z0VG5AW508QY0
      note: where the AI path sits relative to services and views
---

# Add an AI (Ollama) Feature

## Context
Load `context/ollama.md` first — it defines the boundary rules (OllamaClient only, graceful degradation, send preview). AI features are Phase 3–4 of the roadmap; everything here is optional-by-design.

[No code exists yet — ground symbols here after first implementation.]

## Steps
1. Gather context via the service layer (OneOnOneService, GoalService, DevPlanService) — OllamaClient never reads the vault itself.
2. Build the prompt payload (last N notes, open goals, dev plan; truncate to the model's context budget).
3. Show a preview of exactly what will be sent, with a clear "this transmits note content to the model" indicator. User confirms before any send.
4. Call OllamaClient (shared timeout/error wrapper) — never `fetch` directly from a view or service.
5. Render the result as an editable draft — never write AI output directly into a note without user review.
6. Handle the failure path explicitly: Ollama unreachable/disabled/timed out → Notice with the error, feature exits cleanly, no note corruption, no blocked core flow.

## Gotchas
- Skipping the send preview violates a non-negotiable — even for "harmless" re-summarizes of content already sent this session.
- Do not gate any core feature on an AI call succeeding; AI failures must be non-blocking by construction.
- Frame all output as a draft and cite which notes it drew from — local model quality varies (PRD risk).
- Model dropdown comes from `/api/tags` at settings time; don't assume a model exists client-side.
- Single shared model for now — per-feature model selection is an open PRD question; don't build the per-feature plumbing before it's decided.

## Verify
- [ ] All AI traffic goes through OllamaClient — no direct `fetch` to the AI server elsewhere
- [ ] Send preview shown and confirmed before transmission
- [ ] Unreachable/disabled/timed-out Ollama leaves core features fully working
- [ ] AI output lands as an editable draft with source citations, never an auto-write
- [ ] No third-party endpoint is touched, even on error/fallback paths

## Debug
- "Model not found" → `/api/tags` lists installed models; the configured model may have been removed server-side — refresh the dropdown and surface a clear message.
- Timeouts → check the shared OllamaClient timeout setting; large contexts (years of notes) may need truncation, not a longer timeout.
- Empty/useless brief → inspect the assembled context (log it in dev); usually too few notes or over-truncation, not a model bug.
- CORS/connection refused from the vault → confirm `ollamaUrl` setting and that the server listens on that interface. [VERIFY AFTER FIRST IMPLEMENTATION — whether `fetch` or Obsidian `requestUrl` is needed]

## Update Scaffold
- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update `context/ollama.md` Planned Features with what shipped and any new gotchas
