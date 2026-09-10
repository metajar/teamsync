import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest, TFile, WorkspaceLeaf } from "obsidian";
import { Modal } from "obsidian";
import TeamSyncPlugin from "../plugin";
import { DEFAULT_SETTINGS } from "../settings";
import type { TeamSyncSettings } from "../settings";
import { buildNote, splitFrontmatter } from "../frontmatter";
import { OllamaError } from "../ollama-client";
import { PrepDraftModal, SendPreviewModal } from "../ai/prep-modal";
import {
	registerAICommands,
	runPrepOneOnOne,
	type PrepAIProvider,
	type PrepCommandOptions,
} from "./ai.commands";
import { createMockVault, createMockMetadataCache } from "../testing/vault-mock";
import type { MockVault } from "../testing/vault-mock";
import { PersonSuggestModal } from "./one-on-one.commands";

/**
 * End-to-end command flow: gate → person picker → send preview (the
 * non-negotiable confirm step) → generate → editable draft modal. Modal
 * open() is spied so no real UI appears; Notice is mocked at the module
 * level so exact user-facing messages can be asserted.
 */

const hoisted = vi.hoisted(() => ({ notices: [] as string[] }));
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class NoticeStub {
		constructor(message: string | DocumentFragment) {
			hoisted.notices.push(String(message));
		}
	}
	return { ...actual, Notice: NoticeStub };
});

/** Create a file (and its folders) in the mock vault with given content. */
async function seedNote(
	vault: MockVault,
	path: string,
	content: string,
): Promise<TFile> {
	await vault.adapter.mkdir(path.slice(0, path.lastIndexOf("/")));
	return vault.create(path, content);
}

/** A fake AI provider that records generate calls. */
function fakeProvider(
	response: string | Error,
): { provider: PrepAIProvider; calls: Array<{ model: string; prompt: string; temperature?: number }> } {
	const calls: Array<{ model: string; prompt: string; temperature?: number }> = [];
	return {
		calls,
		provider: {
			generate: async (request) => {
				calls.push(request);
				if (response instanceof Error) {
					throw response;
				}
				return response;
			},
		},
	};
}

