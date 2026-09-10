import { Modal, Notice, Setting, SuggestModal } from "obsidian";
import type { App } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import {
	GoalService,
	GOAL_STATUSES,
	type GoalRecord,
	type GoalStatus,
} from "../goal.service";
import { PersonService } from "../person.service";

/**
 * Goal commands — thin entry points only: gather input via modals, delegate
 * to GoalService, surface the outcome as a Notice. No vault access and no
 * business logic lives here.
 *
 * Note: uses SuggestModal with plain substring filtering (not
 * FuzzySuggestModal) so the module stays importable under the test stub.
 */
export function registerGoalCommands(plugin: TeamSyncPlugin): void {
	const service = new GoalService(plugin.app.vault, plugin.settings);

	plugin.addCommand({
		id: "teamsync-new-goal",
		name: "New goal",
		callback: () => void promptNewGoal(plugin, service),
	});

	plugin.addCommand({
		id: "teamsync-update-goal-status",
		name: "Update goal status",
		callback: () => void promptUpdateStatus(plugin, service),
	});
}

async function promptNewGoal(plugin: TeamSyncPlugin, service: GoalService): Promise<void> {
	await pickPerson(plugin, (person) => {
		new GoalFormModal(plugin.app, service, person).open();
	});
}

async function promptUpdateStatus(
	plugin: TeamSyncPlugin,
	service: GoalService,
): Promise<void> {
	await pickPerson(plugin, async (person) => {
		try {
			const goals = await service.listGoals(person);
			if (goals.length === 0) {
				new Notice(`${person} has no goals yet — create one first.`);
				return;
			}
			new GoalSuggestModal(plugin.app, goals, (goal) => {
				new StatusSuggestModal(plugin.app, (status) => {
					void service
						.updateStatus(goal.path, status)
						.then(() => {
							new Notice(`"${goal.title}" is now ${status}.`);
						})
						.catch((error: unknown) => {
							new Notice(errorMessage(error));
						});
				}).open();
			}).open();
		} catch (error) {
			new Notice(errorMessage(error));
		}
	});
}

/**
 * Person picker fed by PersonService.listPeople — the same consolidated
 * source the other commands use (active people, consistent archived and
 * lenient-discovery rules) — never the vault directly.
 */
async function pickPerson(
	plugin: TeamSyncPlugin,
	onChoose: (person: string) => void,
): Promise<void> {
	let persons: string[];
	try {
		persons = (
			await new PersonService(
				plugin.app.vault,
				plugin.settings,
				plugin.app.metadataCache,
			).listPeople()
		).map((person) => person.name);
	} catch (error) {
		new Notice(errorMessage(error));
		return;
	}
	if (persons.length === 0) {
		new Notice("No team members found — add a person first.");
		return;
	}
	new PersonSuggestModal(plugin.app, persons, onChoose).open();
}

class PersonSuggestModal extends SuggestModal<string> {
	constructor(
		app: App,
		private readonly persons: string[],
		private readonly onChoose: (person: string) => void,
	) {
		super(app);
	}

	override getSuggestions(query: string): string[] {
		const needle = query.toLowerCase();
		return this.persons.filter((person) => person.toLowerCase().includes(needle));
	}

	override renderSuggestion(person: string, el: HTMLElement): void {
		el.setText(person);
	}

	override onChooseSuggestion(person: string): void {
		this.onChoose(person);
	}
}

class GoalSuggestModal extends SuggestModal<GoalRecord> {
	constructor(
		app: App,
		private readonly goals: GoalRecord[],
		private readonly onChoose: (goal: GoalRecord) => void,
	) {
		super(app);
	}

	override getSuggestions(query: string): GoalRecord[] {
		const needle = query.toLowerCase();
		return this.goals.filter((goal) => goal.title.toLowerCase().includes(needle));
	}

	override renderSuggestion(goal: GoalRecord, el: HTMLElement): void {
		el.setText(`${goal.title} (${goal.status})`);
	}

	override onChooseSuggestion(goal: GoalRecord): void {
		this.onChoose(goal);
	}
}

class StatusSuggestModal extends SuggestModal<GoalStatus> {
	constructor(app: App, private readonly onChoose: (status: GoalStatus) => void) {
		super(app);
	}

	override getSuggestions(): GoalStatus[] {
		return [...GOAL_STATUSES];
	}

	override renderSuggestion(status: GoalStatus, el: HTMLElement): void {
		el.setText(status);
	}

	override onChooseSuggestion(status: GoalStatus): void {
		this.onChoose(status);
	}
}

/** New-goal form: title required; description, target date, links optional. */
class GoalFormModal extends Modal {
	constructor(
		app: App,
		private readonly service: GoalService,
		private readonly person: string,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(`New goal — ${this.person}`);

		let title = "";
		let description = "";
		let targetDate = "";
		let discussedIn = "";

		new Setting(this.contentEl)
			.setName("Title")
			.setDesc("The goal statement, e.g. Improve code review turnaround.")
			.addText((text) =>
				text.setPlaceholder("Improve code review turnaround").onChange((value) => {
					title = value;
				}),
			);

		new Setting(this.contentEl).setName("Description").addText((text) =>
			text.setPlaceholder("Optional — what does done look like?").onChange((value) => {
				description = value;
			}),
		);

		new Setting(this.contentEl)
			.setName("Target date")
			.setDesc("Optional — ISO format YYYY-MM-DD.")
			.addText((text) =>
				text.setPlaceholder("2026-12-31").onChange((value) => {
					targetDate = value;
				}),
			);

		new Setting(this.contentEl)
			.setName("Discussed in")
			.setDesc("Optional — 1:1 note links, comma-separated.")
			.addText((text) =>
				text.setPlaceholder("2026-09-09, 2026-09-23").onChange((value) => {
					discussedIn = value;
				}),
			);

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText("Create goal")
				.setCta()
				.onClick(() => {
					void this.submit(title, description, targetDate, discussedIn);
				}),
		);
	}

	private async submit(
		title: string,
		description: string,
		targetDate: string,
		discussedIn: string,
	): Promise<void> {
		if (title.trim() === "") {
			new Notice("Goal title is required.");
			return;
		}
		try {
			const path = await this.service.createGoal(this.person, {
				title: title.trim(),
				description: description.trim() === "" ? undefined : description.trim(),
				targetDate: targetDate.trim() === "" ? undefined : targetDate.trim(),
				discussedIn:
					discussedIn === ""
						? undefined
						: discussedIn.split(",").map((link) => link.trim()).filter((link) => link !== ""),
			});
			this.close();
			new Notice(`Created goal "${title.trim()}" for ${this.person}.`);
			// Path-based open — no direct file/vault access from the command.
			await this.app.workspace.openLinkText(path, "", false);
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
