import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuggestModal } from "obsidian";
import type { App, PluginManifest, TFile, WorkspaceLeaf } from "obsidian";
import TeamSyncPlugin from "./plugin";
import { DEFAULT_SETTINGS } from "./settings";
import type { TeamSyncSettings } from "./settings";
import { buildNote, splitFrontmatter } from "./frontmatter";
import {
	extractOpenActionItems,
	OneOnOneService,
} from "./one-on-one.service";
import {
	PersonSuggestModal,
	registerOneOnOneCommands,
} from "./commands/one-on-one.commands";
import { ONE_ON_ONE_TEMPLATE } from "./templates/one-on-one";
import { renderTemplate } from "./template-engine";
import { createMockVault } from "./testing/vault-mock";
import type { MockVault } from "./testing/vault-mock";
import { joinPath, oneOnOneFolder } from "./paths";

/** Create a file (and its folders) in the mock vault with given content. */
async function seedNote(
	vault: MockVault,
	path: string,
	content: string,
): Promise<TFile> {
	await vault.adapter.mkdir(path.slice(0, path.lastIndexOf("/")));
	return vault.create(path, content);
}

/** A minimal pre-existing 1:1 note with a mixed action-item body. */
function priorNoteContent(
	person: string,
	date: string,
	body: string,
	actionItemsOpen = 2,
): string {
	return buildNote(
		{ type: "one-on-one", person, date, action_items_open: actionItemsOpen },
		`\n${body}`,
	);
}

const JANE_PRIOR_BODY = [
	"## Action Items",
	"",
	"- [ ] Send feedback doc",
	"- [x] Book offsite",
	"- [X] Submit expense report",
	"  - [ ] Nested sub-item",
	"Remind me to [ ] file something",
	"- not a checkbox",
	"- [ ]",
	"- [ ]   Trim trailing spaces   ",
	"",
].join("\n");

describe("extractOpenActionItems", () => {
	it("collects only top-level open checkboxes with text, in order", () => {
		expect(extractOpenActionItems(JANE_PRIOR_BODY)).toEqual([
			"Send feedback doc",
			"Trim trailing spaces",
		]);
	});

	it("ignores done checkboxes in every case variant", () => {
		const body = "- [x] a\n- [X] b\n- [ ] c";
		expect(extractOpenActionItems(body)).toEqual(["c"]);
	});

	it("ignores prose, plain list items, and empty checkboxes", () => {
		const body = [
			"Some prose about - [ ] things",
			"- plain item",
			"- [ ]",
			"- [ ]    ",
			"[ ] not a list",
			"1. [ ] ordered list",
		].join("\n");
		expect(extractOpenActionItems(body)).toEqual([]);
	});

	it("does not match the template's empty scaffolding checkbox", () => {
		const { body } = splitFrontmatter(
			renderTemplate(ONE_ON_ONE_TEMPLATE, {
				person: "Jane Doe",
				date: "2026-09-10",
				carried_forward: "",
			}),
		);
		expect(extractOpenActionItems(body)).toEqual([]);
	});
});

describe("ONE_ON_ONE_TEMPLATE", () => {
	it("renders every dynamic field and all five sections", () => {
		const rendered = renderTemplate(ONE_ON_ONE_TEMPLATE, {
			person: "Jane Doe",
			date: "2026-09-10",
			carried_forward: "### Carried forward from 2026-09-02\n- [ ] item\n",
		});
		expect(rendered).toContain("# 1:1 — Jane Doe — 2026-09-10");
		expect(rendered).toContain("### Carried forward from 2026-09-02\n- [ ] item");
		for (const section of [
			"## Agenda / Talking Points",
			"## Notes",
			"## Wins / Concerns",
			"## Action Items",
			"## Pulse",
		]) {
			expect(rendered).toContain(section);
		}
		expect(rendered).not.toContain("{{");
	});

	it("renders with an empty carried-forward slot and no leftover heading", () => {
		const rendered = renderTemplate(ONE_ON_ONE_TEMPLATE, {
			person: "Jane Doe",
			date: "2026-09-10",
		});
		expect(rendered).not.toContain("Carried forward");
		expect(rendered).not.toContain("{{");
	});
});

