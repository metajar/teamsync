import { Notice, TFile } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import type { TeamSyncSettings } from "../settings";
import { assemblePrepContext, type PrepContext } from "../ai/prep-context";
import {
	assembleOverviewContext,
	type OverviewContext,
} from "../ai/overview-context";
import {
	OverviewDraftModal,
	PrepDraftModal,
	SendPreviewModal,
} from "../ai/prep-modal";
import { buildNote } from "../frontmatter";
import { describeOllamaError, OllamaClient } from "../ollama-client";
import { overviewPath } from "../paths";
import { PersonService } from "../person.service";
import { PersonSuggestModal } from "./one-on-one.commands";

/**
 * AI commands. Stays thin like the other command modules: pick a person,
 * assemble context, show the send-preview modal, generate, show the
 * editable draft. All vault access goes through services; all network
 * access goes through OllamaClient.
 *
 * Services and the client are built per invocation (never captured at
 * registration) so the live settings object is always the one in use.
 */

/** The slice of OllamaClient these flows need — injectable for tests. */
export interface PrepAIProvider {
	generate(request: {
		model: string;
		prompt: string;
		temperature?: number;
	}): Promise<string>;
}

export interface PrepCommandOptions {
	/** Test seam: builds the AI client per invocation. */
	createClient?: (settings: TeamSyncSettings) => PrepAIProvider;
}

export function registerAICommands(plugin: TeamSyncPlugin): void {
	plugin.addCommand({
		id: "teamsync-prep-one-on-one",
		name: "Prep 1:1 with AI",
		callback: () => {
			void runPrepOneOnOne(plugin);
		},
	});
	plugin.addCommand({
		id: "teamsync-generate-overview",
		name: "Generate Overview",
		callback: () => {
			void runGenerateOverview(plugin);
		},
	});
}

/** Entry point for the command — exported for direct testing. */
export async function runPrepOneOnOne(
	plugin: TeamSyncPlugin,
	options: PrepCommandOptions = {},
): Promise<void> {
	// Disable state first: with no model configured there is nothing to do,
	// and we exit before any vault reading or modal opening.
	if (plugin.settings.ollamaModel.trim() === "") {
		new Notice("TeamSync: No AI model configured — see settings (Ollama section).");
		return;
	}

	let people: string[];
	try {
		people = (
			await new PersonService(
				plugin.app.vault,
				plugin.settings,
				plugin.app.metadataCache,
			).listPeople()
		).map((person) => person.name);
	} catch (error) {
		noticeError("list people", error);
		return;
	}
	if (people.length === 0) {
		new Notice("TeamSync: no active people yet — add a person first.");
		return;
	}

	new PersonSuggestModal(plugin.app, people, (person) => {
		void assembleAndPreview(plugin, person, options);
	}).open();
}

/** Assemble the context, then show the send-preview modal — no send yet. */
async function assembleAndPreview(
	plugin: TeamSyncPlugin,
	personName: string,
	options: PrepCommandOptions,
): Promise<void> {
	let context: PrepContext;
	try {
		context = await assemblePrepContext(personName, {
			vault: plugin.app.vault,
			settings: plugin.settings,
			metadataCache: plugin.app.metadataCache,
		});
	} catch (error) {
		noticeError(`assemble the AI prep context for ${personName}`, error);
		return;
	}

	new SendPreviewModal(plugin.app, {
		prompt: context.prompt,
		targetUrl: plugin.settings.ollamaUrl,
		onSend: () => {
			void generateAndShowDraft(plugin, personName, context, options);
		},
	}).open();
}

/** After the user confirms the preview: generate, then show the editable draft. */
async function generateAndShowDraft(
	plugin: TeamSyncPlugin,
	personName: string,
	context: PrepContext,
	options: PrepCommandOptions,
): Promise<void> {
	const settings = plugin.settings;
	const client: PrepAIProvider =
		options.createClient !== undefined
			? options.createClient(settings)
			: new OllamaClient({
					baseUrl: settings.ollamaUrl,
					timeoutMs: settings.ollamaTimeoutMs,
				});

	let draft: string;
	try {
		draft = await client.generate({
			model: settings.ollamaModel,
			prompt: context.prompt,
			temperature: settings.ollamaTemperature,
		});
	} catch (error) {
		// Graceful degradation: typed message, clean exit, nothing corrupted,
		// no core flow blocked. This is the only outcome branch for AI errors.
		new Notice(describeOllamaError(error));
		return;
	}

	new PrepDraftModal(plugin.app, {
		plugin,
		personName,
		draft,
		sources: context.sources,
	}).open();
}

function noticeError(action: string, error: unknown): void {
	const detail = error instanceof Error ? error.message : String(error);
	new Notice(`TeamSync: could not ${action} — ${detail}`);
}

/**
 * Dev-plan read seam for the overview assembler: the AI module must not
 * read the vault itself, and DevPlanService does not exist yet, so this
 * command-layer reader (built on vault.cachedRead) is handed in. Returns
 * null when the file does not exist. TODO: replace with DevPlanService.
 */
