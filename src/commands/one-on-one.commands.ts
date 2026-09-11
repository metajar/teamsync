import { App, Notice, SuggestModal } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { OneOnOneService } from "../one-on-one.service";
import { PersonService } from "../person.service";
import { TopicService } from "../topic.service";

/**
 * Commands for 1:1 logging. Stays thin: parse input (the person suggest
 * modal) → service call → Notice / open the note. All vault access lives in
 * OneOnOneService.
 */

/**
 * Person-picker suggest modal. Defined locally — the roster agent owns a
 * parallel one; the integrator may consolidate the shared shape later.
 */
export class PersonSuggestModal extends SuggestModal<string> {
	private readonly people: string[];
	private readonly onChoosePerson: (person: string) => void;

	constructor(
		app: App,
		people: string[],
		onChoosePerson: (person: string) => void,
	) {
		super(app);
		this.people = people;
		this.onChoosePerson = onChoosePerson;
	}

	override getSuggestions(query: string): string[] {
		const needle = query.toLowerCase();
		return this.people.filter((person) =>
			person.toLowerCase().includes(needle),
		);
	}

	override renderSuggestion(person: string, el: HTMLElement): void {
		el.setText(person);
	}

	override onChooseSuggestion(person: string): void {
		this.onChoosePerson(person);
	}
}

export function registerOneOnOneCommands(plugin: TeamSyncPlugin): void {
	plugin.addCommand({
		id: "teamsync-new-one-on-one",
		name: "New 1:1 note",
		callback: () => {
			void promptAndCreate(plugin);
		},
	});
}

/** Show the person picker, then create and open the chosen person's note. */
async function promptAndCreate(plugin: TeamSyncPlugin): Promise<void> {
	let people: string[];
	try {
		// Consolidated picker source: PersonService.listPeople so archived and
		// lenient-discovery rules match the rest of the plugin.
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
		new Notice(
			"TeamSync: no active people yet — add a person before creating a 1:1 note.",
		);
		return;
	}
	new PersonSuggestModal(plugin.app, people, (person) => {
		void createAndOpenOneOnOne(plugin, person);
	}).open();
}

/**
 * Create the note with the person's queued discussion topics folded into the
 * agenda, then drain the running list. The drain happens only after the note
 * exists, so a failed create never loses queued topics. Services are built
 * per invocation so a mid-session settings change (folder rename, …) takes
 * effect immediately.
 */
async function createAndOpenOneOnOne(
	plugin: TeamSyncPlugin,
	personName: string,
): Promise<void> {
	const oneOnOneService = new OneOnOneService(plugin.app.vault, plugin.settings);
	const topicService = new TopicService(plugin.app.vault, plugin.settings);
	try {
		const topics = await topicService.listTopics(personName);
		const file = await oneOnOneService.createOneOnOne(
			personName,
			undefined,
			topics,
		);
		if (topics.length > 0) {
			await topicService.clearTopics(personName);
			new Notice(
				`TeamSync: moved ${topics.length} discussion topic(s) from the running list into the note.`,
			);
		}
		const leaf = plugin.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	} catch (error) {
		noticeError(`create the 1:1 note for ${personName}`, error);
	}
}

function noticeError(action: string, error: unknown): void {
	const detail = error instanceof Error ? error.message : String(error);
	new Notice(`TeamSync: could not ${action} — ${detail}`);
}
