import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, SuggestModal } from "obsidian";
import type { App, PluginManifest, TFile, WorkspaceLeaf } from "obsidian";
import TeamSyncPlugin from "../plugin";
import { DEFAULT_SETTINGS } from "../settings";
import { splitFrontmatter } from "../frontmatter";
import { PersonSuggestModal } from "./one-on-one.commands";
import { TopicInputModal, registerTopicCommands } from "./topic.commands";
import { createMockVault } from "../testing/vault-mock";
import type { MockVault } from "../testing/vault-mock";

describe("registerTopicCommands", () => {
	let vault: MockVault;
	let plugin: TeamSyncPlugin;
	let commands: Record<
		string,
		{ id: string; name?: string; callback: () => unknown }
	>;
	let openedFiles: TFile[];
	let suggestSpy: ReturnType<typeof vi.spyOn>;
	let modalSpy: ReturnType<typeof vi.spyOn>;
	let shownSuggest: PersonSuggestModal | null;
	let shownInput: TopicInputModal | null;

	/** Drain the async chain (no real timers involved in the service). */
	async function flush(): Promise<void> {
		for (let i = 0; i < 20; i++) {
			await Promise.resolve();
		}
	}

	beforeEach(async () => {
		vault = createMockVault();
		await vault.adapter.mkdir("Team/Jane Doe");
		await vault.create(
			"Team/Jane Doe/_index.md",
			"---\ntype: person\nname: Jane Doe\nstatus: active\n---\n",
		);
		await vault.adapter.mkdir("Team/Bob");
		await vault.create(
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
		shownSuggest = null;
		shownInput = null;
		suggestSpy = vi
			.spyOn(SuggestModal.prototype, "open")
			.mockImplementation(function mockOpen(this: PersonSuggestModal) {
				shownSuggest = this;
			});
		modalSpy = vi
			.spyOn(Modal.prototype, "open")
			.mockImplementation(function mockOpen(this: TopicInputModal) {
				if (this instanceof TopicInputModal) {
					shownInput = this;
				}
			});
		registerTopicCommands(plugin);
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
		suggestSpy.mockRestore();
		modalSpy.mockRestore();
	});

	it("registers the add-topic and open-topics commands", () => {
		expect(Object.keys(commands)).toEqual([
			"teamsync-add-topic",
			"teamsync-open-topics",
		]);
		expect(commands["teamsync-add-topic"]?.name).toBe(
			"Add topic for discussion",
		);
		expect(commands["teamsync-open-topics"]?.name).toBe(
			"Open discussion topics list",
		);
	});

	it("adds a topic end-to-end from the pickers", async () => {
		commands["teamsync-add-topic"]?.callback();
		await flush();

		expect(shownSuggest).toBeInstanceOf(PersonSuggestModal);
		shownSuggest!.onChooseSuggestion("Jane Doe");
		await flush();

		expect(shownInput).toBeInstanceOf(TopicInputModal);
		shownInput!.onOpen(); // build the input element (open was mocked out)
		shownInput!.inputEl!.value = "  Talk about growth  ";
		shownInput!.submit();
		await flush();

		const { frontmatter, body } = splitFrontmatter(
			vault.getContent("Team/Jane Doe/topics.md")!,
		);
		expect(frontmatter).toEqual({ type: "topics", person: "Jane Doe" });
		expect(body).toContain("- Talk about growth");
	});

	it("rejects an empty topic without writing anything", async () => {
		commands["teamsync-add-topic"]?.callback();
		await flush();
		shownSuggest!.onChooseSuggestion("Jane Doe");
		await flush();

		shownInput!.onOpen();
		shownInput!.inputEl!.value = "   ";
		shownInput!.submit();
		await flush();

		expect(vault.getContent("Team/Jane Doe/topics.md")).toBeUndefined();
	});

	it("adds nothing when the person modal is dismissed", async () => {
		commands["teamsync-add-topic"]?.callback();
		await flush();
		// No onChooseSuggestion call = user cancelled.
		expect(vault.getMarkdownFiles()).toHaveLength(2); // only the seeds
	});

	it("opens the topics list, creating it when missing", async () => {
		commands["teamsync-open-topics"]?.callback();
		await flush();
		shownSuggest!.onChooseSuggestion("Bob");
		await flush();

		expect(openedFiles.map((file) => file.path)).toEqual([
			"Team/Bob/topics.md",
		]);
		expect(vault.getContent("Team/Bob/topics.md")).toContain(
			"## Discussion topics",
		);
	});

	it("opens an existing topics list without rewriting it", async () => {
		await vault.create(
			"Team/Bob/topics.md",
			"---\ntype: topics\nperson: Bob\n---\n## Discussion topics\n\n- hand-added\n",
		);
		const before = vault.getContent("Team/Bob/topics.md");

		commands["teamsync-open-topics"]?.callback();
		await flush();
		shownSuggest!.onChooseSuggestion("Bob");
		await flush();

		expect(openedFiles.map((file) => file.path)).toEqual([
			"Team/Bob/topics.md",
		]);
		expect(vault.getContent("Team/Bob/topics.md")).toBe(before);
	});
});
