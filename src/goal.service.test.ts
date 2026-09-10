import { describe, expect, it } from "vitest";
import { buildNote as build, splitFrontmatter as split } from "./frontmatter";
import { GoalService, slugify } from "./goal.service";
import { personFolder } from "./paths";
import { DEFAULT_SETTINGS, type TeamSyncSettings } from "./settings";
import { createMockVault, type MockVault } from "./testing/vault-mock";

/** Fresh vault + service with a couple of person folders in place. */
async function setup(...personNames: string[]): Promise<{
	vault: MockVault;
	settings: TeamSyncSettings;
	service: GoalService;
}> {
	const vault = createMockVault();
	const settings: TeamSyncSettings = { ...DEFAULT_SETTINGS };
	for (const name of personNames) {
		await vault.adapter.mkdir(personFolder(settings, name));
		// The mock materializes TFolder objects lazily (real Obsidian always
		// has them), so poke each path once for folder.children to populate.
		vault.getAbstractFileByPath(personFolder(settings, name));
	}
	return { vault, settings, service: new GoalService(vault, settings) };
}

function todayISO(): string {
	return new Date().toISOString().slice(0, 10);
}

describe("createGoal", () => {
	it("writes the goal note with the exact frontmatter shape", async () => {
		const { vault, service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", {
			title: "Improve code review turnaround",
			description: "Median review time under 24h.",
			targetDate: "2026-12-31",
			discussedIn: "2026-09-09",
		});

		expect(path).toBe("Team/Jane Doe/Goals/improve-code-review-turnaround.md");
		const { frontmatter, body } = split(vault.getContent(path)!);
		expect(frontmatter).toEqual({
			type: "goal",
			person: "Jane Doe",
			title: "Improve code review turnaround",
			description: "Median review time under 24h.",
			status: "not-started",
			target_date: "2026-12-31",
			created_date: todayISO(),
			discussed_in: "[[2026-09-09]]",
		});
		expect(body).toContain("# Improve code review turnaround");
		expect(body).toContain("For Jane Doe.");
		expect(body).toContain("## Progress log");
	});

	it("stores multiple discussed_in links as a list", async () => {
		const { vault, service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", {
			title: "Ship the redesign",
			discussedIn: ["2026-09-02", "[[2026-09-09]]"],
		});
		const { frontmatter } = split(vault.getContent(path)!);
		expect(frontmatter.discussed_in).toEqual(["[[2026-09-02]]", "[[2026-09-09]]"]);
	});

	it("omits optional fields entirely when not provided", async () => {
		const { vault, service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", { title: "Learn Rust" });
		const { frontmatter } = split(vault.getContent(path)!);
		expect(Object.keys(frontmatter).sort()).toEqual([
			"created_date",
			"person",
			"status",
			"title",
			"type",
		]);
	});

	it("slugifies titles and suffixes duplicates without overwriting", async () => {
		const { vault, service } = await setup("Jane Doe");
		const first = await service.createGoal("Jane Doe", {
			title: "Ship Q3 OKR: improve code review turnaround!",
		});
		expect(first).toBe("Team/Jane Doe/Goals/ship-q3-okr-improve-code-review-turnaround.md");
		expect(slugify("Ship Q3 OKR: improve code review turnaround!")).toBe(
			"ship-q3-okr-improve-code-review-turnaround",
		);

		const second = await service.createGoal("Jane Doe", {
			title: "Ship Q3 OKR: improve code review turnaround!",
			description: "A distinct goal with the same title.",
		});
		expect(second).toBe(
			"Team/Jane Doe/Goals/ship-q3-okr-improve-code-review-turnaround-2.md",
		);
		const third = await service.createGoal("Jane Doe", {
			title: "Ship Q3 OKR: improve code review turnaround!",
		});
		expect(third).toBe(
			"Team/Jane Doe/Goals/ship-q3-okr-improve-code-review-turnaround-3.md",
		);

		// The first note was not overwritten.
		const { frontmatter } = split(vault.getContent(first)!);
		expect(frontmatter).not.toHaveProperty("description");
	});

	it("throws for an unknown person, empty title, bad date, or unsluggable title", async () => {
		const { service } = await setup("Jane Doe");
		await expect(service.createGoal("Nobody", { title: "X" })).rejects.toThrow(
			/Unknown person "Nobody".*Team\/Nobody/,
		);
		await expect(service.createGoal("Jane Doe", { title: "   " })).rejects.toThrow(
			/title is required/i,
		);
		await expect(
			service.createGoal("Jane Doe", { title: "X", targetDate: "12/31/2026" }),
		).rejects.toThrow(/ISO format YYYY-MM-DD/);
		await expect(
			service.createGoal("Jane Doe", { title: "!!!" }),
		).rejects.toThrow(/no letters or digits/i);
	});
});

