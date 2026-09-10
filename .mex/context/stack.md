---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/architecture.md
    condition: when the stack choice relates to overall system structure
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
  - target: context/ollama.md
    condition: when working with the Ollama HTTP integration specifically
# Broad inventory: ground only claims embodied by a small number of symbols.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh:64:<hex>" }
grounds_to: []
last_updated: 2026-09-10
---

# Stack

<!-- Keep grounding sparse here. For a concrete wrapper or adapter mention, use:
```markdown
[`someFunction()`](mex://function:<tier-1-id>)
```
-->

## Core Technologies
- **TypeScript** — primary language; the Obsidian plugin API is TypeScript-first.
- **Obsidian Plugin API** (`obsidian` package) — views, commands, modals, settings, vault + metadata cache.
- **esbuild** — bundler, per the official Obsidian sample plugin setup.
- **Vitest** — test runner for services and pure logic (mocked Obsidian API).
- **Vault-as-database** — plain markdown + YAML frontmatter; no separate datastore.

## Key Libraries
- **`obsidian` npm package** — the only runtime dependency; official API typings.
- **Hand-rolled template substitution** (not a template engine) — minimal `{{placeholder}}` replacement for user-editable note templates. [VERIFY AFTER FIRST IMPLEMENTATION — placeholder syntax may grow (conditionals, loops for action items)]
- **Thin HTTP client for Ollama** (not an SDK) — plain `fetch` or Obsidian `requestUrl` against `/api/tags`, `/api/generate` or `/api/chat`. [VERIFY AFTER FIRST IMPLEMENTATION — `fetch` vs `requestUrl` choice depends on CORS behavior against localhost:11434]

## What We Deliberately Do NOT Use
- No cloud AI SDKs (OpenAI/Anthropic/etc.) — local Ollama only; sensitive personnel data never leaves the user's machine/network.
- No template engines (Handlebars etc.) — hand-rolled substitution; minimum effort, minimum deps.
- No database (SQLite/IndexedDB) or ORM — the vault is the datastore.
- No telemetry, analytics, or error-reporting libraries.
- No Ollama SDK — the HTTP API is simple enough to call directly.

## Version Constraints
- As installed 2026-09-10: `obsidian` 1.13.1, `esbuild` 0.25.12, `typescript` 5.9.3, `vitest` 3.2.7. Obsidian `minAppVersion` 1.4.0 (`manifest.json`, id `teamsync`).
- obsidian@1.13 typings quirks encountered: `Vault` is a class and no longer declares `exists` (the vault mock declares it explicitly); `Plugin` declares `settings`/`onload`/`onunload`, so plugin members carry `override`.
- `{{placeholder}}` substitution has sufficed for Phase 1 needs including carry-forward (rendered as a pre-built block into a single `{{carried_forward}}` slot) — no conditionals or loops needed yet.
