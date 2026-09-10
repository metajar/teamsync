---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
  - target: context/ollama.md
    condition: when a decision relates to the AI boundary and privacy rules
# Decisions usually ground sparsely; add only symbols that implement the decision.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh:64:<hex>" }
grounds_to: []
last_updated: 2026-09-10
---

# Decisions

<!-- If a decision names its concrete implementation point, link it as below;
     do not anchor vague concepts:
```markdown
[`someFunction()`](mex://function:<tier-1-id>)
```
-->

<!-- HOW TO USE THIS FILE:
     Each decision follows the format below.
     When a decision changes: DO NOT delete the old entry.
     Mark it as superseded, add the new entry above it.
     The history must be preserved — this is the event clock. -->

## Decision Log

<!-- mex:entity
id: mx_01M24JPHW8N5T4M1XP0S93G43G
type: decision
status: promoted
revision: 1
-->
### Vault is the database — plain markdown + YAML frontmatter, no SQLite/IndexedDB
**Date:** 2026-09-10 (setup; pre-implementation)
**Status:** Active
**Decision:** All persistent data lives as markdown notes with YAML frontmatter inside the user's vault; there is no separate datastore.
**Reasoning:** Portability and longevity — the vault remains fully readable without the plugin, and Dataview-style queries come free for users who want them.
**Alternatives considered:** SQLite via Obsidian's mobile-capable API (rejected — proprietary-ish data island, breaks portability), IndexedDB (rejected — cache-like, lossy risk), a JSON blob file (rejected — not human-readable, no Dataview compatibility).
**Consequences:** Ad-hoc querying is slower at scale; mitigate by reading via Obsidian's metadata cache rather than re-parsing files. Dashboards must stay fast with 12 people × years of history.

<!-- mex:entity
id: mx_01M24JPHVHF6NPQKS8BR96642R
type: decision
status: promoted
revision: 1
-->
### Local Ollama only — no cloud LLM APIs
**Date:** 2026-09-10 (setup; pre-implementation)
**Status:** Active
**Decision:** All AI features call a user-configured Ollama server; no OpenAI/Anthropic/etc. calls exist in the codebase.
**Reasoning:** 1:1 and performance data is HR-adjacent and sensitive; a local (or private-network) model keeps it off third-party clouds. This is a product-level privacy promise, not just a preference.
**Alternatives considered:** Cloud APIs with opt-in consent (rejected — undermines the core privacy positioning), no AI at all (rejected — AI prep/summary is a stated product goal).
**Consequences:** Local model quality varies; AI output must be framed as a draft and cite the notes it drew from. Every AI feature must degrade gracefully when Ollama is unreachable, and show a preview of outbound content before sending.

<!-- mex:entity
id: mx_01M24JPHTVF0MEYCJGQ23X3SK0
type: decision
status: promoted
revision: 1
-->
### Obsidian plugin, not a standalone app
**Date:** 2026-09-10 (setup; pre-implementation)
**Status:** Active
**Decision:** Build as an Obsidian desktop plugin (single-manager vault) rather than a standalone web/desktop app or another platform's extension.
**Reasoning:** The target user already lives in Obsidian; local-first markdown storage, portability, and extensibility come for free, and no new sync story is needed.
**Alternatives considered:** Standalone Electron/web app (rejected — rebuilds vault, editor, and sync for no gain), Notion/Slack extensions (rejected — data lives in third-party clouds).
**Consequences:** Bound to the Obsidian API's capabilities; mobile support is a stretch goal, not a v1 commitment.

<!-- mex:entity
id: mx_01M24JPHT4177GZ64ZEKGM8YB2
type: decision
status: promoted
revision: 1
-->
### Minimal dependencies — hand-rolled templating and Ollama HTTP client
**Date:** 2026-09-10 (setup; pre-implementation)
**Status:** Active
**Decision:** No template engine and no Ollama SDK; use a minimal hand-rolled `{{placeholder}}` substituter and a thin HTTP client, with `obsidian` as the only runtime dependency.
**Reasoning:** Single-player project; minimum effort and minimum maintenance. The Ollama HTTP API is small enough to call directly.
**Alternatives considered:** Handlebars or similar (rejected — overkill for user-editable templates), ollama-js SDK (rejected — adds a dep for a handful of endpoints).
**Consequences:** Placeholder syntax is ours to maintain; if needs grow (conditionals, loops for action-item carry-forward), revisit deliberately and record a superseding decision here.

<!-- mex:entity
id: mx_01M24JPHSBATWYE0TEGXBJGA8Z
type: decision
status: promoted
revision: 1
-->
### Vitest for testing, targeting services and pure logic
**Date:** 2026-09-10 (setup; pre-implementation)
**Status:** Active
**Decision:** Tests are required; Vitest with a mocked Obsidian API, aimed at the service layer and pure logic (templating, frontmatter parsing, carry-forward rules).
**Reasoning:** The user requires tests; Vitest pairs cleanly with esbuild-based tooling, is fast, and avoids Jest's global config baggage. UI layers stay thin so they don't need testing.
**Alternatives considered:** Jest (rejected — heavier config for the same result), no tests (rejected — explicitly overruled by the owner).
**Consequences:** Services must be written to be testable without a running Obsidian instance — another reason to keep Obsidian UI imports out of the service layer.
