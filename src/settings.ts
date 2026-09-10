import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TeamSyncPlugin from "./plugin";
import { describeOllamaError, OllamaClient } from "./ollama-client";

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
	/** Dev-plan review cadence in days; the dashboard flags plans not reviewed within this window. Default: 90. */
	devPlanReviewDays: number;
	/** Per-person AI-generated overview note filename. Default: 'Overview.md'. */
	overviewFile: string;
	/** Ollama server URL. Default: 'http://localhost:11434'. AI is optional — core features never need it. */
	ollamaUrl: string;
	/**
	 * Shared Ollama model name. Default: '' (AI commands are disabled until a
	 * model is chosen). Single shared model only — per-feature model selection
	 * is an open PRD question, deliberately not built.
	 */
	ollamaModel: string;
	/** Generation temperature. Default: 0.4 — prep briefs want consistency, not creativity. */
	ollamaTemperature: number;
	/** Shared request timeout in milliseconds. Default: 60000. */
	ollamaTimeoutMs: number;
	/** How many past 1:1 notes feed an AI prep brief. Default: 5. */
	prepContextNotes: number;
}

export const DEFAULT_SETTINGS: TeamSyncSettings = {
	rootFolder: "Team",
	oneOnOnesFolder: "1-on-1s",
	goalsFolder: "Goals",
	personIndexFile: "_index.md",
	devPlanFile: "Development-Plan.md",
	devPlanReviewDays: 90,
	overviewFile: "Overview.md",
	ollamaUrl: "http://localhost:11434",
	ollamaModel: "",
	ollamaTemperature: 0.4,
	ollamaTimeoutMs: 60000,
	prepContextNotes: 5,
};

export class TeamSyncSettingTab extends PluginSettingTab {
	plugin: TeamSyncPlugin;

	/** Models fetched by the last successful "Test connection" — feeds the dropdown. */
	private availableModels: string[] = [];

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

		new Setting(containerEl)
			.setName("Dev plan review cadence (days)")
			.setDesc("The team dashboard flags a development plan not reviewed within this many days.")
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.devPlanReviewDays))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed > 0) {
							this.plugin.settings.devPlanReviewDays = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Overview file")
			.setDesc("Per-person AI-generated overview note filename (\"Generate Overview\" command).")
			.addText((text) =>
				text
					.setPlaceholder("Overview.md")
					.setValue(this.plugin.settings.overviewFile)
					.onChange(async (value) => {
						this.plugin.settings.overviewFile = value;
						await this.plugin.saveSettings();
					}),
			);

		// TODO: template-folder setting (custom templates, Phase 2).
		this.renderOllamaSection(containerEl);
	}

	/**
	 * "Ollama (optional, local AI)" section. Everything here must work with
	 * Ollama absent: the model setting falls back to free text when no model
	 * list has been fetched, and the only network call is the explicit
	 * "Test connection" button (via OllamaClient — the sole AI boundary).
	 */
	private renderOllamaSection(containerEl: HTMLElement): void {
		const settings = this.plugin.settings;

		new Setting(containerEl)
			.setName("Ollama server URL (optional, local AI)")
			.setDesc(
				"Local/private Ollama endpoint. AI features are entirely optional — " +
					"everything else in TeamSync works without it.",
			)
			.addText((text) =>
				text
					.setPlaceholder("http://localhost:11434")
					.setValue(settings.ollamaUrl)
					.onChange(async (value) => {
						settings.ollamaUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Checks the server and loads its installed models into the model dropdown.")
			.addButton((button) =>
				button.setButtonText("Test connection").onClick(() => {
					void this.testConnection();
				}),
			);

		const modelSetting = new Setting(containerEl)
			.setName("Model")
			.setDesc(
				"Used by all AI features (single shared model). " +
					'"Test connection" fills the dropdown; otherwise type a model name.',
			);
		if (this.availableModels.length > 0) {
			modelSetting.addDropdown((dropdown) => {
				const options: Record<string, string> = { "": "(not set)" };
				for (const model of this.availableModels) {
					options[model] = model;
				}
				dropdown.addOptions(options).setValue(settings.ollamaModel);
				dropdown.onChange(async (value) => {
					settings.ollamaModel = value;
					await this.plugin.saveSettings();
				});
			});
		} else {
			modelSetting.addText((text) =>
				text
					.setPlaceholder("e.g. llama3")
					.setValue(settings.ollamaModel)
					.onChange(async (value) => {
						settings.ollamaModel = value;
						await this.plugin.saveSettings();
					}),
			);
		}

		new Setting(containerEl)
			.setName("Temperature")
			.setDesc("Generation temperature, 0 (deterministic) to 1 (creative).")
			.addText((text) =>
				text
					.setValue(String(settings.ollamaTemperature))
					.onChange(async (value) => {
						const parsed = Number.parseFloat(value);
						if (Number.isFinite(parsed)) {
							settings.ollamaTemperature = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Request timeout (ms)")
			.setDesc("Shared timeout for every AI request.")
			.addText((text) =>
				text
					.setValue(String(settings.ollamaTimeoutMs))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed > 0) {
							settings.ollamaTimeoutMs = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Notes in AI prep context")
			.setDesc("How many past 1:1 notes feed an AI prep brief (most recent N).")
			.addText((text) =>
				text
					.setValue(String(settings.prepContextNotes))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (Number.isFinite(parsed) && parsed >= 0) {
							settings.prepContextNotes = parsed;
							await this.plugin.saveSettings();
						}
					}),
			);
	}

	/** One explicit network call per click, through OllamaClient only. */
	private async testConnection(): Promise<void> {
		const { ollamaUrl, ollamaTimeoutMs } = this.plugin.settings;
		const client = new OllamaClient({ baseUrl: ollamaUrl, timeoutMs: ollamaTimeoutMs });
		try {
			const models = await client.listModels();
			this.availableModels = models;
			new Notice(
				models.length === 0
					? `Connected to Ollama at ${ollamaUrl}, but no models are installed — pull one with "ollama pull <model>".`
					: `Connected to Ollama at ${ollamaUrl} — ${models.length} model(s) available.`,
			);
		} catch (error) {
			// Fall back to the free-text model field; never block settings.
			this.availableModels = [];
			new Notice(describeOllamaError(error));
			return;
		}
		this.display(); // re-render so the dropdown replaces the free-text field
	}
}
