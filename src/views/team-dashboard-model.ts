import type { FrontmatterValue } from "../frontmatter";

/**
 * Team dashboard rollup logic — pure and metadata-cache-driven.
 *
 * The ItemView (team-dashboard.ts) stays a thin renderer; every number the
 * dashboard shows is computed here. Nothing loads note bodies or re-parses
 * the vault: the only input is frontmatter read through the Obsidian
 * metadata cache (patterns/add-command-or-view.md step 4, architecture.md
 * "Dashboards read via the metadata cache"). This module never writes.
 */

/** Days without a 1:1 before the passive "no 1:1" badge appears. */
export const OVERDUE_THRESHOLD_DAYS = 21;

/** A person's `_index.md` as plain data. */
export interface PersonEntry {
	name: string;
	status: "active" | "archived";
	indexPath: string;
}

/** A 1:1 note's rollup-relevant frontmatter plus creation time. */
export interface OneOnOneEntry {
	person: string;
	/** ISO date from frontmatter; "" when the field is missing/not a string. */
	date: string;
	actionItemsOpen: number;
	/** File creation time — tie-breaker for same-date (suffixed) notes. */
	ctime: number;
}

/** A goal note's rollup-relevant frontmatter. */
export interface GoalEntry {
	person: string;
	status: string;
}

/** Everything the dashboard needs, flattened from the cache walk. */
export interface DashboardData {
	people: PersonEntry[];
	oneOnOnes: OneOnOneEntry[];
	goals: GoalEntry[];
}

/** Structural slice of a `TFile` — just what the walker reads. */
export interface DashboardFile {
	path: string;
	stat: { ctime: number };
}

/** Structural slice of `Vault` — enumerating markdown files, nothing else. */
export interface DashboardFileSource {
	getMarkdownFiles(): DashboardFile[];
}

/** Structural slice of `MetadataCache` — frontmatter lookups only. */
export interface DashboardCache {
	getCache(path: string): { frontmatter?: Record<string, unknown> } | null;
}

/** One dashboard table row, fully computed and render-ready. */
export interface TeamRow {
	name: string;
	indexPath: string;
	lastOneOnOneDate: string | null;
	daysSinceLastOneOnOne: number | null;
	openGoals: number;
	/** `action_items_open` of the latest 1:1, read from the cache as-is. */
	openActionItems: number;
	/** Passive display flag only — active notifications are an open PRD question. */
	overdue: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Walk the vault's markdown files via the metadata cache and flatten every
 * person / one-on-one / goal note into plain data. Notes without cached
 * frontmatter, without a `type`, or missing their linking field (`name` /
 * `person`) are ignored — the dashboard only ever shows typed notes.
 */
export function collectDashboardData(
	files: DashboardFile[],
	cache: DashboardCache,
): DashboardData {
	const data: DashboardData = { people: [], oneOnOnes: [], goals: [] };
	for (const file of files) {
		const frontmatter = cache.getCache(file.path)?.frontmatter;
		if (!frontmatter) continue;

		switch (frontmatter.type) {
			case "person": {
				const name = stringOrEmpty(frontmatter.name);
				if (name === "") continue; // unlinked index note — nothing to key on
				data.people.push({
					name,
					status: frontmatter.status === "archived" ? "archived" : "active",
					indexPath: file.path,
				});
				break;
			}
			case "one-on-one": {
				const person = stringOrEmpty(frontmatter.person);
				if (person === "") continue;
				data.oneOnOnes.push({
					person,
					date: stringOrEmpty(frontmatter.date),
					actionItemsOpen:
						typeof frontmatter.action_items_open === "number"
							? frontmatter.action_items_open
							: 0,
					ctime: file.stat.ctime,
				});
				break;
			}
			case "goal": {
				const person = stringOrEmpty(frontmatter.person);
				if (person === "") continue;
				data.goals.push({ person, status: stringOrEmpty(frontmatter.status) });
				break;
			}
			// Other note types (dev-plan, anything user-made) don't feed the table.
		}
	}
	return data;
}

/**
 * Pure rollup: one row per ACTIVE person (archived excluded, duplicates
 * collapsed to the first index note), with the latest 1:1 by frontmatter
 * date then creation time, days since it, the count of goals not `done`,
 * and the latest note's `action_items_open`. Rows sort by name.
 */
export function computeTeamRows(data: DashboardData, today: string): TeamRow[] {
	const latestByPerson = new Map<string, OneOnOneEntry>();
	for (const note of data.oneOnOnes) {
		const current = latestByPerson.get(note.person);
		if (!current || ranksLater(note, current)) {
			latestByPerson.set(note.person, note);
		}
	}

	const openGoalsByPerson = new Map<string, number>();
	for (const goal of data.goals) {
		if (goal.status === "done") continue;
		openGoalsByPerson.set(goal.person, (openGoalsByPerson.get(goal.person) ?? 0) + 1);
	}

	const rows: TeamRow[] = [];
	const seen = new Set<string>();
	for (const person of data.people) {
		if (person.status !== "active" || seen.has(person.name)) continue;
		seen.add(person.name);

		const latest = latestByPerson.get(person.name);
		const lastDate = latest && ISO_DATE.test(latest.date) ? latest.date : null;
		const daysSince =
			lastDate !== null ? daysBetween(lastDate, today) : null;
		rows.push({
			name: person.name,
			indexPath: person.indexPath,
			lastOneOnOneDate: lastDate,
			daysSinceLastOneOnOne: daysSince,
			openGoals: openGoalsByPerson.get(person.name) ?? 0,
			openActionItems: latest?.actionItemsOpen ?? 0,
			overdue: daysSince !== null && daysSince >= OVERDUE_THRESHOLD_DAYS,
		});
	}
	return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Cache walk + rollup in one call — what the view invokes on every render. */
export function buildTeamRows(
	source: DashboardFileSource,
	cache: DashboardCache,
	today: string,
): TeamRow[] {
	return computeTeamRows(collectDashboardData(source.getMarkdownFiles(), cache), today);
}

/** Whole days from `fromISO` to `toISO`, both `YYYY-MM-DD` (UTC math, no DST). */
export function daysBetween(fromISO: string, toISO: string): number {
	const from = Date.parse(`${fromISO}T00:00:00Z`);
	const to = Date.parse(`${toISO}T00:00:00Z`);
	if (Number.isNaN(from) || Number.isNaN(to)) {
		throw new Error(`Invalid ISO date: "${fromISO}" or "${toISO}".`);
	}
	return Math.round((to - from) / 86_400_000);
}

/** Local-timezone ISO date (YYYY-MM-DD) for "today" — matches the services. */
export function todayISO(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

/** Same tie-break semantics as OneOnOneService: date first, then ctime. */
function ranksLater(candidate: OneOnOneEntry, current: OneOnOneEntry): boolean {
	if (candidate.date !== current.date) {
		return candidate.date > current.date;
	}
	return candidate.ctime > current.ctime;
}

function stringOrEmpty(value: FrontmatterValue | unknown): string {
	return typeof value === "string" ? value : "";
}