describe("registerAICommands", () => {
	let vault: MockVault;
	let plugin: TeamSyncPlugin;
	let commands: Record<string, { id: string; name?: string; callback: () => unknown }>;
	let openedFiles: TFile[];
	let openedModals: Modal[];
	let openSpy: ReturnType<typeof vi.spyOn>;

	/** Drain the async chain (no real timers involved outside OllamaClient). */
	async function flush(): Promise<void> {
		for (let i = 0; i < 25; i++) {
			await Promise.resolve();
		}
	}

	async function seedTeam(): Promise<void> {
		await seedNote(
			vault,
			"Team/Jane Doe/_index.md",
			buildNote(
				{ type: "person", name: "Jane Doe", role: "Engineer", start_date: "2024-03-01", status: "active" },
				"\n# Jane Doe\n",
			),
		);
		await seedNote(
			vault,
			"Team/Jane Doe/1-on-1s/2026-09-02.md",
			buildNote(
				{ type: "one-on-one", person: "Jane Doe", date: "2026-09-02", action_items_open: 1 },
				"\n## Notes\nworried about launch load.\n- [ ] Send feedback doc\n",
			),
		);
		await seedNote(
			vault,
			"Team/Jane Doe/Goals/2026-q3-improve-reviews.md",
			buildNote(
				{ type: "goal", person: "Jane Doe", title: "Improve reviews", status: "in-progress", created_date: "2026-01-05", target_date: "2026-12-31" },
				"\n## Goal\n",
			),
		);
	}

	function enableAI(settings: Partial<TeamSyncSettings> = {}): void {
		Object.assign(plugin.settings, { ollamaModel: "llama3", ...settings });
	}

	function optionsFor(provider: PrepAIProvider): PrepCommandOptions {
		return {
			createClient: (settings) => {
				// The client must be built per invocation from live settings.
				expect(settings).toBe(plugin.settings);
				return provider;
			},
		};
	}

	/** Run the command through the person picker and choose Jane. */
	async function pickJane(options: PrepCommandOptions): Promise<void> {
		await runPrepOneOnOne(plugin, options);
		await flush();
		const picker = [...openedModals]
			.reverse()
			.find((modal): modal is PersonSuggestModal => modal instanceof PersonSuggestModal);
		expect(picker).toBeInstanceOf(PersonSuggestModal);
		picker!.onChooseSuggestion("Jane Doe");
		await flush();
	}

	/** The last-opened modal matching a class — the head of the flow. */
	function modalOf<T extends Modal>(cls: new (...args: never[]) => T): T | undefined {
		const found = [...openedModals]
			.reverse()
			.find((modal) => modal instanceof cls);
		return found as T | undefined;
	}

	beforeEach(async () => {
		vault = createMockVault();
		await seedTeam();
		hoisted.notices.length = 0;
		openedFiles = [];
		openedModals = [];

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
			metadataCache: createMockMetadataCache(vault),
			workspace: { getLeaf: () => leaf },
		} as unknown as App;
		plugin.settings = { ...DEFAULT_SETTINGS };

		openSpy = vi
			.spyOn(Modal.prototype, "open")
			.mockImplementation(function mockOpen(this: Modal) {
				openedModals.push(this);
			});

		registerAICommands(plugin);
		commands = (plugin as unknown as {
			commands: Record<string, { id: string; name?: string; callback: () => unknown }>;
		}).commands;
	});

	afterEach(() => {
		openSpy.mockRestore();
	});

	it("registers the teamsync-prep-one-on-one command", () => {
		expect(Object.keys(commands)).toEqual(["teamsync-prep-one-on-one"]);
		expect(commands["teamsync-prep-one-on-one"]?.name).toBe("Prep 1:1 with AI");
	});

	it("exits before any vault read or modal when no model is configured", async () => {
		commands["teamsync-prep-one-on-one"]?.callback();
		await flush();
		expect(hoisted.notices).toContain(
			"TeamSync: No AI model configured — see settings (Ollama section).",
		);
		expect(openedModals).toHaveLength(0);
	});

	it("notices and exits when there are no active people", async () => {
		await vault.delete(vault.getAbstractFileByPath("Team/Jane Doe/_index.md") as TFile);
		enableAI();
		await runPrepOneOnOne(plugin);
		await flush();
		expect(hoisted.notices).toContain("TeamSync: no active people yet — add a person first.");
		expect(openedModals).toHaveLength(0);
	});

	it("shows the send preview with the exact prompt before any send, and nothing sends on Cancel", async () => {
		enableAI();
		const { provider, calls } = fakeProvider("BRIEF");
		await pickJane(optionsFor(provider));

		const preview = modalOf(SendPreviewModal);
		expect(preview).toBeInstanceOf(SendPreviewModal);
		expect(preview!.targetUrl).toBe(plugin.settings.ollamaUrl);
		// The preview shows exactly what will be transmitted: the full prompt,
		// assembled from the person's real notes and goals.
		expect(preview!.prompt).toContain("worried about launch load.");
		expect(preview!.prompt).toContain("Improve reviews");
		expect(preview!.prompt).toContain("Send feedback doc");

		// Cancel = close without confirmSend: no generate call, nothing else opens.
		preview!.close();
		await flush();
		expect(calls).toHaveLength(0);
		expect(modalOf(PrepDraftModal)).toBeUndefined();
	});

	it("sends only after confirmation, then shows the editable draft with citations", async () => {
		enableAI({ ollamaTemperature: 0.7 });
		const { provider, calls } = fakeProvider("SUGGESTED BRIEF");
		await pickJane(optionsFor(provider));

		const preview = modalOf(SendPreviewModal)!;
		preview.confirmSend();
		await flush();

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			model: "llama3",
			prompt: preview.prompt, // exactly what the preview displayed
			temperature: 0.7,
		});

		const draft = modalOf(PrepDraftModal);
		expect(draft).toBeInstanceOf(PrepDraftModal);
		expect(draft!.draftText).toBe("SUGGESTED BRIEF");
		expect(draft!.personName).toBe("Jane Doe");
		expect(draft!.sources).toContainEqual({
			path: "Team/Jane Doe/1-on-1s/2026-09-02.md",
			date: "2026-09-02",
			kind: "one-on-one",
		});
	});

	it("surfaces a typed AI error as a Notice and exits cleanly", async () => {
		enableAI();
		const { provider } = fakeProvider(
			new OllamaError("unreachable", "Could not reach the Ollama server at http://localhost:11434 — is it running?"),
		);
		await pickJane(optionsFor(provider));
		modalOf(SendPreviewModal)!.confirmSend();
		await flush();

		expect(hoisted.notices).toContain(
			"Could not reach the Ollama server at http://localhost:11434 — is it running?",
		);
		expect(modalOf(PrepDraftModal)).toBeUndefined();
		// Core data untouched: the seeded files are all still there.
		expect(vault.getMarkdownFiles()).toHaveLength(3);
	});

	it("inserts the EDITED draft into a new 1:1 note and opens it", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 8, 10, 9, 0, 0)); // local 2026-09-10
		try {
			enableAI();
			const { provider } = fakeProvider("RAW BRIEF");
			await pickJane(optionsFor(provider));
			modalOf(SendPreviewModal)!.confirmSend();
			await flush();

			const draft = modalOf(PrepDraftModal)!;
			draft.draftText = "EDITED BRIEF"; // the user edits in the textarea
			await draft.insertIntoNote();
			await flush();

			const path = "Team/Jane Doe/1-on-1s/2026-09-10.md";
			const content = vault.getContent(path);
			expect(content).toBeDefined();
			const { frontmatter, body } = splitFrontmatter(content!);
			expect(frontmatter.type).toBe("one-on-one");
			expect(frontmatter.person).toBe("Jane Doe");
			// The note keeps its template body and gains the edited draft.
			expect(body).toContain("## Agenda / Talking Points");
			expect(body).toContain("EDITED BRIEF");
			expect(body).not.toContain("RAW BRIEF");
			expect(openedFiles.map((file) => file.path)).toEqual([path]);
			expect(hoisted.notices).toContain("Draft inserted into a new 1:1 note for Jane Doe.");
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses the model configured at invocation time, not registration time", async () => {
		enableAI({ ollamaModel: "first-model" });
		const first = fakeProvider("BRIEF 1");
		await pickJane(optionsFor(first.provider));
		modalOf(SendPreviewModal)!.confirmSend();
		await flush();
		expect(first.calls.map((call) => call.model)).toEqual(["first-model"]);

		// Settings change after registration — the next run must use them.
		enableAI({ ollamaModel: "second-model" });
		const second = fakeProvider("BRIEF 2");
		await pickJane(optionsFor(second.provider));
		modalOf(SendPreviewModal)!.confirmSend();
		await flush();
		expect(second.calls.map((call) => call.model)).toEqual(["second-model"]);
	});

	it("renders both modals' onOpen without a real DOM (stub smoke test)", async () => {
		enableAI();
		const { provider } = fakeProvider("BRIEF");
		await pickJane(optionsFor(provider));
		expect(() => modalOf(SendPreviewModal)!.onOpen()).not.toThrow();

		modalOf(SendPreviewModal)!.confirmSend();
		await flush();
		const draft = modalOf(PrepDraftModal)!;
		expect(() => draft.onOpen()).not.toThrow();
		// Draft text survives onOpen (textarea binding keeps draftText intact).
		expect(draft.draftText).toBe("BRIEF");
	});
});
