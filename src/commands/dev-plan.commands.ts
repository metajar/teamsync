import { Notice, SuggestModal } from "obsidian";
import type { App } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { DevPlanService } from "../dev-plan.service";
import { PersonService } from "../person.service";

/**
 * Dev-plan commands — thin entry points only: gather input via the person
 * suggest modal, delegate to DevPlanService, surface the outcome as a
 * Notice. No vault access and no business logic lives here. Services are
 * constructed per invocation so live settings are always used.
 */
export function registerDevPlanCommands(plugin: TeamSyncPlugin): void {
	plugin.addCommand({
		id: "teamsync-create-dev-plan",
		name: "Create development plan",
		callback: () => void promptAndCreate(plugin),
	});

	plugin.addCommand({
		id: "teamsync-mark-dev-plan-reviewed",
		name: "Mark dev plan reviewed",
		callback: () => void promptAndMarkReviewed(plugin),
	});
}

/** Show the person picker, then create and open the chosen person's plan. */
async function promptAndCreate(plugin: TeamSyncPlugin): Promise<void> {
	const people = await listActivePeople(plugin);
	if (people === null) return;
	if (people.length === 0) {
		new Notice(
			"TeamSync: no active people yet — add a person before creating a development plan.",
		);
		return;
	}
	new PersonSuggestModal(plugin.app, people, (person) => {
		void createAndOpen(plugin, person);
	}).open();
}

async function createAndOpen(
	plugin: TeamSyncPlugin,
	personName: string,
): Promise<void> {
	const service = new DevPlanService(plugin.app.vault, plugin.settings);
	try {
		const file = await service.createDevPlan(personName);
		const leaf = plugin.app.workspace.getLeaf(true);
		await leaf.openFile(file);
	} catch (error) {
		// Includes the idempotent "already exists" case — surfaced, not thrown.
		noticeError(`create the development plan for ${personName}`, error);
	}
}

/** Show the person picker, then mark the chosen person's plan reviewed. */
async function promptAndMarkReviewed(plugin: TeamSyncPlugin): Promise<void> {
	const people = await listActivePeople(plugin);
	if (people === null) return;
	if (people.length === 0) {
		new Notice("TeamSync: no active people yet — add a person first.");
		return;
	}
	new PersonSuggestModal(plugin.app, people, (person) => {
		void markReviewed(plugin, person);
	}).open();
}

async function markReviewed(
	plugin: TeamSyncPlugin,
	personName: string,
): Promise<void> {
	const service = new DevPlanService(plugin.app.vault, plugin.settings);
	try {
		await service.markReviewed(personName);
		new Notice(`Marked ${personName}'s development plan as reviewed today.`);
	} catch (error) {
		noticeError(`mark the development plan for ${personName} reviewed`, error);
	}
}

/**
 * Person-picker source: PersonService.listPeople — the same consolidated
 * source the other commands use (active people, consistent archived and
 * lenient-discovery rules). Returns null when listing failed (already
 * noticed) so callers can bail without re-notifying.
 */
async function listActivePeople(
	plugin: TeamSyncPlugin,
): Promise<string[] | null> {
	try {
		return (
			await new PersonService(
				plugin.app.vault,
				plugin.settings,
				plugin.app.metadataCache,
			).listPeople()
		).map((person) => person.name);
	} catch (error) {
		noticeError("list people", error);
		return null;
	}
}

/**
 * Person-picker suggest modal. Defined locally — the same shape the other
 * command modules use; the integrator may consolidate the shared picker.
 */
class PersonSuggestModal extends SuggestModal<string> {
	constructor(
		app: App,
		private readonly people: string[],
		private readonly onChoosePerson: (person: string) => void,
	) {
		super(app);
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

function noticeError(action: string, error: unknown): void {
	const detail = error instanceof Error ? error.message : String(error);
	new Notice(`TeamSync: could not ${action} — ${detail}`);
}
