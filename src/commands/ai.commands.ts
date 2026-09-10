import { Notice } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import type { TeamSyncSettings } from "../settings";
import { assemblePrepContext, type PrepContext } from "../ai/prep-context";
import { PrepDraftModal, SendPreviewModal } from "../ai/prep-modal";
import { describeOllamaError, OllamaClient } from "../ollama-client";
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

/** The slice of OllamaClient this flow needs — injectable for tests. */
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
