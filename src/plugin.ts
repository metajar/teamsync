import { Plugin } from "obsidian";
import { registerGoalCommands } from "./commands/goal.commands";
import { registerOneOnOneCommands } from "./commands/one-on-one.commands";
import { registerPersonCommands } from "./commands/person.commands";
import { DEFAULT_SETTINGS, TeamSyncSettingTab } from "./settings";
import type { TeamSyncSettings } from "./settings";
import { TeamDashboardView, VIEW_TYPE_TEAM_DASHBOARD } from "./views/team-dashboard";

export default class TeamSyncPlugin extends Plugin {
	public override settings: TeamSyncSettings = { ...DEFAULT_SETTINGS };

	override async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new TeamSyncSettingTab(this.app, this));

		registerPersonCommands(this);
		registerOneOnOneCommands(this);
		registerGoalCommands(this);

		this.registerView(
			VIEW_TYPE_TEAM_DASHBOARD,
			(leaf) => new TeamDashboardView(leaf, this),
		);
		this.addRibbonIcon("users", "TeamSync: Open team dashboard", () => {
			void this.activateDashboard();
		});
		this.addCommand({
			id: "teamsync-open-team-dashboard",
			name: "TeamSync: Open team dashboard",
			callback: () => {
				void this.activateDashboard();
			},
		});
	}

	/** Reveal the dashboard in its existing leaf, or open a fresh one. */
	private async activateDashboard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TEAM_DASHBOARD);
		const leaf = existing[0] ?? this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_TEAM_DASHBOARD, active: true });
	}

	override onunload(): void {
		// Nothing to clean up yet — no intervals, leaves, or external resources.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
