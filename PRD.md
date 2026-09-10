# PRD: Obsidian Team Management Plugin ("TeamSync" — working title)

## 1. Overview

**Product**: An Obsidian plugin that helps engineering/team managers run one-on-ones, track goals, and manage development plans for their direct reports — all inside their existing Obsidian vault, with optional local AI assistance via Ollama.

**Owner**: You (manager, single-player build — may later be shared with other managers on the team)

**Status**: Draft v1

**Target platform**: Obsidian desktop (mobile support as a stretch goal, see §9)

---

## 2. Problem Statement

Managing a team well requires consistent, structured attention: regular 1:1s, clear goals, and active development planning. Today this data is scattered — a mix of Google Docs, Slack DMs, calendar notes, and memory. There's no single place that:

- Keeps a running history of 1:1s per person
- Tracks goals and progress over time, linked back to the conversations where they were set
- Surfaces "what did we talk about last time" and "what's overdue" before you walk into a meeting
- Uses local AI to help you prep and synthesize patterns, without sending sensitive personnel data to a third-party cloud service

Obsidian is a good fit because it's local-first, markdown-based (so data is portable and future-proof), and extensible. Ollama fits because performance conversations are sensitive — a local LLM avoids sending HR-adjacent data to an external API.

---

## 3. Goals & Non-Goals

### Goals
1. Make it fast to log a 1:1 (during or immediately after the meeting).
2. Give a clear, chronological view of each report's history — 1:1s, goals, dev plan — in one place.
3. Make goal-setting and progress tracking lightweight but structured (status, target date, linked notes).
4. Support development plans as a distinct, longer-horizon artifact tied to goals and 1:1 notes.
5. Use a local Ollama model to: generate prep briefs before a 1:1, summarize themes across past notes, and draft follow-up action items.
6. Keep everything as plain markdown files so the data remains portable, greppable, and future-proof.