describe("OneOnOneService.createOneOnOne", () => {
	let vault: MockVault;
	let service: OneOnOneService;

	beforeEach(() => {
		vault = createMockVault();
		service = new OneOnOneService(vault, { ...DEFAULT_SETTINGS });
	});

	it("creates the note at the settings-derived path with exact frontmatter", async () => {
		const file = await service.createOneOnOne("Jane Doe", "2026-09-05");
		expect(file.path).toBe("Team/Jane Doe/1-on-1s/2026-09-05.md");

		const { frontmatter, body } = splitFrontmatter(
			vault.getContent("Team/Jane Doe/1-on-1s/2026-09-05.md")!,
		);
		expect(frontmatter).toEqual({
			type: "one-on-one",
			person: "Jane Doe",
			date: "2026-09-05",
			mood: "",
			action_items_open: 0,
		});
		expect(body).toContain("# 1:1 — Jane Doe — 2026-09-05");
		expect(body).not.toContain("Carried forward");
	});

	it("honors customized settings folders", async () => {
		const settings: TeamSyncSettings = {
			...DEFAULT_SETTINGS,
			rootFolder: "Managees",
			oneOnOnesFolder: "One-on-Ones",
		};
		const customService = new OneOnOneService(createMockVault(), settings);
		const file = await customService.createOneOnOne("Bob", "2026-09-05");
		expect(file.path).toBe("Managees/Bob/One-on-Ones/2026-09-05.md");
	});

	it("defaults the date to today (local time)", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0)); // 2026-09-10 local
		try {
			const file = await service.createOneOnOne("Jane Doe");
			expect(file.path).toBe("Team/Jane Doe/1-on-1s/2026-09-10.md");
		} finally {
			vi.useRealTimers();
		}
	});

	it("suffixes same-day collisions and preserves the original note", async () => {
		await seedNote(
			vault,
			"Team/Jane Doe/1-on-1s/2026-09-10.md",
			"---\ntype: one-on-one\nperson: Jane Doe\ndate: 2026-09-10\n---\noriginal",
		);
		const second = await service.createOneOnOne("Jane Doe", "2026-09-10");
		const third = await service.createOneOnOne("Jane Doe", "2026-09-10");

		expect(second.path).toBe("Team/Jane Doe/1-on-1s/2026-09-10-2.md");
		expect(third.path).toBe("Team/Jane Doe/1-on-1s/2026-09-10-3.md");
		expect(vault.getContent("Team/Jane Doe/1-on-1s/2026-09-10.md")).toContain(
			"original",
		);
	});

	it("carries forward only open items from the latest note", async () => {
		await seedNote(
			vault,
			"Team/Jane Doe/1-on-1s/2026-09-02.md",
			priorNoteContent("Jane Doe", "2026-09-02", JANE_PRIOR_BODY),
		);

		await service.createOneOnOne("Jane Doe", "2026-09-10");

		const { frontmatter, body } = splitFrontmatter(
			vault.getContent("Team/Jane Doe/1-on-1s/2026-09-10.md")!,
		);
		expect(frontmatter.action_items_open).toBe(2);
		const agenda = body.slice(
			body.indexOf("## Agenda / Talking Points"),
			body.indexOf("## Notes"),
		);
		expect(agenda).toContain("### Carried forward from 2026-09-02");
		expect(agenda).toContain("- [ ] Send feedback doc");
		expect(agenda).toContain("- [ ] Trim trailing spaces");
		// Done, nested, prose, and empty-checkbox lines must not carry over.
		expect(agenda).not.toContain("Book offsite");
		expect(agenda).not.toContain("expense");
		expect(agenda).not.toContain("Nested");
		expect(agenda).not.toContain("file something");
		expect(agenda).not.toContain("- [ ]\n");
		// Carried items land inside the agenda, before the Notes section.
		expect(body.indexOf("Carried forward")).toBeLessThan(
			body.indexOf("## Notes"),
		);
	});

	it("omits the carried-forward block when the latest note has no open items", async () => {
		await seedNote(
			vault,
			"Team/Jane Doe/1-on-1s/2026-09-02.md",
			priorNoteContent(
				"Jane Doe",
				"2026-09-02",
				"- [x] all done\n- [ ]  \n",
			),
		);

		await service.createOneOnOne("Jane Doe", "2026-09-10");

		const { frontmatter, body } = splitFrontmatter(
			vault.getContent("Team/Jane Doe/1-on-1s/2026-09-10.md")!,
		);
		expect(body).not.toContain("Carried forward");
		expect(frontmatter.action_items_open).toBe(0);
	});

	it("does not rewrite the previous note when carrying forward", async () => {
		const priorPath = "Team/Jane Doe/1-on-1s/2026-09-02.md";
		const prior = priorNoteContent("Jane Doe", "2026-09-02", JANE_PRIOR_BODY);
		await seedNote(vault, priorPath, prior);

		await service.createOneOnOne("Jane Doe", "2026-09-10");

		expect(vault.getContent(priorPath)).toBe(prior);
	});
});

