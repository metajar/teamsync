import { beforeEach, describe, expect, it } from "vitest";
import { buildNote, type Frontmatter } from "../frontmatter";
import { devPlanPath, personFolder } from "../paths";
import { DEFAULT_SETTINGS, type TeamSyncSettings } from "../settings";
import {
	createMockVault,
	createMockMetadataCache,
} from "../testing/vault-mock";
import type { MockVault, MockMetadataCache } from "../testing/vault-mock";
import {
	buildTeamRows,
	daysBetween,
	OVERDUE_THRESHOLD_DAYS,
} from "./team-dashboard-model";

/** Fixed "today" so date math never depends on the wall clock. */
const TODAY = "2026-09-10";

let vault: MockVault;
let cache: MockMetadataCache;
let settings: TeamSyncSettings;

beforeEach(() => {
	vault = createMockVault();
	cache = createMockMetadataCache(vault);
	settings = { ...DEFAULT_SETTINGS };
});

/** Create a typed note in the mock vault; creation order drives ctime. */
async function addNote(
	path: string,
	frontmatter: Frontmatter,
): Promise<void> {
	const folder = path.slice(0, path.lastIndexOf("/"));
	await vault.adapter.mkdir(folder);
	await vault.create(path, buildNote(frontmatter, "\nbody"));
}

async function addPerson(name: string, status = "active"): Promise<void> {
	await addNote(`${personFolder(settings, name)}/_index.md`, {
		type: "person",
		name,
		status,
	});
}

async function addOneOnOne(
	person: string,
	date: string,
	actionItemsOpen: number,
): Promise<void> {
	await addNote(`${personFolder(settings, person)}/1-on-1s/${date}.md`, {
		type: "one-on-one",
		person,
		date,
		mood: "", // placeholder in real notes — the dashboard ignores it
		action_items_open: actionItemsOpen,
	});
}

async function addGoal(person: string, status: string): Promise<void> {
	await addNote(
		`${personFolder(settings, person)}/Goals/${person.toLowerCase().replace(/\s+/g, "-")}-${status}.md`,
		{ type: "goal", person, title: `Goal ${status}`, status },
	);
}

/** Dev plan at the person's configured path; last_reviewed optional. */
async function addDevPlan(
	person: string,
	lastReviewed?: string,
): Promise<void> {
	const frontmatter: Frontmatter = { type: "dev-plan", person };
	if (lastReviewed !== undefined) {
		frontmatter.last_reviewed = lastReviewed;
	}
	await addNote(devPlanPath(settings, person), frontmatter);
}

function rows() {
	return buildTeamRows(vault, cache, TODAY, settings.devPlanReviewDays);
}

