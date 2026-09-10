# TeamSync

An Obsidian plugin that helps engineering managers run one-on-ones, track goals, and manage development plans for their direct reports — all inside your existing vault, as plain markdown. Optional local-AI assistance via Ollama is planned but not yet included; the current release is fully offline.

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

The ribbon icon (two people) also opens the team dashboard.

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

- No network calls, no telemetry, no analytics. Core features work fully offline.
- Future AI features will call only a locally-configured Ollama endpoint, with a preview of any content before it is sent.
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