describe("OneOnOneService listing and counts", () => {
	let vault: MockVault;
	let service: OneOnOneService;

	beforeEach(async () => {
		vault = createMockVault();
		service = new OneOnOneService(vault, { ...DEFAULT_SETTINGS });
		const folder = oneOnOneFolder(DEFAULT_SETTINGS, "Jane Doe");
		// Created out of chronological order; frontmatter dates are what count.
		await seedNote(
			vault,
			joinPath(folder, "2026-09-10.md"),
			priorNoteContent("Jane Doe", "2026-09-10", "- [ ] late"),
		);
		await seedNote(
			vault,
			joinPath(folder, "2026-09-02.md"),
			priorNoteContent("Jane Doe", "2026-09-02", "- [x] early", 0),
		);
		await seedNote(
			vault,
			joinPath(folder, "2026-09-05.md"),
			priorNoteContent("Jane Doe", "2026-09-05", "- [ ] mid\n- [ ] second"),
		);
		// Noise in the same folder: wrong type and no frontmatter.
		await seedNote(
			vault,
			joinPath(folder, "scratch.md"),
			"---\ntype: dev-plan\nperson: Jane Doe\ndate: 2026-09-06\n---\n",
		);
		await seedNote(vault, joinPath(folder, "plain.md"), "just text");
	});

	it("lists notes chronologically by frontmatter date, excluding other types", async () => {
		const notes = await service.listOneOnOnes("Jane Doe");
		expect(notes.map((note) => note.date)).toEqual([
			"2026-09-02",
			"2026-09-05",
			"2026-09-10",
		]);
		expect(notes.map((note) => note.file.name)).toEqual([
			"2026-09-02.md",
			"2026-09-05.md",
			"2026-09-10.md",
		]);
	});

	it("returns an empty list for a person with no notes", async () => {
		expect(await service.listOneOnOnes("Nobody")).toEqual([]);
		expect(await service.getLatestOneOnOne("Nobody")).toBeNull();
	});

	it("picks the latest by frontmatter date, breaking ties by creation", async () => {
		// Same frontmatter date as 2026-09-10.md but created later.
		await seedNote(
			vault,
			joinPath(oneOnOneFolder(DEFAULT_SETTINGS, "Jane Doe"), "2026-09-10-2.md"),
			priorNoteContent("Jane Doe", "2026-09-10", "- [ ] follow-up"),
		);
		const latest = await service.getLatestOneOnOne("Jane Doe");
		expect(latest?.file.name).toBe("2026-09-10-2.md");
	});

	it("exposes the frontmatter open-item count on listed notes", async () => {
		const notes = await service.listOneOnOnes("Jane Doe");
		expect(notes.map((note) => note.actionItemsOpen)).toEqual([0, 2, 2]);
	});

	it("countOpenActionItems scans the latest note's live checkboxes", async () => {
		expect(await service.countOpenActionItems("Jane Doe")).toBe(1); // 2026-09-10: "- [ ] late"
		expect(await service.countOpenActionItems("Nobody")).toBe(0);
	});
});

