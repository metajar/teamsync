import { TFile, TFolder } from "obsidian";
import type { MetadataCache, Vault } from "obsidian";
import { buildNote, splitFrontmatter, type Frontmatter } from "./frontmatter";
import {
	devPlanPath,
	goalsFolder,
	oneOnOneFolder,
	personFolder,
} from "./paths";
import type { TeamSyncSettings } from "./settings";
import { renderTemplate } from "./template-engine";
import { DEV_PLAN_TEMPLATE } from "./templates/dev-plan";

/**
 * DevPlanService — all file I/O for development plan notes. One evolving
 * note per person at `<rootFolder>/<Person>/<devPlanFile>`, structured data
 * in frontmatter only (see .mex/context/data-model.md, note type
 * `dev-plan`). Never deletes, moves, or renames anything.
 */

/** A development plan as read back from the vault. */
export interface DevPlanRecord {
	person: string;
	/** `last_reviewed` from frontmatter; undefined when the field is absent. */
	lastReviewed: string | undefined;
	/** Vault path of the plan note. */
	path: string;
	file: TFile;
}

export class DevPlanService {
	constructor(
		private readonly vault: Vault,
		private readonly settings: TeamSyncSettings,
		private readonly metadataCache?: MetadataCache,
	) {}

	/**
	 * Scaffold the person's development plan from the template. Idempotent
	 * guard: throws a clear "already exists" error when the note is present
	 * (the caller turns it into a Notice) — existing plans are never
	 * overwritten. A brand-new plan counts as reviewed today, so
	 * `last_reviewed` starts at today's date. Throws for an unknown person.
	 */
	async createDevPlan(personName: string): Promise<TFile> {
		const name = this.validateName(personName);
		this.requirePersonFolder(name);

		const path = devPlanPath(this.settings, name);
		if (this.vault.getAbstractFileByPath(path) !== null) {
			throw new Error(
				`A development plan for "${name}" already exists (${path}). ` +
					"Open it instead of creating a new one.",
			);
		}

		const today = todayISO();
		const frontmatter: Frontmatter = {
			type: "dev-plan",
			person: name,
			last_reviewed: today,
		};
		const body = renderTemplate(DEV_PLAN_TEMPLATE, {
			person: name,
			last_reviewed: today,
			goals_link: goalsFolder(this.settings, name),
			one_on_ones_link: oneOnOneFolder(this.settings, name),
		});
		return this.vault.create(path, buildNote(frontmatter, `\n${body}`));
	}

	/**
	 * The person's development plan, or undefined when they have none.
	 * Reads through the metadata cache when one was supplied; otherwise via
	 * cachedRead, still parsing only the frontmatter block. Throws for an
	 * unknown person.
	 */
	async getDevPlan(personName: string): Promise<DevPlanRecord | undefined> {
		const name = this.validateName(personName);
		this.requirePersonFolder(name);

		const path = devPlanPath(this.settings, name);
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return undefined;
		}
		const frontmatter = await this.frontmatterOf(file);
		return {
			person: name,
			lastReviewed:
				frontmatter.last_reviewed === undefined
					? undefined
					: String(frontmatter.last_reviewed),
			path,
			file,
		};
	}

	/**
	 * Mark the plan reviewed today: rewrites ONLY `last_reviewed` in the
	 * frontmatter (every other field and the body round-trip byte-for-byte,
	 * same discipline as GoalService.updateStatus) and appends a
	 * `- YYYY-MM-DD — reviewed` line to the revision-log section in the body.
	 * A missing revision-log section never fails the operation — the line is
	 * appended at the end of the body instead. Throws for an unknown person,
	 * a missing plan, or a note at the plan path that is not a `dev-plan`.
	 */
	async markReviewed(personName: string): Promise<TFile> {
		const name = this.validateName(personName);
		this.requirePersonFolder(name);

		const path = devPlanPath(this.settings, name);
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(
				`No development plan for "${name}" at ${path} — create one first.`,
			);
		}
		const { frontmatter, body } = splitFrontmatter(await this.vault.read(file));
		if (frontmatter.type !== "dev-plan") {
			throw new Error(
				`Not a development plan (type: ${String(frontmatter.type)}): ${path}`,
			);
		}

		const today = todayISO();
		// Spread keeps existing key order; the assignment replaces the one
		// line in place, so every other frontmatter line round-trips as-is.
		// A same-day repeat only rewrites frontmatter — no duplicate log line.
		const newBody = body.includes(`- ${today} — reviewed`)
			? body
			: appendToRevisionLog(body, `- ${today} — reviewed`);
		await this.vault.modify(
			file,
			buildNote({ ...frontmatter, last_reviewed: today }, newBody),
		);
		return file;
	}

	/** Trim; reject empty names and names that would break folder paths. */
	private validateName(raw: string): string {
		const name = raw.trim();
		if (name === "") {
			throw new Error("Team member name cannot be empty.");
		}
		if (name.includes("/")) {
			throw new Error(`Team member name cannot contain "/": "${name}".`);
		}
		return name;
	}

	/** Throw unless the person's folder exists under the root folder. */
	private requirePersonFolder(personName: string): void {
		const folder = this.vault.getAbstractFileByPath(
			personFolder(this.settings, personName),
		);
		if (!(folder instanceof TFolder)) {
			throw new Error(
				`Unknown person "${personName}" — no folder at ` +
					`${personFolder(this.settings, personName)}. Create the person first.`,
			);
		}
	}

	/** Frontmatter via the cache when available, else cachedRead + split. */
	private async frontmatterOf(file: TFile): Promise<Frontmatter> {
		if (this.metadataCache) {
			return (this.metadataCache.getCache(file.path)?.frontmatter ??
				{}) as Frontmatter;
		}
		return splitFrontmatter(await this.vault.cachedRead(file)).frontmatter;
	}
}

/** The heading markReviewed locates (and appends review lines below). */
const REVISION_LOG_HEADING = /^##\s+Revision log\s*$/;

/**
 * Insert `line` as the last entry of the `## Revision log` section. When the
 * section is missing the line is appended at the end of the body — a missing
 * heading (hand-edited note, older template) never fails the review write.
 */
function appendToRevisionLog(body: string, line: string): string {
	const lines = body.split("\n");
	const headingIndex = lines.findIndex((l) => REVISION_LOG_HEADING.test(l));
	if (headingIndex === -1) {
		const separator = body === "" || body.endsWith("\n") ? "" : "\n";
		return `${body}${separator}${line}\n`;
	}

	// The section runs until the next heading of any level, or the body end.
	let sectionEnd = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		if (/^#{1,6}\s/.test(lines[i])) {
			sectionEnd = i;
			break;
		}
	}
	// Insert after the section's last non-blank line, keeping its spacing.
	let insertAt = sectionEnd;
	while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") {
		insertAt--;
	}
	lines.splice(insertAt, 0, line);
	return lines.join("\n");
}

/** Local-timezone ISO date (YYYY-MM-DD) for "today" — matches the services. */
function todayISO(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}