### Non-Goals (v1)
- Not a full HRIS or performance-review system (no formal review cycles, no compensation data).
- Not a calendar/scheduling tool (assume the manager already schedules 1:1s elsewhere; the plugin just logs and preps).
- Not multi-user/real-time collaborative (each manager runs their own vault; no shared server/sync backend beyond Obsidian's own sync).
- Not building a custom LLM — just integrating with a user-supplied local Ollama server.

---

## 4. Target User & Use Case

**Primary user**: An engineering/team manager with 3–12 direct reports who already uses Obsidian and wants a private, structured system for people management.

**Core use case flow**:
1. Manager adds each direct report as a "person" in the plugin.
2. Before a 1:1, manager opens the person's dashboard, hits "Prep with AI," and gets a brief pulling from the last N 1:1 notes, open goals, and dev plan.
3. During/after the 1:1, manager logs notes using a structured template (talking points, wins, concerns, action items, mood/pulse).
4. Manager sets or updates goals during or after the conversation, linking them to the 1:1 note.
5. Periodically, manager reviews/updates development plans, checking them against recent goals and 1:1 themes.
6. Manager can ask the AI to summarize patterns ("What has this person mentioned as a blocker across the last 3 months?").

---

## 5. Feature Requirements

### 5.1 People / Team Roster
- A "Team" view listing all direct reports.
- Each person has a dedicated note (or note-folder) auto-created from a template: role, start date, manager notes, links to their 1:1 log, goals, and dev plan.
- Quick-add flow for a new team member (name → scaffolds their folder structure).
- Archive/offboard a person without deleting history.

### 5.2 One-on-One Logging
- Command: "New 1:1 note" — inserts a templated note for the selected person, dated, with sections:
  - Date, attendees
  - Agenda / talking points (carried over from unresolved items last time)
  - Notes
  - Wins / concerns
  - Action items (checkbox list, assignable to manager or report)
  - Pulse/mood tag (simple scale, optional)
- 1:1 notes are stored per-person in chronological order (e.g. `People/Jane Doe/1-on-1s/2026-09-09.md`) and linked back to the person's index note.
- A per-person timeline view showing all past 1:1s with quick preview.
- Carry-forward: incomplete action items from the last 1:1 automatically appear as agenda items in the next one.

### 5.3 Goals
- Goals are their own note type, linked to a person.
- Fields: title, description, status (Not Started / In Progress / Blocked / Done), target date, created date, linked 1:1 note(s) where it was discussed.
- A goals dashboard per person (and optionally a team-wide rollup) showing status at a glance.
- Support for nesting or grouping goals under themes/quarters (e.g. "Q3 2026 Goals").
- Simple support for OKR-style goals (objective + key results as sub-items) as an optional template, without forcing that framework.

### 5.4 Development Plans
- A single evolving "Development Plan" note per person: growth areas, skills to build, target role/level, stretch opportunities, and a log of plan revisions with dates.
- Development plans can reference/link goals and 1:1 notes as supporting evidence.
- Prompted review cadence (e.g. reminder banner if a dev plan hasn't been touched in 90 days) — configurable, not automatic scheduling.

### 5.5 Dashboards & Views
- **Team dashboard**: at-a-glance grid — last 1:1 date per person, days since last 1:1, open goals count, dev plan last-updated.
- **Person dashboard**: single-person view combining recent 1:1s, active goals, dev plan summary, and AI prep panel.
- Overdue indicators (e.g. "no 1:1 logged in 3 weeks").

### 5.6 Ollama Integration
- Settings panel to configure: Ollama server URL (default `http://localhost:11434`), model name (dropdown populated via `/api/tags`), temperature/context settings.
- **Prep for 1:1**: button/command that sends the last N 1:1 notes + open goals + dev plan (as context) to the local model and returns a structured prep brief: suggested talking points, open action items, follow-ups on past concerns, goal check-in prompts.
- **Summarize patterns**: ask the model to synthesize themes/blockers/sentiment across a date range for one person or across the team.
- **Draft assist**: optional — help turn rough meeting notes into a cleaner structured summary, or draft action items from free-text notes.
- All AI calls are local-only (to the configured Ollama server); no data leaves the machine/network the user points it to. Clear indicator in UI when an AI feature is about to send note content to the model, with a preview of what's being sent.
- Graceful degradation: every AI feature is optional and the plugin is fully usable with Ollama unreachable or disabled.

### 5.7 Templates & Customization
- All note templates (person, 1:1, goal, dev plan) are user-editable markdown templates with placeholders, so users can adapt fields to their own style.
- Configurable folder structure/paths in settings.

---

## 6. Data Model (all plain markdown + YAML frontmatter, stored in-vault)

```
/Team/
  /Jane Doe/
    _index.md            (person profile, links to sections below)
    /1-on-1s/
      2026-09-02.md
      2026-09-09.md
    /Goals/
      2026-q3-improve-code-review-turnaround.md
    Development-Plan.md
```

Frontmatter conventions (example, 1:1 note):
```yaml
---
type: one-on-one
person: Jane Doe
date: 2026-09-09
mood: 4
action_items_open: 2
---
```

Using frontmatter + a consistent folder convention allows Dataview-style queries (if the user has the Dataview plugin) and keeps everything human-readable outside the plugin too.

---

## 7. Non-Functional Requirements

- **Privacy-first**: no data leaves the local machine except to the user-configured Ollama endpoint (which may itself be local or on a private network). No telemetry, no analytics, no third-party API calls by default.
- **Offline-first**: all core (non-AI) features work with no network at all.
- **Performance**: dashboards should render quickly even with 12 people × years of 1:1 history; avoid loading entire vault into memory unnecessarily.
- **Data portability**: nothing proprietary — a user could stop using the plugin and still have fully readable markdown notes.
- **Resilience**: Ollama request failures/timeouts should fail gracefully with a clear error, never corrupt or block note creation.

---

## 8. Success Metrics (informal, since this is a personal/team tool)

- 1:1s logged consistently (e.g. ≥90% of scheduled 1:1s have a note within 24 hours).
- Time-to-prep for a 1:1 reduced (subjective: "I feel ready in under 2 minutes").
- Every active goal has a status update at least once a month.
- Development plans reviewed at least quarterly per person.

---

## 9. Phased Roadmap

**Phase 1 — MVP**
- Team roster + person notes
- 1:1 logging with template + carry-forward action items
- Basic goals (create/list/status) linked to people
- Team dashboard (last 1:1 date, open goals count)

**Phase 2 — Development & Depth**
- Development Plan note type + review reminders
- Person dashboard view
- OKR-style goal sub-items
- Configurable/custom templates

**Phase 3 — Ollama Integration**
- Settings for Ollama connection + model selection
- "Prep for 1:1" AI brief
- Data-sent preview/transparency UI

**Phase 4 — AI Depth & Polish**
- Pattern/theme summarization across time
- Draft-assist for turning rough notes into structured summaries
- Mobile-friendly views (stretch)

---

## 10. Open Questions

1. Should goals/dev plans support a lightweight approval or visibility toggle (e.g. "shared with employee") in case this vault is ever partially shared, or is this strictly manager-private?
2. Do you want a single shared Ollama model for all AI features, or per-feature model selection (e.g. a smaller/faster model for prep briefs, larger for pattern synthesis)?
3. Should the plugin support exporting a person's summary (e.g. for a performance review) as a separate formatted note/document?
4. Any preference for how "mood/pulse" tracking is captured — numeric scale, emoji, free text, or omitted entirely if it feels too clinical?
5. Should overdue/reminder indicators be passive (dashboard only) or active (Obsidian notifications)?

---

## 11. Risks

- **Sensitive data at rest**: even local-only, 1:1 and performance notes are sensitive. Recommend the user keep this vault encrypted at rest / not synced to a public cloud account, and the plugin should not encourage risky sync setups.
- **Ollama variability**: local models vary widely in quality; prep briefs and summaries should be framed as a starting draft, not a source of truth, and should always cite which notes they drew from.
- **Template rigidity**: overly rigid templates could make logging feel like a chore and reduce actual usage — keep fields optional wherever possible.
