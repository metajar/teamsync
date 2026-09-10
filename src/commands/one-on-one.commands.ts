import { App, Notice, SuggestModal } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { OneOnOneService } from "../one-on-one.service";
import { PersonService } from "../person.service";

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
	const service = new OneOnOneService(plugin.app.vault, plugin.settings);

	plugin.addCommand({
		id: "teamsync-new-one-on-one",
		name: "New 1:1 note",
		callback: () => {
			void promptAndCreate(plugin, service);
		},
	});
}

/** Show the person picker, then create and open the chosen person's note. */
async function promptAndCreate(
	plugin: TeamSyncPlugin,
	service: OneOnOneService,
): Promise<void> {
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
		void createAndOpenOneOnOne(plugin, service, person);
	}).open();
}

async function createAndOpenOneOnOne(
	plugin: TeamSyncPlugin,
	service: OneOnOneService,
	personName: string,
): Promise<void> {
	try {
		const file = await service.createOneOnOne(personName);
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
