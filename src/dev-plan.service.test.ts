import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { DevPlanService } from "./dev-plan.service";
import { buildNote as build, splitFrontmatter as split } from "./frontmatter";
import { personFolder } from "./paths";
import { DEFAULT_SETTINGS, type TeamSyncSettings } from "./settings";
import {
	createMockVault,
	createMockMetadataCache,
} from "./testing/vault-mock";
import type { MockVault, MockMetadataCache } from "./testing/vault-mock";

/** Fresh vault + service with a couple of person folders in place. */
async function setup(...personNames: string[]): Promise<{
	vault: MockVault;
	cache: MockMetadataCache;
	settings: TeamSyncSettings;
}> {
	const vault = createMockVault();
	const settings: TeamSyncSettings = { ...DEFAULT_SETTINGS };
	for (const name of personNames) {
		await vault.adapter.mkdir(personFolder(settings, name));
		// The mock materializes TFolder objects lazily (real Obsidian always
		// has them), so poke each path once for folder.children to populate.
		vault.getAbstractFileByPath(personFolder(settings, name));
	}
	return { vault, cache: createMockMetadataCache(vault), settings };
}

function todayISO(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

describe("createDevPlan", () => {
	it("scaffolds the note with the exact frontmatter and template body", async () => {
		const { vault, settings } = await setup("Jane Doe");
		const service = new DevPlanService(vault, settings);
		const file = await service.createDevPlan("Jane Doe");

		expect(file.path).toBe("Team/Jane Doe/Development-Plan.md");
		const { frontmatter, body } = split(vault.getContent(file.path)!);
		expect(frontmatter).toEqual({
			type: "dev-plan",
			person: "Jane Doe",
			last_reviewed: todayISO(), // a brand-new plan counts as reviewed today
		});
		expect(body).toContain("# Development plan — Jane Doe");
		expect(body).toContain("## Growth areas");
		expect(body).toContain("## Skills to build");
		expect(body).toContain("## Target role / level");
		expect(body).toContain("## Stretch opportunities");
		expect(body).toContain("## Revision log");
		expect(body).toContain(`- ${todayISO()} — plan created`);
		// Evidence section links goals and 1:1 notes by folder path.
		expect(body).toContain(`[[Team/Jane Doe/${settings.goalsFolder}|Goals]]`);
		expect(body).toContain(
			`[[Team/Jane Doe/${settings.oneOnOnesFolder}|1:1 notes]]`,
		);
	});

	it("refuses to overwrite an existing plan with a clear error", async () => {
		const { vault, settings } = await setup("Jane Doe");
		const service = new DevPlanService(vault, settings);
		await service.createDevPlan("Jane Doe");

		await expect(service.createDevPlan("Jane Doe")).rejects.toThrow(
			/already exists \(Team\/Jane Doe\/Development-Plan\.md\)/,
		);
		// Nothing was overwritten.
		const { frontmatter } = split(
			vault.getContent("Team/Jane Doe/Development-Plan.md")!,
		);
		expect(frontmatter.type).toBe("dev-plan");
	});

	it("throws for an unknown person, empty name, or a name with a slash", async () => {
		const { vault, settings } = await setup("Jane Doe");
		const service = new DevPlanService(vault, settings);
		await expect(service.createDevPlan("Nobody")).rejects.toThrow(
			/Unknown person "Nobody".*Team\/Nobody/,
		);
		await expect(service.createDevPlan("   ")).rejects.toThrow(/empty/);
		await expect(service.createDevPlan("a/b")).rejects.toThrow(/"\//);
	});
});

describe("getDevPlan", () => {
	it("returns the record via the metadata cache when supplied", async () => {
		const { vault, cache, settings } = await setup("Jane Doe");
		const service = new DevPlanService(vault, settings, cache);
		await service.createDevPlan("Jane Doe");

		const record = await service.getDevPlan("Jane Doe");
		expect(record).toBeDefined();
		expect(record!.person).toBe("Jane Doe");
		expect(record!.lastReviewed).toBe(todayISO());
		expect(record!.path).toBe("Team/Jane Doe/Development-Plan.md");
		expect(record!.file).toBeInstanceOf(TFile);
	});

	it("falls back to cachedRead + split when no cache is supplied", async () => {
		const { vault, settings } = await setup("Jane Doe");
		const service = new DevPlanService(vault, settings);
		await service.createDevPlan("Jane Doe");

		const record = await service.getDevPlan("Jane Doe");
		expect(record!.lastReviewed).toBe(todayISO());
		expect(record!.file.path).toBe("Team/Jane Doe/Development-Plan.md");
	});

	it("returns undefined when the person has no plan; throws for unknown person", async () => {
		const { vault, settings } = await setup("Jane Doe");
		const service = new DevPlanService(vault, settings);
		expect(await service.getDevPlan("Jane Doe")).toBeUndefined();
		await expect(service.getDevPlan("Nobody")).rejects.toThrow(
			/Unknown person "Nobody"/,
		);
	});

	it("reports lastReviewed as undefined when the field is missing", async () => {
		const { vault, cache, settings } = await setup("Jane Doe");
		// A hand-authored plan without last_reviewed.
		await vault.create(
			"Team/Jane Doe/Development-Plan.md",
			build({ type: "dev-plan", person: "Jane Doe" }, "\n# Development plan\n"),
		);
		const record = await new DevPlanService(vault, settings, cache).getDevPlan(
			"Jane Doe",
		);
		expect(record!.lastReviewed).toBeUndefined();
	});
});

describe("markReviewed", () => {
	/** Hand-authored plan content with extra frontmatter and body noise. */
	const handAuthored = [
		"---",
		"type: dev-plan",
		"person: Jane Doe",
		"last_reviewed: 2026-06-01",
		"energy: high",
		"---",
		"",
		"# Development plan — Jane Doe",
		"",
		"## Growth areas",
		"",
		"- Systems design",
		"",
		"## Revision log",
		"",
		"- 2026-06-01 — plan created",
		"- 2026-07-10 — reviewed; narrowed to two growth areas",
		"",
		"## Evidence",
		"",
		"- [[Team/Jane Doe/Goals/x|Goal]]",
		"",
	].join("\n");

	async function setupWithPlan(): Promise<{
		vault: MockVault;
		service: DevPlanService;
	}> {
		const { vault, settings } = await setup("Jane Doe");
		await vault.create("Team/Jane Doe/Development-Plan.md", handAuthored);
		return { vault, service: new DevPlanService(vault, settings) };
	}

	it("flips only last_reviewed and appends the review line to the log", async () => {
		const { vault, service } = await setupWithPlan();
		const file = await service.markReviewed("Jane Doe");
		expect(file.path).toBe("Team/Jane Doe/Development-Plan.md");

		const before = split(handAuthored);
		const after = split(vault.getContent(file.path)!);
		// Every frontmatter field except last_reviewed survives untouched.
		const { last_reviewed: _before, ...beforeRest } = before.frontmatter;
		const { last_reviewed: _after, ...afterRest } = after.frontmatter;
		expect(afterRest).toEqual(beforeRest);
		expect(after.frontmatter.last_reviewed).toBe(todayISO());
		// The body gains exactly one line, inside the revision-log section and
		// before the Evidence heading that follows it.
		expect(after.body).toBe(
			before.body.replace(
				"- 2026-07-10 — reviewed; narrowed to two growth areas\n",
				"- 2026-07-10 — reviewed; narrowed to two growth areas\n" +
					`- ${todayISO()} — reviewed\n`,
			),
		);
	});

	it("appends the line at the end of the body when the log section is missing", async () => {
		const { vault, settings } = await setup("Jane Doe");
		const noLog = build(
			{ type: "dev-plan", person: "Jane Doe", last_reviewed: "2026-06-01" },
			"\n# Development plan — Jane Doe\n\nFree-form body, no log section.\n",
		);
		await vault.create("Team/Jane Doe/Development-Plan.md", noLog);
		const service = new DevPlanService(vault, settings);

		await service.markReviewed("Jane Doe");
		const after = split(vault.getContent("Team/Jane Doe/Development-Plan.md")!);
		expect(after.frontmatter.last_reviewed).toBe(todayISO());
		expect(after.body).toBe(
			`\n# Development plan — Jane Doe\n\nFree-form body, no log section.\n` +
				`- ${todayISO()} — reviewed\n`,
		);
	});

	it("throws for an unknown person, missing plan, or non-dev-plan note", async () => {
		const { vault, settings } = await setup("Jane Doe", "Planless");
		const service = new DevPlanService(vault, settings);
		await expect(service.markReviewed("Nobody")).rejects.toThrow(
			/Unknown person "Nobody"/,
		);
		await expect(service.markReviewed("Planless")).rejects.toThrow(
			/No development plan for "Planless".*create one first/,
		);

		await vault.create(
			"Team/Jane Doe/Development-Plan.md",
			build({ type: "person", name: "Jane Doe" }, "\nnot a plan\n"),
		);
		await expect(service.markReviewed("Jane Doe")).rejects.toThrow(
			/Not a development plan/,
		);
	});

	it("is repeatable: a second review updates the date, not the list of lines", async () => {
		const { vault, service } = await setupWithPlan();
		await service.markReviewed("Jane Doe");
		await service.markReviewed("Jane Doe");

		const after = split(vault.getContent("Team/Jane Doe/Development-Plan.md")!);
		const reviewedLines = after.body
			.split("\n")
			.filter((line) => line.endsWith("— reviewed"));
		expect(reviewedLines).toEqual([`- ${todayISO()} — reviewed`]);
	});
});