describe("OneOnOneService.listActivePeople", () => {
	it("returns people with an index note that is not archived, sorted", async () => {
		const vault = createMockVault();
		const service = new OneOnOneService(vault, { ...DEFAULT_SETTINGS });
		await seedNote(
			vault,
			"Team/Jane Doe/_index.md",
			"---\ntype: person\nname: Jane Doe\nstatus: active\n---\n",
		);
		await seedNote(
			vault,
			"Team/Bob Builder/_index.md",
			"---\ntype: person\nname: Bob Builder\nstatus: archived\n---\n",
		);
		// No status field defaults to active; missing type is tolerated.
		await seedNote(vault, "Team/Carol/_index.md", "---\ntype: person\n---\n");
		// Folder without an index note, and a loose root file, are not people.
		await vault.adapter.mkdir("Team/Dan/Goals");
		await seedNote(vault, "Team/README.md", "notes");

		expect(await service.listActivePeople()).toEqual(["Carol", "Jane Doe"]);
	});

	it("returns [] when the root folder does not exist", async () => {
		const service = new OneOnOneService(createMockVault(), {
			...DEFAULT_SETTINGS,
		});
		expect(await service.listActivePeople()).toEqual([]);
	});
});

describe("registerOneOnOneCommands", () => {
	let vault: MockVault;
	let plugin: TeamSyncPlugin;
	let commands: Record<string, { id: string; name?: string; callback: () => unknown }>;
	let openedFiles: TFile[];
	let openSpy: ReturnType<typeof vi.spyOn>;
	let shownModal: PersonSuggestModal | null;

	/** Drain the async chain (no real timers involved in the service). */
	async function flush(): Promise<void> {
		for (let i = 0; i < 20; i++) {
			await Promise.resolve();
		}
	}

	beforeEach(async () => {
		vault = createMockVault();
		await seedNote(
			vault,
			"Team/Jane Doe/_index.md",
			"---\ntype: person\nname: Jane Doe\nstatus: active\n---\n",
		);
		await seedNote(
			vault,
			"Team/Bob/_index.md",
			"---\ntype: person\nname: Bob\nstatus: active\n---\n",
		);

		plugin = new TeamSyncPlugin(
			undefined as unknown as App,
			{} as unknown as PluginManifest,
		);
		const leaf = {
			openFile: async (file: TFile): Promise<void> => {
				openedFiles.push(file);
			},
		} as unknown as WorkspaceLeaf;
		plugin.app = {
			vault,
			workspace: { getLeaf: () => leaf },
		} as unknown as App;
		plugin.settings = { ...DEFAULT_SETTINGS };

		openedFiles = [];
		shownModal = null;
		openSpy = vi
			.spyOn(SuggestModal.prototype, "open")
			.mockImplementation(function mockOpen(this: PersonSuggestModal) {
				shownModal = this;
			});
		registerOneOnOneCommands(plugin);
		commands = (
			plugin as unknown as {
				commands: Record<
					string,
					{ id: string; name?: string; callback: () => unknown }
				>;
			}
		).commands;
	});

	afterEach(() => {
		openSpy.mockRestore();
	});

	it("registers the teamsync-new-one-on-one command", () => {
		expect(Object.keys(commands)).toEqual(["teamsync-new-one-on-one"]);
		expect(commands["teamsync-new-one-on-one"]?.name).toBe(
			"New 1:1 note",
		);
	});

	it("creates and opens the note end-to-end from the picker", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0)); // local 2026-09-10
		try {
			commands["teamsync-new-one-on-one"]?.callback();
			await flush();

			// The modal was shown over active people and filters by query.
			expect(shownModal).toBeInstanceOf(PersonSuggestModal);
			expect(shownModal!.getSuggestions("jan")).toEqual(["Jane Doe"]);
			expect(shownModal!.getSuggestions("")).toEqual(["Bob", "Jane Doe"]);

			shownModal!.onChooseSuggestion("Jane Doe");
			await flush();

			const path = "Team/Jane Doe/1-on-1s/2026-09-10.md";
			expect(vault.getContent(path)).toBeDefined();
			const { frontmatter } = splitFrontmatter(vault.getContent(path)!);
			expect(frontmatter.type).toBe("one-on-one");
			expect(openedFiles.map((file) => file.path)).toEqual([path]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("creates nothing when the modal is dismissed without a choice", async () => {
		commands["teamsync-new-one-on-one"]?.callback();
		await flush();
		expect(shownModal).toBeInstanceOf(PersonSuggestModal);
		// No onChooseSuggestion call = user cancelled.
		expect(vault.getMarkdownFiles()).toHaveLength(2); // only the two _index.md seeds
	});
});
