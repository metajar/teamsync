import { beforeEach, describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";
import { PersonService } from "./person.service";
import { DEFAULT_SETTINGS, type TeamSyncSettings } from "./settings";
import {
	createMockMetadataCache,
	createMockVault,
	type MockVault,
} from "./testing/vault-mock";

function makeService(settings: TeamSyncSettings = DEFAULT_SETTINGS) {
	const vault = createMockVault();
	const cache = createMockMetadataCache(vault);
	const service = new PersonService(vault, settings, cache);
	return { vault, cache, service };
}

describe("createPerson", () => {
	let env: ReturnType<typeof makeService>;

	beforeEach(() => {
		env = makeService();
	});

	it("scaffolds the person folder with 1:1 and Goals subfolders", async () => {
		await env.service.createPerson("Jane Doe");
		expect(env.vault.folderPaths()).toEqual(
			expect.arrayContaining([
				"Team",
				"Team/Jane Doe",
				"Team/Jane Doe/1-on-1s",
				"Team/Jane Doe/Goals",
			]),
		);
	});

	it("scaffolds from custom settings values", async () => {
		const custom: TeamSyncSettings = {
			...DEFAULT_SETTINGS,
			rootFolder: "People",
			oneOnOnesFolder: "One-on-Ones",
			goalsFolder: "Objectives",
			personIndexFile: "profile.md",
		};
		const { vault, service } = makeService(custom);
		await service.createPerson("Jane Doe");
		expect(vault.folderPaths()).toEqual(
			expect.arrayContaining([
				"People",
				"People/Jane Doe",
				"People/Jane Doe/One-on-Ones",
				"People/Jane Doe/Objectives",
			]),
		);
		expect(vault.getContent("People/Jane Doe/profile.md")).toBeDefined();
	});

	it("succeeds when the root folder already exists", async () => {
		await env.vault.createFolder("Team");
		await expect(env.service.createPerson("Jane Doe")).resolves.toMatchObject({
			name: "Jane Doe",
		});
	});

	it("writes index frontmatter matching the person schema exactly", async () => {
		await env.service.createPerson("Jane Doe", {
			role: "Senior Engineer",
			startDate: "2024-01-15",
		});
		const content = env.vault.getContent("Team/Jane Doe/_index.md");
		expect(content).toBeDefined();
		expect(splitFrontmatter(content!).frontmatter).toEqual({
			type: "person",
			name: "Jane Doe",
			role: "Senior Engineer",
			start_date: "2024-01-15",
			status: "active",
		});
	});

	it("omits optional frontmatter fields when not provided", async () => {
		await env.service.createPerson("Jane Doe");
		expect(
			splitFrontmatter(env.vault.getContent("Team/Jane Doe/_index.md")!)
				.frontmatter,
		).toEqual({
			type: "person",
			name: "Jane Doe",
			status: "active",
		});
	});

	it("renders the template with all fields filled", async () => {
		await env.service.createPerson("Jane Doe", {
			role: "Senior Engineer",
			startDate: "2024-01-15",
		});
		const { body } = splitFrontmatter(
			env.vault.getContent("Team/Jane Doe/_index.md")!,
		);
		expect(body).toContain("# Jane Doe");
		expect(body).toContain("Senior Engineer");
		expect(body).toContain("2024-01-15");
		expect(body).toContain("[[Team/Jane Doe/1-on-1s|1:1 notes]]");
		expect(body).toContain("[[Team/Jane Doe/Goals|Goals]]");
		expect(body).toContain(
			"[[Team/Jane Doe/Development-Plan.md|Development plan]]",
		);
	});

	it("renders the template without optional fields and no leftover placeholders", async () => {
		await env.service.createPerson("Jane Doe");
		const { body } = splitFrontmatter(
			env.vault.getContent("Team/Jane Doe/_index.md")!,
		);
		expect(body).not.toContain("{{");
		expect(body).toContain("[[Team/Jane Doe/1-on-1s|1:1 notes]]");
	});

	it("throws a clear error on a duplicate name", async () => {
		await env.service.createPerson("Jane Doe");
		await expect(env.service.createPerson("Jane Doe")).rejects.toThrow(
			/team member named "Jane Doe" already exists/,
		);
	});

	it("trims leading and trailing whitespace from the name", async () => {
		await env.service.createPerson("  Jane Doe  ");
		expect(env.vault.getContent("Team/Jane Doe/_index.md")).toBeDefined();
	});

	it("rejects a name containing a slash", async () => {
		await expect(env.service.createPerson("Jane/Doe")).rejects.toThrow(
			/cannot contain "\/"/,
		);
	});

	it("rejects an empty name", async () => {
		await expect(env.service.createPerson("   ")).rejects.toThrow(
			/cannot be empty/,
		);
		expect(env.vault.folderPaths()).toEqual([""]);
	});
});

describe("listPeople and getPerson", () => {
	it("lists active people sorted by name", async () => {
		const { service } = makeService();
		await service.createPerson("Zoe Ali");
		await service.createPerson("Adam Poe", { role: "PM" });
		const people = await service.listPeople();
		expect(people.map((p) => p.name)).toEqual(["Adam Poe", "Zoe Ali"]);
		expect(people[0]).toMatchObject({
			role: "PM",
			startDate: undefined,
			status: "active",
			indexPath: "Team/Adam Poe/_index.md",
		});
	});

	it("lists people without a metadata cache via cachedRead fallback", async () => {
		const vault = createMockVault();
		const service = new PersonService(vault, DEFAULT_SETTINGS);
		await service.createPerson("Jane Doe");
		const people = await service.listPeople();
		expect(people.map((p) => p.name)).toEqual(["Jane Doe"]);
	});

	it("ignores notes of other types", async () => {
		const { vault, service } = makeService();
		await service.createPerson("Jane Doe");
		await vault.create("Team/scratch.md", "---\ntype: one-on-one\n---\n");
		expect((await service.listPeople()).map((p) => p.name)).toEqual([
			"Jane Doe",
		]);
	});

	it("returns undefined for an unknown person", async () => {
		const { service } = makeService();
		expect(await service.getPerson("Nobody")).toBeUndefined();
	});
});

describe("archivePerson", () => {
	let vault: MockVault;
	let service: PersonService;

	beforeEach(async () => {
		const env = makeService();
		vault = env.vault;
		service = env.service;
		await service.createPerson("Jane Doe", {
			role: "Engineer",
			startDate: "2024-01-15",
		});
		// Simulate history: a past 1:1 note and a dev plan in the person folder.
		await vault.create(
			"Team/Jane Doe/1-on-1s/2026-09-02.md",
			"---\ntype: one-on-one\nperson: Jane Doe\n---\n\nTalked about goals.\n",
		);
		await vault.create(
			"Team/Jane Doe/Development-Plan.md",
			"---\ntype: dev-plan\nperson: Jane Doe\n---\n\nGrow in system design.\n",
		);
	});

	it("flips status in the index frontmatter and keeps the body", async () => {
		const before = splitFrontmatter(
			vault.getContent("Team/Jane Doe/_index.md")!,
		);
		const archived = await service.archivePerson("Jane Doe");
		expect(archived.status).toBe("archived");

		const after = splitFrontmatter(vault.getContent("Team/Jane Doe/_index.md")!);
		expect(after.frontmatter.status).toBe("archived");
		expect(after.frontmatter).toMatchObject({
			type: "person",
			name: "Jane Doe",
			role: "Engineer",
			start_date: "2024-01-15",
		});
		expect(after.body).toBe(before.body);
	});

	it("never deletes or moves any file", async () => {
		const foldersBefore = vault.folderPaths().slice().sort();
		const oneOnOne = vault.getContent("Team/Jane Doe/1-on-1s/2026-09-02.md");
		const devPlan = vault.getContent("Team/Jane Doe/Development-Plan.md");

		await service.archivePerson("Jane Doe");

		expect(vault.folderPaths().slice().sort()).toEqual(foldersBefore);
		expect(vault.getContent("Team/Jane Doe/_index.md")).toBeDefined();
		expect(
			vault.getContent("Team/Jane Doe/1-on-1s/2026-09-02.md"),
		).toBe(oneOnOne);
		expect(vault.getContent("Team/Jane Doe/Development-Plan.md")).toBe(devPlan);
	});

	it("excludes archived people from listPeople but keeps them retrievable", async () => {
		await service.createPerson("Adam Poe");
		await service.archivePerson("Jane Doe");

		expect((await service.listPeople()).map((p) => p.name)).toEqual([
			"Adam Poe",
		]);
		const archived = await service.getPerson("Jane Doe");
		expect(archived).toMatchObject({
			name: "Jane Doe",
			status: "archived",
		});
	});

	it("throws for an unknown person", async () => {
		await expect(service.archivePerson("Nobody")).rejects.toThrow(
			/No team member named "Nobody"/,
		);
	});

	it("yields a TFile for getPersonFile", async () => {
		const file = await service.getPersonFile("Jane Doe");
		expect(file?.path).toBe("Team/Jane Doe/_index.md");
		expect(await service.getPersonFile("Nobody")).toBeNull();
	});
});