describe("buildTeamRows", () => {
	it("builds a full row per active person from cached frontmatter", async () => {
		await addPerson("Jane Doe");
		await addOneOnOne("Jane Doe", "2026-08-20", 3);
		await addGoal("Jane Doe", "in-progress");
		await addGoal("Jane Doe", "done");

		expect(rows()).toEqual([
			{
				name: "Jane Doe",
				indexPath: "Team/Jane Doe/_index.md",
				lastOneOnOneDate: "2026-08-20",
				daysSinceLastOneOnOne: 21,
				openGoals: 1,
				openActionItems: 3,
				overdue: true,
				devPlanState: "no-plan",
				devPlanLastReviewed: null,
				devPlanDaysSinceReview: null,
			},
		]);
	});

	it("picks the latest 1:1 by frontmatter date across many notes", async () => {
		await addPerson("Jane Doe");
		await addOneOnOne("Jane Doe", "2026-08-20", 5);
		await addOneOnOne("Jane Doe", "2026-09-05", 2);
		await addOneOnOne("Jane Doe", "2026-09-01", 7);

		const [row] = rows();
		expect(row.lastOneOnOneDate).toBe("2026-09-05");
		expect(row.daysSinceLastOneOnOne).toBe(5);
		expect(row.openActionItems).toBe(2); // from the latest note only
		expect(row.overdue).toBe(false);
	});

	it("breaks same-date ties by creation time (suffixed same-day files)", async () => {
		await addPerson("Jane Doe");
		await addOneOnOne("Jane Doe", "2026-09-09", 4); // created first
		// Same frontmatter date, suffixed filename, created second — wins.
		await addNote("Team/Jane Doe/1-on-1s/2026-09-09-2.md", {
			type: "one-on-one",
			person: "Jane Doe",
			date: "2026-09-09",
			action_items_open: 6,
		});

		const [row] = rows();
		expect(row.lastOneOnOneDate).toBe("2026-09-09");
		expect(row.openActionItems).toBe(6);
		expect(row.daysSinceLastOneOnOne).toBe(1);
	});

	it("treats the overdue threshold as >= 21 days (20 / 21 / 22 boundary)", async () => {
		await addPerson("Twenty", "active");
		await addPerson("TwentyOne", "active");
		await addPerson("TwentyTwo", "active");
		await addOneOnOne("Twenty", "2026-08-21", 0); // 20 days
		await addOneOnOne("TwentyOne", "2026-08-20", 0); // 21 days
		await addOneOnOne("TwentyTwo", "2026-08-19", 0); // 22 days
		expect(OVERDUE_THRESHOLD_DAYS).toBe(21);

		const byName = new Map(rows().map((row) => [row.name, row]));
		expect(byName.get("Twenty")!.overdue).toBe(false);
		expect(byName.get("TwentyOne")!.overdue).toBe(true);
		expect(byName.get("TwentyTwo")!.overdue).toBe(true);
	});

	it("counts every goal status except done as open", async () => {
		await addPerson("Jane Doe");
		for (const status of ["not-started", "in-progress", "blocked", "done"]) {
			await addGoal("Jane Doe", status);
		}
		expect(rows()[0].openGoals).toBe(3);
	});

	it("excludes archived people and their notes from the table", async () => {
		await addPerson("Jane Doe");
		await addPerson("Bob Builder", "archived");
		await addOneOnOne("Bob Builder", "2026-01-05", 9);
		await addGoal("Bob Builder", "in-progress");

		expect(rows().map((row) => row.name)).toEqual(["Jane Doe"]);
	});

	it("shows nulls and zeros for a person with no 1:1s or goals yet", async () => {
		await addPerson("Jane Doe");

		expect(rows()).toEqual([
			{
				name: "Jane Doe",
				indexPath: "Team/Jane Doe/_index.md",
				lastOneOnOneDate: null,
				daysSinceLastOneOnOne: null,
				openGoals: 0,
				openActionItems: 0,
				overdue: false, // never met — nothing to measure staleness against
				devPlanState: "no-plan",
				devPlanLastReviewed: null,
				devPlanDaysSinceReview: null,
			},
		]);
	});

	it("ignores notes belonging to people without an index note", async () => {
		await addOneOnOne("Ghost", "2026-01-01", 8);
		await addGoal("Ghost", "blocked");

		expect(rows()).toEqual([]);
	});

	it("ignores untyped notes and files without cached frontmatter", async () => {
		await addPerson("Jane Doe");
		await vault.adapter.mkdir("Team");
		await vault.create("Team/README.md", "no frontmatter here\n");
		await addNote("Team/Jane Doe/Development-Plan.md", {
			type: "dev-plan",
			person: "Jane Doe",
			last_reviewed: "2026-09-01",
		});

		expect(rows().map((row) => row.name)).toEqual(["Jane Doe"]);
		expect(rows()[0].openGoals).toBe(0);
		// The typed dev-plan note IS consumed — 9 days old is fresh at 90.
		expect(rows()[0].devPlanState).toBe("fresh");
	});

	it("sorts rows by person name and collapses duplicate index notes", async () => {
		await addPerson("Zoe Zane");
		await addPerson("Bob Builder");
		// A stray second index note for the same person (e.g. re-created by hand).
		await addNote("Team/Bob Builder/_index copy.md", {
			type: "person",
			name: "Bob Builder",
			status: "active",
		});

		expect(rows().map((row) => row.name)).toEqual(["Bob Builder", "Zoe Zane"]);
	});

	it("returns [] for an empty vault", () => {
		expect(rows()).toEqual([]);
	});
});

