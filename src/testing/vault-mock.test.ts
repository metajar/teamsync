import { describe, expect, it } from "vitest";
import { TFile, TFolder } from "obsidian";
import {
	createMockMetadataCache,
	createMockVault,
} from "./vault-mock";

describe("createMockVault", () => {
	it("creates folders with ancestors and finds them via getAbstractFileByPath", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team/Jane Doe/1-on-1s");
		const folder = vault.getAbstractFileByPath("Team/Jane Doe");
		expect(folder).toBeInstanceOf(TFolder);
		expect(vault.getAbstractFileByPath("Team/Jane Doe/1-on-1s")).toBeInstanceOf(TFolder);
		expect(vault.getAbstractFileByPath("Team/Nobody")).toBeNull();
	});

	it("createFolder throws when the folder already exists", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team");
		await expect(vault.createFolder("Team")).rejects.toThrow(/exists/);
	});

	it("creates, reads, and modifies files; read/modify throw for unknown files", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team/Jane Doe");
		const file = await vault.create("Team/Jane Doe/_index.md", "---\ntype: person\n---\n");
		expect(file).toBeInstanceOf(TFile);
		expect(await vault.read(file)).toBe("---\ntype: person\n---\n");
		await vault.modify(file, "updated");
		expect(vault.getContent("Team/Jane Doe/_index.md")).toBe("updated");
		await expect(vault.read({ ...file, path: "missing.md" })).rejects.toThrow();
	});

	it("create throws when the file exists or the parent folder is missing", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team");
		await vault.create("Team/a.md", "x");
		await expect(vault.create("Team/a.md", "y")).rejects.toThrow(/exists/);
		await expect(vault.create("Nope/b.md", "x")).rejects.toThrow(/Folder/);
	});

	it("lists only markdown files and reports existence", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team/Jane Doe/1-on-1s");
		await vault.create("Team/Jane Doe/1-on-1s/2026-09-09.md", "n");
		await vault.create("Team/Jane Doe/avatar.png", "img");
		expect(vault.getMarkdownFiles().map((f) => f.path)).toEqual([
			"Team/Jane Doe/1-on-1s/2026-09-09.md",
		]);
		expect(await vault.exists("Team/Jane Doe")).toBe(true);
		expect(await vault.exists("Team/Gone")).toBe(false);
	});

	it("renames files and folder subtrees, preserving content", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team/Jane Doe/1-on-1s");
		await vault.create("Team/Jane Doe/1-on-1s/2026-09-09.md", "note");
		const person = vault.getAbstractFileByPath("Team/Jane Doe")!;
		await vault.rename(person, "Team/Jane Smith");
		expect(vault.getContent("Team/Jane Smith/1-on-1s/2026-09-09.md")).toBe("note");
		expect(vault.getAbstractFileByPath("Team/Jane Doe")).toBeNull();
		expect(vault.folderPaths()).toContain("Team/Jane Smith/1-on-1s");
	});

	it("adapter mkdir is recursive and idempotent; write creates or overwrites", async () => {
		const vault = createMockVault();
		await vault.adapter.mkdir("Team/Jane/Goals");
		await vault.adapter.mkdir("Team/Jane/Goals"); // no throw
		await vault.adapter.write("Team/Jane/Goals/g.md", "one");
		await vault.adapter.write("Team/Jane/Goals/g.md", "two");
		expect(vault.getContent("Team/Jane/Goals/g.md")).toBe("two");
		expect(await vault.adapter.exists("Team/Jane/Goals/g.md")).toBe(true);
		expect(vault.adapter.existsSync("Team/Jane/Goals")).toBe(true);
		await expect(vault.adapter.write("Missing/p.md", "x")).rejects.toThrow();
	});

	it("delete removes the file", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team");
		const file = await vault.create("Team/x.md", "x");
		await vault.delete(file);
		expect(vault.getAbstractFileByPath("Team/x.md")).toBeNull();
	});
});

describe("createMockMetadataCache", () => {
	it("serves parsed frontmatter for markdown files, null otherwise", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team/Jane Doe/1-on-1s");
		await vault.create(
			"Team/Jane Doe/1-on-1s/2026-09-09.md",
			"---\ntype: one-on-one\nperson: Jane Doe\nmood: 4\n---\nbody",
		);
		const cache = createMockMetadataCache(vault);
		expect(cache.getCache("Team/Jane Doe/1-on-1s/2026-09-09.md")?.frontmatter).toEqual({
			type: "one-on-one",
			person: "Jane Doe",
			mood: 4,
		});
		expect(cache.getCache("Team/Jane Doe/nope.md")).toBeNull();
	});

	it("reflects writes made after cache creation", async () => {
		const vault = createMockVault();
		await vault.createFolder("Team");
		const cache = createMockMetadataCache(vault);
		const file = await vault.create("Team/_index.md", "---\nstatus: archived\n---\n");
		expect(cache.getCache(file.path)?.frontmatter).toEqual({ status: "archived" });
	});
});