describe("listGoals and getGoal", () => {
	it("lists goals with frontmatter normalized, skipping non-goal files", async () => {
		const { vault, settings, service } = await setup("Jane Doe");
		const a = await service.createGoal("Jane Doe", {
			title: "Alpha goal",
			discussedIn: ["2026-09-02", "2026-09-09"],
			targetDate: "2026-10-01",
		});
		const b = await service.createGoal("Jane Doe", { title: "Beta goal" });
		// A stray note in the Goals folder that is not a goal.
		await vault.adapter.write(
			`${settings.rootFolder}/Jane Doe/${settings.goalsFolder}/ideas.md`,
			"---\ntype: scratch\n---\n\njust brainstorming\n",
		);

		const goals = await service.listGoals("Jane Doe");
		expect(goals.map((goal) => goal.title)).toEqual(["Alpha goal", "Beta goal"]);
		const alpha = goals.find((goal) => goal.title === "Alpha goal")!;
		expect(alpha.path).toBe(a);
		expect(alpha.status).toBe("not-started");
		expect(alpha.targetDate).toBe("2026-10-01");
		expect(alpha.createdDate).toBe(todayISO());
		expect(alpha.discussedIn).toEqual(["[[2026-09-02]]", "[[2026-09-09]]"]);

		const beta = await service.getGoal(b);
		expect(beta.title).toBe("Beta goal");
		expect(beta.discussedIn).toEqual([]);
		expect(beta.description).toBeUndefined();
	});

	it("returns [] for a person with no goals and throws for an unknown person", async () => {
		const { service } = await setup("Jane Doe");
		expect(await service.listGoals("Jane Doe")).toEqual([]);
		await expect(service.listGoals("Nobody")).rejects.toThrow(/Unknown person/);
	});

	it("getGoal throws for a missing path or a non-goal note", async () => {
		const { vault, settings, service } = await setup("Jane Doe");
		await expect(service.getGoal("Team/Jane Doe/Goals/nope.md")).rejects.toThrow(
			/does not exist/,
		);
		const goalsPath = `${settings.rootFolder}/Jane Doe/${settings.goalsFolder}`;
		await vault.adapter.mkdir(goalsPath);
		const stray = `${goalsPath}/scratch.md`;
		await vault.adapter.write(stray, "---\ntype: scratch\n---\n\nnotes\n");
		await expect(service.getGoal(stray)).rejects.toThrow(/Not a goal note/);
	});

	it("throws loudly on a corrupted status value", async () => {
		const { vault, service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", { title: "Broken" });
		const content = vault.getContent(path)!.replace(
			"status: not-started",
			"status: pending",
		);
		const file = vault.getAbstractFileByPath(path)!;
		await vault.modify(file as never, content);
		await expect(service.listGoals("Jane Doe")).rejects.toThrow(
			/Invalid status "pending".*not-started, in-progress, blocked, done/,
		);
	});
});

describe("updateStatus", () => {
	it("moves through all four legal statuses", async () => {
		const { service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", { title: "Lifecycle" });
		for (const status of ["in-progress", "blocked", "in-progress", "done"] as const) {
			await service.updateStatus(path, status);
			expect((await service.getGoal(path)).status).toBe(status);
		}
	});

	it("rejects invalid statuses without touching the note", async () => {
		const { vault, service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", { title: "Untouched" });
		const before = vault.getContent(path)!;
		for (const bad of ["Done", "complete", "", "in progress"]) {
			await expect(service.updateStatus(path, bad)).rejects.toThrow(
				/Invalid goal status/,
			);
		}
		await expect(service.updateStatus("Team/Jane Doe/Goals/missing.md", "done"))
			.rejects.toThrow(/does not exist/);
		expect(vault.getContent(path)).toBe(before);
	});

	it("changes exactly one line — every other field and the body survive byte-for-byte", async () => {
		const { vault, service } = await setup("Jane Doe");
		const path = await service.createGoal("Jane Doe", {
			title: "Preserve me",
			description: "Description: with a colon",
			targetDate: "2026-12-31",
			discussedIn: ["2026-09-02", "2026-09-09"],
		});

		// Give the note a gnarly user-edited body the service has never seen.
		const { frontmatter } = split(vault.getContent(path)!);
		const body = [
			"",
			"# Goal: Preserve me",
			"",
			"- [x] first step done",
			"- [ ] second step pending",
			"Discussed in [[2026-09-09]] and again in [[2026-09-02]].",
			"",
			"Multiline\twhitespace   and trailing spaces   ",
			"",
		].join("\n");
		const file = vault.getAbstractFileByPath(path)!;
		await vault.modify(file as never, build(frontmatter, body));
		const before = vault.getContent(path)!;

		await service.updateStatus(path, "blocked");
		const after = vault.getContent(path)!;

		// Exactly one line differs: the status line.
		const beforeLines = before.split("\n");
		const afterLines = after.split("\n");
		expect(beforeLines.length).toBe(afterLines.length);
		const diffs = beforeLines
			.map((line, i) => [line, afterLines[i]] as const)
			.filter(([b, a]) => b !== a);
		expect(diffs).toEqual([["status: not-started", "status: blocked"]]);

		// And structurally: same fields, same values, identical body.
		const beforeSplit = split(before);
		const afterSplit = split(after);
		expect(afterSplit.frontmatter).toEqual({
			...beforeSplit.frontmatter,
			status: "blocked",
		});
		expect(afterSplit.body).toBe(beforeSplit.body);
	});
});

describe("openGoalCount", () => {
	it("counts every status except done", async () => {
		const { service } = await setup("Jane Doe", "John Smith");
		expect(await service.openGoalCount("Jane Doe")).toBe(0);

		const a = await service.createGoal("Jane Doe", { title: "One" });
		await service.createGoal("Jane Doe", { title: "Two" });
		const c = await service.createGoal("Jane Doe", { title: "Three" });
		await service.updateStatus(a, "blocked"); // still open
		await service.updateStatus(c, "done"); // closed
		expect(await service.openGoalCount("Jane Doe")).toBe(2);

		await service.createGoal("John Smith", { title: "Solo" });
		expect(await service.openGoalCount("John Smith")).toBe(1);
		await expect(service.openGoalCount("Nobody")).rejects.toThrow(/Unknown person/);
	});
});

describe("listPersonNames", () => {
	it("returns person folder names, sorted, ignoring files", async () => {
		const { vault, settings, service } = await setup("Zed", "Ada");
		await vault.adapter.write(`${settings.rootFolder}/loose-note.md`, "hi\n");
		expect(await service.listPersonNames()).toEqual(["Ada", "Zed"]);
	});

	it("returns [] when the root folder does not exist", async () => {
		const { service } = await setup();
		expect(await service.listPersonNames()).toEqual([]);
	});
});
