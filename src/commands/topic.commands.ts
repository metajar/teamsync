import { App, Modal, Notice } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { PersonService } from "../person.service";
import { TopicService } from "../topic.service";
import { PersonSuggestModal } from "./one-on-one.commands";

/**
 * Commands for the per-person running list of 1:1 discussion topics. Stays
 * thin: parse input (person picker, topic text) → service call → Notice /
 * open the note. All vault access lives in TopicService.
 */

/**
 * Text-input modal for one topic line. On submit the trimmed value goes to
 * the caller's callback (empty input is rejected with a Notice); closing
 * without submitting is the cancel path.
 */
export class TopicInputModal extends Modal {
	private readonly personName: string;
	private readonly onSubmitTopic: (topic: string) => void;
	/** The single-line input element, created in onOpen — exposed for tests. */
	inputEl: HTMLInputElement | null = null;

	constructor(
		app: App,
		personName: string,
		onSubmitTopic: (topic: string) => void,
	) {
		super(app);
		this.personName = personName;
		this.onSubmitTopic = onSubmitTopic;
	}

	override onOpen(): void {
		this.titleEl.setText(`Add topic for ${this.personName}`);
		this.inputEl = this.contentEl.createEl("input", {
			type: "text",
			attr: { autofocus: "true" },
		}) as unknown as HTMLInputElement;
		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				this.submit();
			}
		});
		this.contentEl.createEl("button", { text: "Add topic" }).addEventListener(
			"click",
			() => this.submit(),
		);
	}

	/** Submit the current input value; empty input is rejected, not submitted. */
	submit(): void {
		const topic = this.inputEl?.value.trim() ?? "";
		if (topic === "") {
			new Notice("TeamSync: topic cannot be empty.");
			return;
		}
		this.close();
		this.onSubmitTopic(topic);
	}
}

export function registerTopicCommands(plugin: TeamSyncPlugin): void {
	plugin.addCommand({
		id: "teamsync-add-topic",
		name: "Add topic for discussion",
		callback: () => {
			void promptAndAddTopic(plugin);
		},
	});

	plugin.addCommand({
		id: "teamsync-open-topics",
		name: "Open discussion topics list",
		callback: () => {
			void promptAndOpenTopics(plugin);
		},
	});
}

/** Show the person picker, then the topic input, then append to the list. */
async function promptAndAddTopic(plugin: TeamSyncPlugin): Promise<void> {
	const people = await listPeople(plugin);
	if (!people) {
		return;
	}
	new PersonSuggestModal(plugin.app, people, (person) => {
		new TopicInputModal(plugin.app, person, (topic) => {
			void addTopic(plugin, person, topic);
		}).open();
	}).open();
}

async function addTopic(
	plugin: TeamSyncPlugin,
	personName: string,
	topic: string,
): Promise<void> {
	try {
		const queue = await new TopicService(
			plugin.app.vault,
			plugin.settings,
		).addTopic(personName, topic);
		new Notice(
			`TeamSync: topic added for ${personName} — ${queue.length} topic(s) queued for the next 1:1.`,
		);
	} catch (error) {
		noticeError(`add the topic for ${personName}`, error);
	}
}

/** Show the person picker, then open (creating if needed) their topics note. */
async function promptAndOpenTopics(plugin: TeamSyncPlugin): Promise<void> {
	const people = await listPeople(plugin);
	if (!people) {
		return;
	}
	new PersonSuggestModal(plugin.app, people, (person) => {
		void openTopics(plugin, person);
	}).open();
}

async function openTopics(
	plugin: TeamSyncPlugin,
	personName: string,
): Promise<void> {
	try {
		const file = await new TopicService(
			plugin.app.vault,
			plugin.settings,
		).ensureTopicsFile(personName);
		const leaf = plugin.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	} catch (error) {
		noticeError(`open the topics list for ${personName}`, error);
	}
}

/** Active people for the picker, or null after an error/empty-roster Notice. */
async function listPeople(plugin: TeamSyncPlugin): Promise<string[] | null> {
	try {
		const people = (
			await new PersonService(
				plugin.app.vault,
				plugin.settings,
				plugin.app.metadataCache,
			).listPeople()
		).map((person) => person.name);
		if (people.length === 0) {
			new Notice(
				"TeamSync: no active people yet — add a person before working with discussion topics.",
			);
			return null;
		}
		return people;
	} catch (error) {
		noticeError("list people", error);
		return null;
	}
}

function noticeError(action: string, error: unknown): void {
	const detail = error instanceof Error ? error.message : String(error);
	new Notice(`TeamSync: could not ${action} — ${detail}`);
}
