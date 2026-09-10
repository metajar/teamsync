import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { OneOnOneService } from "../one-on-one.service";
import type { PrepSource } from "./prep-context";

/**
 * The two modals of the AI prep flow (see .mex/context/ollama.md,
 * Transparency & Trust Rules). UI lives here; vault access goes through
 * OneOnOneService and network access goes through OllamaClient — neither
 * happens inside these modals except via callbacks handed in by the
 * command module.
 */

/**
 * NON-NEGOTIABLE confirmation step: shows exactly the note content about to
 * be transmitted (the full prompt) and where it is going, and only sends if
 * the user clicks Send. Shown before every send, including repeats.
 */
export class SendPreviewModal extends Modal {
	readonly prompt: string;
	readonly targetUrl: string;
	private readonly onSend: () => void;

	constructor(
		app: App,
		options: { prompt: string; targetUrl: string; onSend: () => void },
	) {
		super(app);
		this.prompt = options.prompt;
		this.targetUrl = options.targetUrl;
		this.onSend = options.onSend;
	}

	override onOpen(): void {
		this.titleEl.setText("Send note content to AI?");

		this.contentEl.createEl("p", {
			text:
				`This transmits the note content below to the AI model at ` +
				`${this.targetUrl}. Review what will be sent, then choose Send or Cancel.`,
		});
		const preview = this.contentEl.createEl("pre");
		preview.setText(this.prompt);

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close()),
			)
			.addButton((button) =>
				button
					.setButtonText("Send to AI")
					.setCta()
					.onClick(() => this.confirmSend()),
			);
	}

	/** The Send button's handler — also the test seam for the confirm step. */
	confirmSend(): void {
		this.close();
		this.onSend();
	}
}

export interface PrepDraftModalOptions {
	plugin: TeamSyncPlugin;
	personName: string;
	draft: string;
	sources: PrepSource[];
}

/**
 * Editable AI draft. Framed as a starting point, not a source of truth,
 * with the citations it drew from. Nothing is written to the vault until
 * the user explicitly picks an action — Copy or Insert into a new 1:1 note.
 */
export class PrepDraftModal extends Modal {
	/** Live draft text — bound to the textarea, so edits survive button clicks. */
	draftText: string;
	readonly personName: string;
	readonly sources: PrepSource[];
	private readonly plugin: TeamSyncPlugin;

	constructor(app: App, options: PrepDraftModalOptions) {
		super(app);
		this.plugin = options.plugin;
		this.personName = options.personName;
		this.sources = options.sources;
		this.draftText = options.draft;
	}

	override onOpen(): void {
		this.titleEl.setText(`AI draft — 1:1 prep for ${this.personName}`);

		this.contentEl.createEl("p", {
			text:
				"AI draft — a starting point, not a source of truth. Edit freely; " +
				"nothing is written to your vault until you choose an action below.",
		});

		const textarea = this.contentEl.createEl("textarea");
		textarea.value = this.draftText;
		textarea.rows = 16;
		textarea.style.width = "100%";
		textarea.addEventListener("input", () => {
			this.draftText = textarea.value;
		});

		const citations = this.contentEl.createEl("div");
		citations.createEl("h4", { text: "Sources used" });
		const list = citations.createEl("ul");
		for (const source of this.sources) {
			const date = source.date === "" ? "" : ` (${source.date})`;
			list.createEl("li", { text: `${source.kind}${date}: ${source.path}` });
		}

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Copy to clipboard").onClick(() => this.copyDraft()),
			)
			.addButton((button) =>
				button
					.setButtonText("Insert into new 1:1 note")
					.setCta()
					.onClick(() => void this.insertIntoNote()),
			);
	}

	copyDraft(): void {
		const clipboard = navigator.clipboard;
		if (!clipboard) {
			new Notice("Clipboard is not available.");
			return;
		}
		void clipboard
			.writeText(this.draftText)
			.then(() => new Notice("Draft copied to clipboard."))
			.catch((error: unknown) => new Notice(draftErrorMessage(error)));
	}

	/**
	 * Create today's 1:1 note (with the usual action-item carry-forward) and
	 * append the edited draft to its body, then open the note. The user has
	 * seen and edited the draft in this modal — that review is the write's
	 * authorization, so this is the only sanctioned write path for AI output.
	 */
	async insertIntoNote(): Promise<void> {
		const service = new OneOnOneService(
			this.plugin.app.vault,
			this.plugin.settings,
		);
		try {
			const file = await service.createOneOnOne(this.personName);
			await service.appendToOneOnOne(file, this.draftText);
			this.close();
			const leaf = this.plugin.app.workspace.getLeaf(true);
			await leaf.openFile(file);
			new Notice(`Draft inserted into a new 1:1 note for ${this.personName}.`);
		} catch (error) {
			new Notice(draftErrorMessage(error));
		}
	}
}

function draftErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
