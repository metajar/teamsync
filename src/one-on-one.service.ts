import { TFile, TFolder } from "obsidian";
import type { Vault } from "obsidian";
import type { TeamSyncSettings } from "./settings";
import { buildNote, splitFrontmatter } from "./frontmatter";
import { joinPath, oneOnOneFolder, personIndexPath } from "./paths";
import { renderTemplate } from "./template-engine";
import { ONE_ON_ONE_TEMPLATE } from "./templates/one-on-one";

/**
 * OneOnOneService — creation, listing, and carry-forward for 1:1 notes.
 *
 * All file I/O for this note type lives here; commands and views only call
 * these methods. Paths derive from settings via src/paths.ts and bodies are
 * rendered through the template engine — never hardcoded.
 */

/** A 1:1 note as seen by callers: the file plus the frontmatter that matters. */
export interface OneOnOneNote {
	file: TFile;
	/** ISO date from frontmatter (never inferred from the filename). */
	date: string;
	/** `action_items_open` from frontmatter, 0 when absent. */
	actionItemsOpen: number;
}

/**
 * Extract open action items from a 1:1 note body.
 *
 * THE ONLY SANCTIONED BODY READ in the plugin (see .mex/context/data-model.md,
 * Carry-Forward Rule). Parsing rule:
 *   - a line is an open action item iff it matches `^- [ ] <text>` — a
 *     top-level list item with an empty checkbox followed by non-whitespace
 *     text;
 *   - `- [x]` / `- [X]` (done), indented checkboxes (nested-list noise —
 *     sub-items belong to their parent), prose lines, non-list lines, and
 *     textless checkboxes are all ignored;
 *   - matched text is trimmed and returned in document order.
 */
export function extractOpenActionItems(body: string): string[] {
	const items: string[] = [];
	for (const line of body.split("\n")) {
		const match = line.match(/^- \[ \] +(\S.*)$/);
		if (match) {
			items.push(match[1].trim());
		}
	}
	return items;
}

/** Render the block injected into the agenda of the next note. */
function renderCarriedForward(fromDate: string, items: string[]): string {
	if (items.length === 0) {
		return "";
	}
	const lines = [`### Carried forward from ${fromDate}`];
	for (const item of items) {
		lines.push(`- [ ] ${item}`);
	}
	return lines.join("\n") + "\n";
}