describe("dev-plan freshness", () => {
	it("treats the review threshold as >= 90 days (89 / 90 / 91 boundary)", async () => {
		await addPerson("EightyNine");
		await addPerson("Ninety");
		await addPerson("NinetyOne");
		await addDevPlan("EightyNine", "2026-06-13"); // 89 days before TODAY
		await addDevPlan("Ninety", "2026-06-12"); // exactly 90
		await addDevPlan("NinetyOne", "2026-06-11"); // 91
		expect(settings.devPlanReviewDays).toBe(90);

		const byName = new Map(rows().map((row) => [row.name, row]));
		expect(byName.get("EightyNine")!.devPlanState).toBe("fresh");
		expect(byName.get("Ninety")!.devPlanState).toBe("stale"); // boundary is stale
		expect(byName.get("NinetyOne")!.devPlanState).toBe("stale");
		expect(byName.get("Ninety")!.devPlanDaysSinceReview).toBe(90);
		expect(byName.get("Ninety")!.devPlanLastReviewed).toBe("2026-06-12");
	});

	it("uses the threshold passed in, not a module constant", async () => {
		await addPerson("Jane Doe");
		await addDevPlan("Jane Doe", "2026-08-20"); // 21 days before TODAY

		const [row] = buildTeamRows(vault, cache, TODAY, 21);
		expect(row.devPlanState).toBe("stale");
		expect(row.devPlanDaysSinceReview).toBe(21);

		const [lenient] = buildTeamRows(vault, cache, TODAY, 90);
		expect(lenient.devPlanState).toBe("fresh");
	});

	it("reports no-plan with nulls for a person without a dev plan", async () => {
		await addPerson("Jane Doe");
		const [row] = rows();
		expect(row.devPlanState).toBe("no-plan");
		expect(row.devPlanLastReviewed).toBeNull();
		expect(row.devPlanDaysSinceReview).toBeNull();
	});

	it("treats a plan with a missing or non-ISO last_reviewed as never reviewed (stale)", async () => {
		await addPerson("Missing");
		await addPerson("Garbled");
		await addDevPlan("Missing"); // field absent
		await addNote("Team/Garbled/Development-Plan.md", {
			type: "dev-plan",
			person: "Garbled",
			last_reviewed: "last Tuesday",
		});

		const byName = new Map(rows().map((row) => [row.name, row]));
		for (const name of ["Missing", "Garbled"]) {
			expect(byName.get(name)!.devPlanState).toBe("stale");
			expect(byName.get(name)!.devPlanLastReviewed).toBeNull();
			expect(byName.get(name)!.devPlanDaysSinceReview).toBeNull();
		}
	});

	it("excludes the dev plans of archived people alongside their rows", async () => {
		await addPerson("Jane Doe");
		await addPerson("Bob Builder", "archived");
		await addDevPlan("Bob Builder", "2020-01-01"); // would be very stale

		const names = rows().map((row) => row.name);
		expect(names).toEqual(["Jane Doe"]);
	});

	it("ignores a dev-plan note whose person has no index note", async () => {
		await addDevPlan("Ghost", "2020-01-01");
		expect(rows()).toEqual([]);
	});
});

describe("daysBetween", () => {
	it("counts whole UTC days across month boundaries", () => {
		expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
		expect(daysBetween("2026-08-20", "2026-09-10")).toBe(21);
		expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1); // non-leap 2026
	});

	it("is zero for the same day and negative when from > to", () => {
		expect(daysBetween("2026-09-10", "2026-09-10")).toBe(0);
		expect(daysBetween("2026-09-11", "2026-09-10")).toBe(-1);
	});

	it("throws for non-ISO input", () => {
		expect(() => daysBetween("yesterday", TODAY)).toThrow(/Invalid ISO date/);
	});
});
