import { Modal, Notice, Setting } from "obsidian";
import type { App } from "obsidian";
import type TeamSyncPlugin from "../plugin";
import { OneOnOneService } from "../one-on-one.service";
import type { PrepSource } from "./prep-context";

/**
 * The modals of the AI flows (see .mex/context/ollama.md, Transparency &
 * Trust Rules). UI lives here; vault access goes through services and
 * network access goes through OllamaClient — neither happens inside these
 * modals except via callbacks handed in by the command module.
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

/**
 * Editable AI draft shared by the AI flows (prep brief, person overview).
 * Framed as a starting point, not a source of truth, with the citations it
 * drew from. Nothing is written to the vault until the user explicitly picks
 * the subclass's primary action — Copy alone writes nothing.
 */
export abstract class AIDraftModal extends Modal {
	/** Live draft text — bound to the textarea, so edits survive button clicks. */
	draftText: string;
	readonly sources: PrepSource[];
	private readonly title: string;
	private readonly primaryLabel: string;

	protected constructor(
		app: App,
		options: {
			title: string;
			draft: string;
			sources: PrepSource[];
			primaryLabel: string;
		},
	) {
		super(app);
		this.title = options.title;
		this.draftText = options.draft;
		this.sources = options.sources;
		this.primaryLabel = options.primaryLabel;
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);

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
					.setButtonText(this.primaryLabel)
					.setCta()
					.onClick(() => void this.runPrimary(this.draftText)),
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
	 * Primary button handler: run the subclass action with the current (edited)
	 * draft, surfacing any error as a Notice and leaving the modal open for a
	 * retry. Also the shared test seam.
	 */
	async runPrimary(draft: string): Promise<void> {
		try {
			await this.runPrimaryAction(draft);
		} catch (error) {
			new Notice(draftErrorMessage(error));
		}
	}

	/** What the primary (CTA) button does — e.g. insert into a note, write a file. */
	protected abstract runPrimaryAction(draft: string): Promise<void>;
}

export interface PrepDraftModalOptions {
	plugin: TeamSyncPlugin;
	personName: string;
	draft: string;
	sources: PrepSource[];
}

/** The prep flow's draft modal: insert the edited draft into a new 1:1 note. */
export class PrepDraftModal extends AIDraftModal {
	readonly personName: string;
	private readonly plugin: TeamSyncPlugin;

	constructor(app: App, options: PrepDraftModalOptions) {
		super(app, {
			title: `AI draft — 1:1 prep for ${options.personName}`,
			draft: options.draft,
			sources: options.sources,
			primaryLabel: "Insert into new 1:1 note",
		});
		this.plugin = options.plugin;
		this.personName = options.personName;
	}

	protected override async runPrimaryAction(draft: string): Promise<void> {
		return this.insertIntoNote(draft);
	}

	/**
	 * Create today's 1:1 note (with the usual action-item carry-forward) and
	 * append the edited draft to its body, then open the note. The user has
	 * seen and edited the draft in this modal — that review is the write's
	 * authorization, so this is the only sanctioned write path for AI output.
	 */
	async insertIntoNote(draft: string = this.draftText): Promise<void> {
		const service = new OneOnOneService(
			this.plugin.app.vault,
			this.plugin.settings,
		);
		try {
			const file = await service.createOneOnOne(this.personName);
			await service.appendToOneOnOne(file, draft);
			this.close();
			const leaf = this.plugin.app.workspace.getLeaf(true);
			await leaf.openFile(file);
			new Notice(`Draft inserted into a new 1:1 note for ${this.personName}.`);
		} catch (error) {
			new Notice(draftErrorMessage(error));
		}
	}
}

export interface OverviewDraftModalOptions {
	personName: string;
	draft: string;
	sources: PrepSource[];
	/**
	 * Create-or-replace the person's Overview note with the edited draft.
	 * Supplied by the command layer (the thin writer seam); it throws on
	 * failure so this modal can surface the error and stay open.
	 */
	onWrite: (draft: string) => Promise<void>;
}

/**
 * The overview flow's draft modal: write the edited draft to the person's
 * Overview note. Replacing an existing Overview only ever happens from this
 * explicit button, after the user has seen and could edit the content —
 * never automatically on generation.
 */
export class OverviewDraftModal extends AIDraftModal {
	private readonly onWrite: OverviewDraftModalOptions["onWrite"];

	constructor(app: App, options: OverviewDraftModalOptions) {
		super(app, {
			title: `AI draft — overview for ${options.personName}`,
			draft: options.draft,
			sources: options.sources,
			primaryLabel: "Write Overview.md",
		});
		this.onWrite = options.onWrite;
	}

	/** The "Write Overview.md" button — also the test seam. */
	async writeOverview(draft: string = this.draftText): Promise<void> {
		await this.runPrimary(draft);
	}

	protected override async runPrimaryAction(draft: string): Promise<void> {
		await this.onWrite(draft);
		this.close();
	}
}

function draftErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
