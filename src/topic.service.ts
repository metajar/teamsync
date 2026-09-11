import { TFile } from "obsidian";
import type { Vault } from "obsidian";
import type { TeamSyncSettings } from "./settings";
import { buildNote, splitFrontmatter } from "./frontmatter";
import { topicsPath } from "./paths";
import { renderTemplate } from "./template-engine";
import { TOPICS_TEMPLATE } from "./templates/topics";

/**
 * TopicService — the per-person running list of discussion topics queued for
 * the next 1:1 (`topics.md` by default, see `topicsFile` in settings).
 *
 * All file I/O for this note type lives here; commands and views only call
 * these methods. Paths derive from settings via src/paths.ts and the note is
 * created through the template engine — never hardcoded.
 */

/**
 * Extract queued topics from a topics note body.
 *
 * One of the two sanctioned body reads in the plugin (see
 * .mex/context/data-model.md, Discussion Topics Rule — the user-facing
 * contract is a plain bullet list, so this list IS the structured data).
 * Parsing rule, deliberately parallel to extractOpenActionItems():
 *   - a line is a queued topic iff it matches `^- <text>` — a top-level
 *     plain bullet followed by non-whitespace text;
 *   - checkbox lines (`- [ ]` / `- [x]`) are NOT topics: the user can keep a
 *     struck topic in the file without it being queued again;
 *   - indented (nested) bullets, prose, non-list lines, ordered lists, and
 *     textless bullets are ignored;
 *   - matched text is trimmed and returned in document order.
 */
export function extractTopics(body: string): string[] {
	const topics: string[] = [];
	for (const line of body.split("\n")) {
		const match = line.match(/^- +(\S.*)$/);
		if (match && !line.startsWith("- [")) {
			topics.push(match[1].trim());
		}
	}
	return topics;
}

/** Render the block injected into the agenda of a new 1:1 note. */
export function renderDiscussionTopics(topics: string[]): string {
	if (topics.length === 0) {
		return "";
	}
	const lines = ["### Discussion topics"];
	for (const topic of topics) {
		// Unchecked on purpose: a topic not ticked off during the meeting
		// automatically carries forward to the next 1:1.
		lines.push(`- [ ] ${topic}`);
	}
	return lines.join("\n") + "\n";
}

export class TopicService {
	private readonly vault: Vault;
	private readonly settings: TeamSyncSettings;

	constructor(vault: Vault, settings: TeamSyncSettings) {
		this.vault = vault;
		this.settings = settings;
	}

	/**
	 * Append a topic to the person's running list, creating the note from the
	 * template if it does not exist yet. Throws on an empty topic.
	 * Returns the updated queue for caller feedback (Notice text).
	 */
	async addTopic(personName: string, rawTopic: string): Promise<string[]> {
		const topic = rawTopic.trim();
		if (topic === "") {
			throw new Error("Topic cannot be empty.");
		}

		const file = await this.ensureTopicsFile(personName);
		const { frontmatter, body } = splitFrontmatter(await this.vault.read(file));
		const separator = body.endsWith("\n") || body === "" ? "" : "\n";
		await this.vault.modify(
			file,
			buildNote(frontmatter, `${body}${separator}- ${topic}\n`),
		);
		return extractTopics(`${body}${separator}- ${topic}\n`);
	}

	/**
	 * Queued topics for the person in document order; [] when the note does
	 * not exist (nothing queued yet).
	 */
	async listTopics(personName: string): Promise<string[]> {
		const file = this.topicsFileAt(personName);
		if (!file) {
			return [];
		}
		return extractTopics(splitFrontmatter(await this.vault.read(file)).body);
	}

	/**
	 * Empty the person's running list after its topics were moved into a
	 * created 1:1 note. Only the body is rewritten (to the fresh template) —
	 * frontmatter is preserved verbatim. A no-op when the note is missing.
	 */
	async clearTopics(personName: string): Promise<void> {
		const file = this.topicsFileAt(personName);
		if (!file) {
			return;
		}
		const { frontmatter } = splitFrontmatter(await this.vault.read(file));
		const body = renderTemplate(TOPICS_TEMPLATE, { person: personName });
		await this.vault.modify(file, buildNote(frontmatter, `\n${body}`));
	}

	/**
	 * The topics note as a TFile, creating it from the template when missing
	 * (person folder included). Returned so commands can open it without
	 * touching the vault.
	 */
	async ensureTopicsFile(personName: string): Promise<TFile> {
		const path = topicsPath(this.settings, personName);
		const existing = this.topicsFileAt(personName);
		if (existing) {
			return existing;
		}
		await this.vault.adapter.mkdir(path.slice(0, path.lastIndexOf("/")));
		const body = renderTemplate(TOPICS_TEMPLATE, { person: personName });
		return this.vault.create(
			path,
			buildNote({ type: "topics", person: personName }, `\n${body}`),
		);
	}

	private topicsFileAt(personName: string): TFile | null {
		const file = this.vault.getAbstractFileByPath(
			topicsPath(this.settings, personName),
		);
		return file instanceof TFile ? file : null;
	}
}
