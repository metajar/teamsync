# TeamSync Foundation Contracts

Exact contracts for feature agents (Person, One-on-One, Goals, Integration).
These are frozen; if you must change a signature, coordinate — three agents
build against them in parallel.

## Settings — `src/settings.ts`

```typescript
export interface TeamSyncSettings {
  rootFolder: string;        // default "Team"
  oneOnOnesFolder: string;   // default "1-on-1s"
  goalsFolder: string;       // default "Goals"
  personIndexFile: string;   // default "_index.md"
  topicsFile: string;        // default "topics.md"
  devPlanFile: string;       // default "Development-Plan.md"
}
export const DEFAULT_SETTINGS: TeamSyncSettings;
export class TeamSyncSettingTab extends PluginSettingTab { /* already registered by the plugin */ }
```

Access live settings via `plugin.settings`. Persist changes with
`await plugin.saveSettings()`.

## Plugin — `src/plugin.ts` (default export, re-exported by `main.ts`)

```typescript
export default class TeamSyncPlugin extends Plugin {
  settings: TeamSyncSettings;
  loadSettings(): Promise<void>;
  saveSettings(): Promise<void>;
}
```

`src/plugin.ts` has TODO markers in `onload()` — the integration agent adds
the `register<Entity>Commands(this)` calls there.

## Paths — `src/paths.ts`

```typescript
export function joinPath(...segments: string[]): string;
export function personFolder(settings: TeamSyncSettings, personName: string): string;   // Team/Jane Doe
export function oneOnOneFolder(settings: TeamSyncSettings, personName: string): string; // Team/Jane Doe/1-on-1s
export function goalsFolder(settings: TeamSyncSettings, personName: string): string;    // Team/Jane Doe/Goals
export function personIndexPath(settings: TeamSyncSettings, personName: string): string;// Team/Jane Doe/_index.md
export function topicsPath(settings: TeamSyncSettings, personName: string): string;    // Team/Jane Doe/topics.md
export function devPlanPath(settings: TeamSyncSettings, personName: string): string;    // Team/Jane Doe/Development-Plan.md
```

All paths are slash-normalized with no leading/trailing slash. **Feature code
must never contain a literal vault path** — always these helpers.

## Template engine — `src/template-engine.ts`

```typescript
export function renderTemplate(
  template: string,
  values: Record<string, string | undefined>,
): string;
```

`{{name}}` / `{{ name }}` substitution. Missing or `undefined` values resolve
to `""`. Non-identifier braces are left untouched. Services never hardcode
note bodies — load the template, fill it with this, write the result.

## Frontmatter — `src/frontmatter.ts` (pure, no obsidian import)

```typescript
export type FrontmatterValue = string | number | string[];
export type Frontmatter = Record<string, FrontmatterValue>;
export function splitFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
};
export function buildNote(frontmatter: Frontmatter, body: string): string;
```

Envelope: `buildNote(fm, body)` produces `---\n<yaml>---\n<body>` — body is
verbatim, so pass a leading `\n` for a blank line after the fence.
Round-trip safe for string/number/string[] under snake_case keys. ISO dates
(`YYYY-MM-DD`) and numbers survive unquoted; strings that would coerce
(numbers, dates, `true`/`false`) or that contain YAML-special characters are
single-quoted automatically. Not supported: nested maps, booleans, multiline
scalars — do not invent fields that need them. Field sets per note type are
defined in `.mex/context/data-model.md`.

## Required feature-module shapes

### Service — `src/<entity>.service.ts`

```typescript
export class PersonService {            // e.g. person.service.ts
  constructor(vault: Vault, settings: TeamSyncSettings);
  // methods per feature spec
}
```

- No Obsidian UI imports (Notice, Modal, ItemView, Setting, …) — file/metadata
  APIs and types only.
- No hardcoded note bodies — render via `renderTemplate`.
- All file I/O lives inside the service; throw `Error` with actionable text,
  the caller surfaces it.
- Derive every path via `src/paths.ts`.

### Command module — `src/commands/<entity>.commands.ts`

```typescript
export function registerPersonCommands(plugin: TeamSyncPlugin): void;
```