/** Local-timezone ISO date (YYYY-MM-DD) for "today". */
function todayISO(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

export class OneOnOneService {
	private readonly vault: Vault;
	private readonly settings: TeamSyncSettings;

	constructor(vault: Vault, settings: TeamSyncSettings) {
		this.vault = vault;
		this.settings = settings;
	}

	/**
	 * Create today's (or `date`'s) 1:1 note for a person, carrying forward any
	 * open action items from their most recent existing note. Same-day
	 * collisions get a `-2`, `-3`, … filename suffix — existing notes are
	 * never overwritten. Returns the created file so the caller can open it.
	 */
	async createOneOnOne(personName: string, date?: string): Promise<TFile> {
		const noteDate = date ?? todayISO();
		const folder = oneOnOneFolder(this.settings, personName);
		await this.vault.adapter.mkdir(folder);

		const latest = await this.getLatestOneOnOne(personName);
		let carriedBlock = "";
		let carriedCount = 0;
		if (latest) {
			const items = extractOpenActionItems(
				splitFrontmatter(await this.vault.read(latest.file)).body,
			);
			carriedCount = items.length;
			carriedBlock = renderCarriedForward(latest.date, items);
		}

		const path = this.findAvailablePath(folder, noteDate);
		const body = renderTemplate(ONE_ON_ONE_TEMPLATE, {
			person: personName,
			date: noteDate,
			carried_forward: carriedBlock,
		});
		const content = buildNote(
			{
				type: "one-on-one",
				person: personName,
				date: noteDate,
				mood: "", // placeholder slot — the user fills it in (open PRD question)
				action_items_open: carriedCount,
			},
			`\n${body}`,
		);
		return this.vault.create(path, content);
	}

	/** All 1:1 notes for a person, chronological by frontmatter date. */
	async listOneOnOnes(personName: string): Promise<OneOnOneNote[]> {
		return this.listOneOnOneNotes(personName);
	}

	/** The person's most recent 1:1 note by frontmatter date, or null. */
	async getLatestOneOnOne(personName: string): Promise<OneOnOneNote | null> {
		const notes = await this.listOneOnOneNotes(personName);
		return notes.length > 0 ? notes[notes.length - 1] : null;
	}

	/**
	 * Open action items in the person's most recent note (live checkbox scan,
	 * not the cached frontmatter count). Use to recompute
	 * `action_items_open` — this method never rewrites existing notes.
	 */
	async countOpenActionItems(personName: string): Promise<number> {
		const latest = await this.getLatestOneOnOne(personName);
		if (!latest) {
			return 0;
		}
		const body = splitFrontmatter(await this.vault.read(latest.file)).body;
		return extractOpenActionItems(body).length;
	}

	/**
	 * Full body (frontmatter stripped) of a listed 1:1 note — the sanctioned
	 * read path for AI prep context, so callers never touch `vault.read`.
	 */
	async readOneOnOneBody(note: OneOnOneNote): Promise<string> {
		return splitFrontmatter(await this.vault.read(note.file)).body;
	}

	/**
	 * Append text to the end of a 1:1 note's body, preserving its frontmatter
	 * and existing body verbatim. Used by the AI draft "insert" action after
	 * the user has reviewed and edited the draft — never called unattended.
	 */
	async appendToOneOnOne(file: TFile, addition: string): Promise<void> {
		const { frontmatter, body } = splitFrontmatter(await this.vault.read(file));
		const separator = body.endsWith("\n") || body === "" ? "" : "\n";
		await this.vault.modify(
			file,
			buildNote(frontmatter, `${body}${separator}${addition.trim()}\n`),
		);
	}

	/**
	 * Names of people under the root folder with a person `_index.md` that is
	 * not archived. Shared-shape helper so the command's suggest modal stays
	 * free of vault access; the integrator may consolidate with
	 * PersonService.listPeople later.
	 */
	async listActivePeople(): Promise<string[]> {
		const root = this.vault.getAbstractFileByPath(
			joinPath(this.settings.rootFolder),
		);
		if (!(root instanceof TFolder)) {
			return [];
		}
		const people: string[] = [];
		for (const child of root.children) {
			if (!(child instanceof TFolder)) {
				continue;
			}
			const indexFile = this.vault.getAbstractFileByPath(
				personIndexPath(this.settings, child.name),
			);
			if (!(indexFile instanceof TFile)) {
				continue;
			}
			const { frontmatter } = splitFrontmatter(await this.vault.read(indexFile));
			if (frontmatter.type !== undefined && frontmatter.type !== "person") {
				continue;
			}
			if (frontmatter.status === "archived") {
				continue;
			}
			people.push(child.name);
		}
		return people.sort((a, b) => a.localeCompare(b));
	}

	/** First non-existing path in `<date>.md`, `<date>-2.md`, `<date>-3.md`, … */
	private findAvailablePath(folder: string, date: string): string {
		for (let suffix = 1; suffix <= 100; suffix++) {
			const name = suffix === 1 ? `${date}.md` : `${date}-${suffix}.md`;
			const path = joinPath(folder, name);
			if (this.vault.getAbstractFileByPath(path) === null) {
				return path;
			}
		}
		throw new Error(
			`More than 100 1:1 notes already exist for ${date} — refusing to create another.`,
		);
	}

	/** Scan the person's 1:1 folder, keep typed notes, sort chronologically. */
	private async listOneOnOneNotes(personName: string): Promise<OneOnOneNote[]> {
		const folder = oneOnOneFolder(this.settings, personName);
		const folderObj = this.vault.getAbstractFileByPath(folder);
		if (!(folderObj instanceof TFolder)) {
			return [];
		}
		const notes: OneOnOneNote[] = [];
		for (const child of folderObj.children) {
			if (!(child instanceof TFile) || child.extension !== "md") {
				continue;
			}
			const { frontmatter } = splitFrontmatter(await this.vault.read(child));
			if (frontmatter.type !== "one-on-one") {
				continue;
			}
			notes.push({
				file: child,
				date: typeof frontmatter.date === "string" ? frontmatter.date : "",
				actionItemsOpen:
					typeof frontmatter.action_items_open === "number"
						? frontmatter.action_items_open
						: 0,
			});
		}
		notes.sort((a, b) => {
			if (a.date !== b.date) {
				return a.date < b.date ? -1 : 1;
			}
			// Same frontmatter date (a suffixed same-day note): creation order.
			return a.file.stat.ctime - b.file.stat.ctime;
		});
		return notes;
	}
}