function cachedFileReader(
	plugin: TeamSyncPlugin,
): (path: string) => Promise<string | null> {
	return async (path) => {
		const file = plugin.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? plugin.app.vault.cachedRead(file) : null;
	};
}

/** Entry point for the overview command — exported for direct testing. */
export async function runGenerateOverview(
	plugin: TeamSyncPlugin,
	options: PrepCommandOptions = {},
): Promise<void> {
	// Disable state first: with no model configured there is nothing to do,
	// and we exit before any vault reading or modal opening.
	if (plugin.settings.ollamaModel.trim() === "") {
		new Notice("TeamSync: No AI model configured — see settings (Ollama section).");
		return;
	}

	let people: string[];
	try {
		people = (
			await new PersonService(
				plugin.app.vault,
				plugin.settings,
				plugin.app.metadataCache,
			).listPeople()
		).map((person) => person.name);
	} catch (error) {
		noticeError("list people", error);
		return;
	}
	if (people.length === 0) {
		new Notice("TeamSync: no active people yet — add a person first.");
		return;
	}

	new PersonSuggestModal(plugin.app, people, (person) => {
		void assembleAndPreviewOverview(plugin, person, options);
	}).open();
}

/** Assemble the overview context, then show the send-preview modal — no send yet. */
async function assembleAndPreviewOverview(
	plugin: TeamSyncPlugin,
	personName: string,
	options: PrepCommandOptions,
): Promise<void> {
	let context: OverviewContext;
	try {
		context = await assembleOverviewContext(personName, {
			vault: plugin.app.vault,
			settings: plugin.settings,
			metadataCache: plugin.app.metadataCache,
			readFile: cachedFileReader(plugin),
		});
	} catch (error) {
		noticeError(`assemble the AI overview context for ${personName}`, error);
		return;
	}

	// A person with no 1:1 notes and no goals has nothing to summarize —
	// exit before the preview modal so nothing is ever transmitted.
	if (!context.hasMaterial) {
		new Notice(
			`TeamSync: nothing to summarize yet for ${personName} — ` +
				"no 1:1 notes or goals on file.",
		);
		return;
	}

	new SendPreviewModal(plugin.app, {
		prompt: context.prompt,
		targetUrl: plugin.settings.ollamaUrl,
		onSend: () => {
			void generateAndShowOverviewDraft(plugin, personName, context, options);
		},
	}).open();
}

/** After the user confirms the preview: generate, then show the editable draft. */
async function generateAndShowOverviewDraft(
	plugin: TeamSyncPlugin,
	personName: string,
	context: OverviewContext,
	options: PrepCommandOptions,
): Promise<void> {
	const settings = plugin.settings;
	const client: PrepAIProvider =
		options.createClient !== undefined
			? options.createClient(settings)
			: new OllamaClient({
					baseUrl: settings.ollamaUrl,
					timeoutMs: settings.ollamaTimeoutMs,
				});

	let draft: string;
	try {
		draft = await client.generate({
			model: settings.ollamaModel,
			prompt: context.prompt,
			temperature: settings.ollamaTemperature,
		});
	} catch (error) {
		// Graceful degradation: typed message, clean exit, nothing written.
		new Notice(describeOllamaError(error));
		return;
	}

	new OverviewDraftModal(plugin.app, {
		personName,
		draft,
		sources: context.sources,
		onWrite: (body) => writeOverviewAndOpen(plugin, personName, body),
	}).open();
}

/**
 * THIN WRITER SEAM: create-or-replace the person's Overview note with the
 * user-edited draft, then open it. There is no OverviewService yet, so this
 * one vault write lives in the command layer by explicit design decision —
 * reachable only from the draft modal's explicit "Write Overview.md" button
 * (never automatically on generation). Replacing an existing Overview is the
 * product intent: the note is regenerable AI output the user just reviewed.
 * Throws on vault errors so the modal surfaces them and stays open.
 */
async function writeOverviewAndOpen(
	plugin: TeamSyncPlugin,
	personName: string,
	body: string,
): Promise<void> {
	const settings = plugin.settings;
	const vault = plugin.app.vault;
	const path = overviewPath(settings, personName);
	const content = buildNote(
		{
			type: "overview",
			person: personName,
			generated_at: todayISO(),
			model: settings.ollamaModel,
		},
		`\n${body.trim()}\n`,
	);

	const existing = vault.getAbstractFileByPath(path);
	const file =
		existing instanceof TFile
			? (await vault.modify(existing, content), existing)
			: await vault.create(path, content);

	const leaf = plugin.app.workspace.getLeaf(true);
	await leaf.openFile(file);
	new Notice(`Overview written for ${personName} (${path}).`);
}

/** Local-timezone ISO date (YYYY-MM-DD) for "today" — matches the 1:1 note dates. */
function todayISO(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}