- Instantiates its own service: `new PersonService(plugin.app.vault, plugin.settings)`.
- Thin callbacks: parse input (modals/suggesters) → call the service →
  `new Notice(...)` on error/success. Guard the user-cancel path.
- **Never call `vault.*` or read the metadata cache directly** from a command.
  If a rollup is needed, expose it as a service method.
- Command ids: kebab-case with a `teamsync-` prefix (e.g. `teamsync-new-one-on-one`).

## TopicService — `src/topic.service.ts`

The per-person running list of discussion topics queued for the next 1:1
(`topics.md`, `type: topics`). The bullet list in the body IS the structured
data — one of the two sanctioned body reads (see `.mex/context/data-model.md`).

```typescript
export function extractTopics(body: string): string[];   // pure parser: top-level plain bullets
export function renderDiscussionTopics(topics: string[]): string; // "### Discussion topics" + unchecked boxes
export class TopicService {
  constructor(vault: Vault, settings: TeamSyncSettings);
  addTopic(personName: string, topic: string): Promise<string[]>; // updated queue; creates note if missing
  listTopics(personName: string): Promise<string[]>;              // [] when the note is missing
  clearTopics(personName: string): Promise<void>;                 // body → fresh template, frontmatter preserved
  ensureTopicsFile(personName: string): Promise<TFile>;           // create-if-missing, for opening
}
```

Drain rule: **OneOnOneService.createOneOnOne(person, date?, discussionTopics?)**
injects topics into the agenda; the command layer drains (clearTopics) only
after the note is successfully created, so a failed create never loses the
queue. Checkbox lines in `topics.md` (`- [ ]`/`- [x]`) are deliberately not
topics — a struck topic stays in the file without being re-queued.

## Test harness — `src/testing/`

`obsidian` has no runtime module; `vitest.config.ts` aliases it to
`src/testing/obsidian-stub.ts` automatically — value imports of `obsidian`
work in any test-executed file. The stub's `Plugin` base records registered
commands in `plugin.commands` for assertions, and `Notice` stores `.message`.

```typescript
import { createMockVault, createMockMetadataCache } from "./testing/vault-mock";
// from src/<x>.service.test.ts:
import { createMockVault, createMockMetadataCache } from "./testing/vault-mock";

const vault = createMockVault();
const cache = createMockMetadataCache(vault);
```

`MockVault` (extends `Vault`) implements the surface services use:

| Call | Behavior |
|------|----------|
| `getAbstractFileByPath(path)` | `TFile` / `TFolder` (real `instanceof` works) / `null` |
| `createFolder(path)` | creates ancestors; throws if it exists |
| `create(path, content)` | throws if file exists or parent folder missing |
| `read(file)` / `cachedRead(file)` | content; throws for unknown files |
| `modify(file, data)` / `delete(file)` | throw for unknown files |
| `rename(target, newPath)` | moves files and whole folder subtrees (archive use case) |
| `getMarkdownFiles()` | all `.md` files |
| `exists(pathOrFile)` | `Promise<boolean>` |
| `adapter.mkdir(path)` | recursive, idempotent |
| `adapter.write(path, data)` | create or overwrite; parent folder must exist |
| `adapter.exists(path)` / `adapter.existsSync(path)` | folder or file |
| `getContent(path)` | test helper: raw content or `undefined` |
| `folderPaths()` | test helper: every folder path |

Not implemented: events, trash (use `delete`), `process()`.
`createMockMetadataCache(vault)` returns a `MetadataCache` whose
`getCache(path)` parses frontmatter live from the vault's current content —
no invalidation needed in tests.

## Commands

- `npm run dev` — esbuild watch
- `npm run build` — `tsc -noEmit` + production esbuild bundle
- `npm test` — `vitest run` (node env, `src/**/*.test.ts`)

## Layering rules (from `.mex/context/conventions.md` — enforced)

1. No `vault.*` call outside a service.
2. No Obsidian UI imports inside a service.
3. Structured data in frontmatter only, fixed field set per note type.
4. Notes created via the template engine, never hardcoded bodies.
5. Vault paths from settings via `src/paths.ts`, never literals.
6. No network calls at all in Phases 1–2 (Ollama is Phase 3, via a future
   `OllamaClient` only).
7. New service/pure logic covered by Vitest tests against the mock vault.
