import { TFile, TFolder } from "obsidian";
import type { Vault } from "obsidian";
import {
	buildNote,
	splitFrontmatter,
	type Frontmatter,
	type FrontmatterValue,
} from "./frontmatter";
import { goalsFolder, joinPath, personFolder } from "./paths";
import type { TeamSyncSettings } from "./settings";
import { renderTemplate } from "./template-engine";
import { GOAL_TEMPLATE } from "./templates/goal";

/**
 * GoalService — all file I/O for goal notes. One markdown file per goal in
 * `<rootFolder>/<Person>/<goalsFolder>/`, structured data in frontmatter
 * only (see .mex/context/data-model.md, note type `goal`).
 */

/** The only legal `status` values for a goal note. */
export const GOAL_STATUSES = [
	"not-started",
	"in-progress",
	"blocked",
	"done",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Input to createGoal. `discussedIn` accepts one link or many. */
export interface CreateGoalInput {
	title: string;
	description?: string;
	/** ISO date, `YYYY-MM-DD`. */
	targetDate?: string;
	/** 1:1 note link(s) where the goal was set — bare paths or `[[wiki links]]`. */
	discussedIn?: string | string[];
}

/** A goal note read back from the vault, with frontmatter normalized. */
export interface GoalRecord {
	path: string;
	title: string;
	status: GoalStatus;
	description?: string;
	targetDate?: string;
	createdDate?: string;
	/** Wiki-links, always a list (empty when unset). */
	discussedIn: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class GoalService {
	constructor(
		private readonly vault: Vault,
		private readonly settings: TeamSyncSettings,
	) {}

	/**
	 * Create a goal note for a person. Returns the path of the note created.
	 * Throws when the person folder does not exist, the title is missing, or
	 * targetDate is not an ISO `YYYY-MM-DD` date.
	 */
	async createGoal(personName: string, goal: CreateGoalInput): Promise<string> {
		const title = goal.title?.trim() ?? "";
		if (title === "") {
			throw new Error("Goal title is required.");
		}
		if (goal.targetDate !== undefined && !ISO_DATE.test(goal.targetDate)) {
			throw new Error(
				`Invalid target date "${goal.targetDate}" — use ISO format YYYY-MM-DD.`,
			);
		}
		this.requirePersonFolder(personName);

		const slug = slugify(title);
		if (slug === "") {
			throw new Error(
				`Goal title "${title}" has no letters or digits to build a filename from.`,
			);
		}

		const folder = goalsFolder(this.settings, personName);
		await this.vault.adapter.mkdir(folder);
		const path = joinPath(folder, `${this.unusedFileName(folder, slug)}.md`);

		const frontmatter: Frontmatter = {
			type: "goal",
			person: personName,
			title,
			status: "not-started",
			created_date: todayISO(),
		};
		if (goal.description !== undefined && goal.description !== "") {
			frontmatter.description = goal.description;
		}
		if (goal.targetDate !== undefined) {
			frontmatter.target_date = goal.targetDate;
		}
		const links = normalizeDiscussedIn(goal.discussedIn);
		if (links.length === 1) {
			frontmatter.discussed_in = links[0];
		} else if (links.length > 1) {
			frontmatter.discussed_in = links;
		}

		const body = renderTemplate(GOAL_TEMPLATE, { title, person: personName });
		await this.vault.create(path, buildNote(frontmatter, `\n${body}`));
		return path;
	}

	/**
	 * All goal notes for a person, read via frontmatter. Returns [] when the
	 * person exists but has no goals yet; throws for an unknown person or a
	 * note whose `status` is not one of GOAL_STATUSES (data corruption should
	 * be loud, not silently normalized).
	 */
	async listGoals(personName: string): Promise<GoalRecord[]> {
		this.requirePersonFolder(personName);

		const folder = this.vault.getAbstractFileByPath(
			goalsFolder(this.settings, personName),
		);
		if (!(folder instanceof TFolder)) {
			return [];
		}
		const records: GoalRecord[] = [];
		for (const child of folder.children) {
			if (!(child instanceof TFile) || child.extension !== "md") {
				continue;
			}
			const { frontmatter } = splitFrontmatter(await this.vault.read(child));
			if (frontmatter.type !== "goal") {
				continue; // stray file in the Goals folder — not ours to manage
			}
			records.push(this.toRecord(child.path, frontmatter));
		}
		return records.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** One goal note by path. Throws if the path is missing or not a goal. */
	async getGoal(path: string): Promise<GoalRecord> {
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`Goal note does not exist: ${path}`);
		}
		const { frontmatter } = splitFrontmatter(await this.vault.read(file));
		if (frontmatter.type !== "goal") {
			throw new Error(`Not a goal note (type: ${String(frontmatter.type)}): ${path}`);
		}
		return this.toRecord(path, frontmatter);
	}

	/**
	 * Rewrite ONLY the `status` field, preserving every other frontmatter
	 * field and the body verbatim. Throws for a status outside GOAL_STATUSES
	 * or a missing/invalid goal note; the note is left untouched on throw.
	 */
	async updateStatus(goalPath: string, status: string): Promise<void> {
		assertGoalStatus(status);
		const file = this.vault.getAbstractFileByPath(goalPath);
		if (!(file instanceof TFile)) {
			throw new Error(`Goal note does not exist: ${goalPath}`);
		}
		const content = await this.vault.read(file);
		const { frontmatter, body } = splitFrontmatter(content);
		if (frontmatter.type !== "goal") {
			throw new Error(`Not a goal note (type: ${String(frontmatter.type)}): ${goalPath}`);
		}
		// Spread keeps existing key order; the status assignment replaces the
		// one line in place, so every other line round-trips byte-for-byte.
		await this.vault.modify(
			file,
			buildNote({ ...frontmatter, status }, body),
		);
	}

	/** Count of the person's goals that are not `done` — dashboard rollup. */
	async openGoalCount(personName: string): Promise<number> {
		const goals = await this.listGoals(personName);
		return goals.filter((goal) => goal.status !== "done").length;
	}

	/**
	 * Names of every person folder under the root folder (sorted). Feeds the
	 * person-picker in goal commands so they never touch the vault directly.
	 */
	async listPersonNames(): Promise<string[]> {
		const root = this.vault.getAbstractFileByPath(this.settings.rootFolder);
		if (!(root instanceof TFolder)) {
			return [];
		}
		return root.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.map((child) => child.name)
			.sort();
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

	/** First unused `<slug>.md`, `<slug>-2.md`, `<slug>-3.md`, … in folder. */
	private unusedFileName(folder: string, slug: string): string {
		let candidate = slug;
		let suffix = 2;
		while (
			this.vault.getAbstractFileByPath(joinPath(folder, `${candidate}.md`)) !== null
		) {
			candidate = `${slug}-${suffix}`;
			suffix += 1;
		}
		return candidate;
	}

	private toRecord(path: string, frontmatter: Frontmatter): GoalRecord {
		const status = frontmatter.status;
		if (typeof status !== "string" || !isGoalStatus(status)) {
			throw new Error(
				`Invalid status ${JSON.stringify(status)} in ${path} — expected one of: ` +
					GOAL_STATUSES.join(", "),
			);
		}
		return {
			path,
			title: String(frontmatter.title ?? ""),
			status,
			description: optionalString(frontmatter.description),
			targetDate: optionalString(frontmatter.target_date),
			createdDate: optionalString(frontmatter.created_date),
			discussedIn: normalizeDiscussedIn(frontmatter.discussed_in),
		};
	}
}

/** Kebab-case, filesystem-safe, stable for the same title. */
export function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Validate a status value; throw with the legal values listed. */
export function assertGoalStatus(status: string): asserts status is GoalStatus {
	if (!isGoalStatus(status)) {
		throw new Error(
			`Invalid goal status "${status}" — expected one of: ${GOAL_STATUSES.join(", ")}.`,
		);
	}
}

function isGoalStatus(value: string): value is GoalStatus {
	return (GOAL_STATUSES as readonly string[]).includes(value);
}

/**
 * Normalize `discussed_in` to wiki-link strings: accepts a scalar or a list,
 * bare paths or `[[links]]`; wraps bare values; always returns an array.
 */
function normalizeDiscussedIn(
	value: FrontmatterValue | undefined,
): string[] {
	const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
	return list
		.map((item) => String(item).trim())
		.filter((item) => item !== "")
		.map((item) =>
			item.startsWith("[[") && item.endsWith("]]") ? item : `[[${item}]]`,
		);
}

function optionalString(value: string | number | string[] | undefined): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}
