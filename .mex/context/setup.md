---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/architecture.md
    condition: when understanding how components connect during setup
  - target: context/ollama.md
    condition: when setting up or troubleshooting the Ollama connection
# Ground only setup behavior implemented by specific code symbols.
# Entry shape: { node: "function:<tier-1-id>", fingerprint: "mh:64:<hex>" }
grounds_to: []
last_updated: 2026-09-10
mex:
  id: mx_01M24JPHYVDGPTJ14F5AE60SVE
  type: guide
  status: promoted
  revision: 2
  title: setup
  relations:
    - type: related_to
      target: mx_01M24JPHNGVN5Z0VG5AW508QY0
      note: when understanding how components connect during setup
---

# Setup

<!-- Commands and environment facts need no code grounding. For a concrete symbol:
```markdown
[`someFunction()`](mex://function:<tier-1-id>)
```
-->

<!-- mex:entity
id: mx_01M24JPHY7HTCQF1W1E5SQ4S1B
type: guide
status: promoted
revision: 1
-->
## Prerequisites
- Node.js 20+ and npm. [VERIFY AFTER FIRST IMPLEMENTATION]
- Obsidian desktop (development vault for testing the plugin).
- Ollama server (optional) — only needed for AI features; default endpoint `http://localhost:11434`.

<!-- mex:entity
id: mx_01M24JPHXJA0Y43VAHYWSNYKJK
type: guide
status: promoted
revision: 1
-->
## First-time Setup
1. `npm install`
2. `npm run dev` — esbuild watch build
3. Enable the plugin in a development vault (copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/teamsync/`, or use BRAT with a local path)

## Environment Variables
None. All configuration lives in Obsidian plugin settings (Ollama URL, model, temperature/context, folder paths, templates) — deliberately, so users never touch env vars. Do not add env-var-based config without recording a decision in `context/decisions.md`.

<!-- mex:entity
id: mx_01M24JPHWYQD34797XMQ4GRV2K
type: guide
status: promoted
revision: 1
-->
## Common Commands
- `npm run dev` — esbuild watch build for local vault testing
- `npm run build` — tsc typecheck + production build
- `npm test` — Vitest suite (113 tests as of 2026-09-10)
- `npm run lint` — does not exist yet; pick an ESLint config if linting is wanted

## Common Issues
- Vitest aliases `obsidian` to `src/testing/obsidian-stub.ts` — tests never load the real module; if a test fails on an Obsidian API, check the stub first.
- Vault mock gotcha: `adapter.mkdir` registers folder paths but materializes `TFolder` objects lazily — tests relying on `folder.children` must poke each path once after mkdir (see `setup()` in `src/goal.service.test.ts`).
