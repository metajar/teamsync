import { App, PluginSettingTab, Setting } from "obsidian";
import type TeamSyncPlugin from "./plugin";

/**
 * Plugin settings. Every vault path in the project derives from these fields
 * via src/paths.ts — feature code must never hardcode a path string.
 */
export interface TeamSyncSettings {
	/** Root folder holding all person folders. Default: 'Team'. */
	rootFolder: string;
	/** Per-person folder for 1:1 notes. Default: '1-on-1s'. */
	oneOnOnesFolder: string;
	/** Per-person folder for goal notes. Default: 'Goals'. */
	goalsFolder: string;
	/** Person profile note filename inside a person folder. Default: '_index.md'. */
	personIndexFile: string;
	/** Development plan note filename inside a person folder. Default: 'Development-Plan.md'. */
	devPlanFile: string;
}

export const DEFAULT_SETTINGS: TeamSyncSettings = {
	rootFolder: "Team",
	oneOnOnesFolder: "1-on-1s",
	goalsFolder: "Goals",
	personIndexFile: "_index.md",
	devPlanFile: "Development-Plan.md",
};

export class TeamSyncSettingTab extends PluginSettingTab {
	plugin: TeamSyncPlugin;

	constructor(app: App, plugin: TeamSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Root folder")
			.setDesc("Folder that contains one subfolder per team member.")
			.addText((text) =>
				text
					.setPlaceholder("Team")
					.setValue(this.plugin.settings.rootFolder)
					.onChange(async (value) => {
						this.plugin.settings.rootFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("1:1 notes folder")
			.setDesc("Per-person subfolder holding 1:1 notes, named by ISO date.")
			.addText((text) =>
				text
					.setPlaceholder("1-on-1s")
					.setValue(this.plugin.settings.oneOnOnesFolder)
					.onChange(async (value) => {
						this.plugin.settings.oneOnOnesFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Goals folder")
			.setDesc("Per-person subfolder holding goal notes.")
			.addText((text) =>
				text
					.setPlaceholder("Goals")
					.setValue(this.plugin.settings.goalsFolder)
					.onChange(async (value) => {
						this.plugin.settings.goalsFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Person index file")
			.setDesc("Profile note filename inside each person folder.")
			.addText((text) =>
				text
					.setPlaceholder("_index.md")
					.setValue(this.plugin.settings.personIndexFile)
					.onChange(async (value) => {
						this.plugin.settings.personIndexFile = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Development plan file")
			.setDesc("Development plan note filename inside each person folder.")
			.addText((text) =>
				text
					.setPlaceholder("Development-Plan.md")
					.setValue(this.plugin.settings.devPlanFile)
					.onChange(async (value) => {
						this.plugin.settings.devPlanFile = value;
						await this.plugin.saveSettings();
					}),
			);

		// TODO: template-folder setting (custom templates, Phase 2).
		// TODO: Ollama connection settings (URL, model, Phase 3) — no network
		// calls outside OllamaClient, ever.
	}
}
