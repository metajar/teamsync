# TeamSync

An Obsidian plugin that helps engineering managers run one-on-ones, track goals, and manage development plans for their direct reports — all inside your existing vault, as plain markdown. Includes optional local-AI assistance via [Ollama](https://ollama.com) for 1:1 prep briefs — fully offline if you don't use it.

Your data stays plain markdown + YAML frontmatter. The vault remains fully readable and usable without the plugin.

## Installing into Obsidian

### Option 1 — Manual install from a release

1. Download `main.js`, `manifest.json`, and `styles.css` from the release (or build them yourself — see [Development](#development)).
2. In your vault, create the folder `.obsidian/plugins/teamsync/` (if it doesn't exist).
3. Copy the three files into that folder:
   ```
   <your-vault>/.obsidian/plugins/teamsync/
     main.js
     manifest.json
     styles.css
   ```
4. Restart Obsidian (or reload with `Ctrl/Cmd+P` → "Reload app without saving").
5. Open **Settings → Community plugins**, and enable **TeamSync**.

> If "Restricted mode" is on, turn it off first under **Settings → Community plugins**.

### Option 2 — BRAT (Beta Reviewers Auto-update Tool)

For installing directly from this Git repository and getting updates:

1. Install and enable the BRAT plugin from Community plugins.
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Paste this repository's GitHub URL.
4. Enable **TeamSync** in **Settings → Community plugins**.

## Using the plugin

Everything lives under a `Team/` folder in your vault (configurable in **Settings → TeamSync**).

| Command (Ctrl/Cmd+P) | What it does |
|---|---|
| **TeamSync: Add team member** | Scaffolds `Team/<Name>/` with an `_index.md` profile, `1-on-1s/` and `Goals/` folders |
| **TeamSync: New 1:1 note** | Creates a dated 1:1 note from the template; unresolved action items from the last 1:1 are carried forward into the agenda |
| **TeamSync: New goal** | Creates a goal note linked to a person, with status and optional target date |
| **TeamSync: Update goal status** | Moves a goal between `not-started` / `in-progress` / `blocked` / `done` |
| **TeamSync: Archive team member** | Marks a person archived — all their history is preserved, never deleted |
| **TeamSync: Open team dashboard** | One row per person: last 1:1 date, days since, open goals, open action items, and an overdue badge after 21 days |
| **TeamSync: Prep 1:1 with AI** | Assembles your recent 1:1 notes and open goals into a prep brief via your local Ollama server — see below |

The ribbon icon (two people) also opens the team dashboard.

## Optional: local AI (Ollama)

The plugin can call a locally-running [Ollama](https://ollama.com) server to draft a 1:1 prep brief (suggested talking points, open action items, past concerns, goal check-ins).

1. Install and start Ollama, with at least one model pulled (e.g. `ollama pull llama3`).
2. In **Settings → TeamSync → Ollama**, set the server URL (default `http://localhost:11434`), click **Test connection**, and pick a model from the dropdown.
3. Run **TeamSync: Prep 1:1 with AI**, pick a person, review the preview, and send.

How it respects your privacy:

- The **only** network destination is the Ollama URL you configure. No cloud APIs, no telemetry — on error paths too.
- Before anything is sent, a **preview shows the exact note content** about to be transmitted, and nothing goes out until you confirm.
- AI output appears as an **editable draft** with the notes it drew from cited — a starting point, never auto-written into your vault.
- Every core feature works with Ollama disabled, unreachable, or never configured.

### Data layout

```
Team/
  Jane Doe/
    _index.md            person profile
    1-on-1s/
      2026-09-09.md      one note per 1:1
    Goals/
      2026-q3-...md      one note per goal
    Development-Plan.md  (coming in a future release)
```

Structured data lives only in YAML frontmatter, so notes stay compatible with Dataview and fully greppable.

## Privacy

- No telemetry, no analytics, no cloud APIs. Core features work fully offline.
- The only network the plugin can ever make is to your locally-configured Ollama endpoint — always preceded by a content preview you confirm (see [Optional: local AI](#optional-local-ai-ollama)).
- 1:1 and performance notes are sensitive: keep the vault encrypted at rest and avoid syncing it to cloud accounts you don't control.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev     # esbuild watch build
npm run build   # typecheck + production build → main.js
npm test        # Vitest suite
```

For local testing, symlink or copy this repo into `<vault>/.obsidian/plugins/teamsync/`, enable the plugin, and keep `npm run dev` running.
