import { App, Modal, Notice, Setting, SuggestModal } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { PersonService, type PersonRecord } from "../person.service";

interface AddPersonInput {
	name: string;
	role: string;
	startDate: string;
}

/** Modal for the quick-add flow: name (required) + role and start date. */
class AddPersonModal extends Modal {
	private name = "";
	private role = "";
	private startDate = "";

	constructor(
		app: App,
		private readonly onSubmit: (input: AddPersonInput) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText("Add team member");

		new Setting(this.contentEl)
			.setName("Name")
			.setDesc("Used as the folder name, e.g. Jane Doe")
			.addText((text) =>
				text.setValue(this.name).onChange((value) => {
					this.name = value;
				}),
			);

		new Setting(this.contentEl).setName("Role").addText((text) =>
			text.setValue(this.role).onChange((value) => {
				this.role = value;
			}),
		);

		new Setting(this.contentEl)
			.setName("Start date")
			.setDesc("Optional, ISO format (YYYY-MM-DD)")
			.addText((text) =>
				text.setPlaceholder("2026-09-10").setValue(this.startDate).onChange((value) => {
					this.startDate = value;
				}),
			);

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText("Add team member")
				.setCta()
				.onClick(() => this.submit()),
		);
	}

	private submit(): void {
		if (this.name.trim() === "") {
			new Notice("Enter a name for the team member.");
			return;
		}
		this.close();
		this.onSubmit({
			name: this.name,
			role: this.role.trim(),
			startDate: this.startDate.trim(),
		});
	}
}

/** Suggest modal over active people for the archive flow. */
class PersonSuggestModal extends SuggestModal<PersonRecord> {
	constructor(
		app: App,
		private readonly people: PersonRecord[],
		private readonly onChoosePerson: (person: PersonRecord) => void,
	) {
		super(app);
	}

	override getSuggestions(query: string): PersonRecord[] {
		const q = query.toLowerCase();
		return this.people.filter((person) =>
			person.name.toLowerCase().includes(q),
		);
	}

	override renderSuggestion(person: PersonRecord, el: HTMLElement): void {
		el.setText(person.role ? `${person.name} — ${person.role}` : person.name);
	}

	override onChooseSuggestion(person: PersonRecord): void {
		this.onChoosePerson(person);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Register the person-roster commands. Callbacks stay thin: gather input in
 * a modal, delegate to PersonService, surface the result as a Notice. All
 * vault access happens inside the service.
 */
export function registerPersonCommands(plugin: TeamSyncPlugin): void {
	// Fresh service per invocation so live settings changes are picked up.
	const service = () =>
		new PersonService(
			plugin.app.vault,
			plugin.settings,
			plugin.app.metadataCache,
		);

	plugin.addCommand({
		id: "teamsync-add-person",
		name: "TeamSync: Add team member",
		callback: () => {
			new AddPersonModal(plugin.app, async (input) => {
				try {
					const person = await service().createPerson(input.name, {
						role: input.role || undefined,
						startDate: input.startDate || undefined,
					});
					new Notice(`Added team member: ${person.name}`);
					const file = await service().getPersonFile(person.name);
					if (file) {
						await plugin.app.workspace.getLeaf(false).openFile(file);
					}
				} catch (error) {
					new Notice(errorMessage(error));
				}
			}).open();
		},
	});

	plugin.addCommand({
		id: "teamsync-archive-person",
		name: "TeamSync: Archive team member",
		callback: () => {
			void (async () => {
				try {
					const people = await service().listPeople();
					if (people.length === 0) {
						new Notice("No active team members to archive.");
						return;
					}
					new PersonSuggestModal(
						plugin.app,
						people,
						async (person) => {
							try {
								const archived = await service().archivePerson(person.name);
								new Notice(
									`Archived ${archived.name}. Their notes and history are preserved.`,
								);
							} catch (error) {
								new Notice(errorMessage(error));
							}
						},
					).open();
				} catch (error) {
					new Notice(errorMessage(error));
				}
			})();
		},
	});
}
