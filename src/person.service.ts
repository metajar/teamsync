import { TFile } from "obsidian";
import type { MetadataCache, Vault } from "obsidian";
import { buildNote, splitFrontmatter, type Frontmatter } from "./frontmatter";
import {
	devPlanPath,
	goalsFolder,
	oneOnOneFolder,
	personFolder,
	personIndexPath,
} from "./paths";
import type { TeamSyncSettings } from "./settings";
import { renderTemplate } from "./template-engine";
import { PERSON_TEMPLATE } from "./templates/person";

export type PersonStatus = "active" | "archived";

/** A person as read from (or written to) their index-note frontmatter. */
export interface PersonRecord {
	name: string;
	role: string | undefined;
	startDate: string | undefined;
	status: PersonStatus;
	/** Vault path of the person's index note. */
	indexPath: string;
}

export interface CreatePersonOptions {
	role?: string;
	startDate?: string;
}

/**
 * All person-roster file I/O. Commands and views never touch the vault
 * directly — they call these methods and surface thrown errors as Notices.
 *
 * Structured data lives only in the `person` frontmatter field set
 * (type, name, role, start_date, status); bodies stay free-form.
 */
export class PersonService {
	constructor(
		private readonly vault: Vault,
		private readonly settings: TeamSyncSettings,
		private readonly metadataCache?: MetadataCache,
	) {}

	/**
	 * Quick-add a team member: scaffold the person folder with its 1:1 and
	 * Goals subfolders and write the index note from the template.
	 * Throws on an empty name, a name containing "/", or a duplicate.
	 */
	async createPerson(
		rawName: string,
		opts: CreatePersonOptions = {},
	): Promise<PersonRecord> {
		const name = this.validateName(rawName);
		const folder = personFolder(this.settings, name);
		const indexPath = personIndexPath(this.settings, name);

		if (
			this.vault.getAbstractFileByPath(folder) !== null ||
			this.vault.getAbstractFileByPath(indexPath) !== null
		) {
			throw new Error(
				`A team member named "${name}" already exists (${indexPath}). ` +
					"Choose a different name, or remove the existing folder if it is not in use.",
			);
		}

		// createFolder builds ancestors, so these two calls also create the
		// person folder (and the root folder on the very first person).
		await this.vault.createFolder(oneOnOneFolder(this.settings, name));
		await this.vault.createFolder(goalsFolder(this.settings, name));

		const frontmatter: Frontmatter = {
			type: "person",
			name,
			status: "active",
		};
		const role = opts.role?.trim();
		const startDate = opts.startDate?.trim();
		if (role) frontmatter.role = role;
		if (startDate) frontmatter.start_date = startDate;

		const body = renderTemplate(PERSON_TEMPLATE, {
			name,
			role,
			start_date: startDate,
			one_on_ones_link: oneOnOneFolder(this.settings, name),
			goals_link: goalsFolder(this.settings, name),
			dev_plan_link: devPlanPath(this.settings, name),
		});

		await this.vault.create(indexPath, buildNote(frontmatter, `\n${body}`));
		return {
			name,
			role: role || undefined,
			startDate: startDate || undefined,
			status: "active",
			indexPath,
		};
	}

	/** Active people only, sorted by name. Archived via {@link getPerson}. */
	async listPeople(): Promise<PersonRecord[]> {
		const people = await this.readAllPeople();
		return people
			.filter((person) => person.status === "active")
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** One person by exact name, active or archived; undefined if not found. */
	async getPerson(name: string): Promise<PersonRecord | undefined> {
		const trimmed = this.validateName(name);
		const people = await this.readAllPeople();
		return people.find((person) => person.name === trimmed);
	}

	/**
	 * The person's index note as a TFile, for opening in a workspace leaf.
	 * Returned by the service so commands never call vault.* themselves.
	 */
	async getPersonFile(name: string): Promise<TFile | null> {
		const person = await this.getPerson(name);
		if (!person) return null;
		const file = this.vault.getAbstractFileByPath(person.indexPath);
		return file instanceof TFile ? file : null;
	}

	/**
	 * Mark a person archived: flip `status` in the index frontmatter.
	 * Never deletes, moves, or renames anything — history is sacred.
	 */
	async archivePerson(name: string): Promise<PersonRecord> {
		const person = await this.getPerson(name);
		if (!person) {
			throw new Error(
				`No team member named "${this.validateName(name)}" found under ` +
					`${this.settings.rootFolder}.`,
			);
		}

		const file = this.vault.getAbstractFileByPath(person.indexPath);
		if (!(file instanceof TFile)) {
			throw new Error(
				`Index note for "${person.name}" is missing: ${person.indexPath}.`,
			);
		}

		const { frontmatter, body } = splitFrontmatter(await this.vault.read(file));
		frontmatter.status = "archived";
		await this.vault.modify(file, buildNote(frontmatter, body));
		return { ...person, status: "archived" };
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

	/**
	 * Every person index in the vault, discovered by frontmatter `type:
	 * person` — never by folder layout or note bodies. Reads go through the
	 * metadata cache when one was supplied; otherwise via cachedRead, still
	 * parsing only the frontmatter block.
	 */
	private async readAllPeople(): Promise<PersonRecord[]> {
		const records: PersonRecord[] = [];
		for (const file of this.vault.getMarkdownFiles()) {
			const frontmatter = await this.frontmatterOf(file);
			if (frontmatter.type !== "person") continue;
			records.push(this.toRecord(frontmatter, file.path));
		}
		return records;
	}

	private async frontmatterOf(file: TFile): Promise<Frontmatter> {
		if (this.metadataCache) {
			return (this.metadataCache.getCache(file.path)?.frontmatter ??
				{}) as Frontmatter;
		}
		return splitFrontmatter(await this.vault.cachedRead(file)).frontmatter;
	}

	private toRecord(frontmatter: Frontmatter, path: string): PersonRecord {
		return {
			name: String(frontmatter.name ?? ""),
			role:
				frontmatter.role === undefined ? undefined : String(frontmatter.role),
			startDate:
				frontmatter.start_date === undefined
					? undefined
					: String(frontmatter.start_date),
			status: frontmatter.status === "archived" ? "archived" : "active",
			indexPath: path,
		};
	}
}
