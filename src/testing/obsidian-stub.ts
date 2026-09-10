/**
 * Runtime stub for the `obsidian` package, aliased in vitest.config.ts.
 * The real npm package ships typings only — there is no runtime module —
 * so any value import of `obsidian` in test-executed code lands here.
 *
 * Only what tests actually need at runtime: class shapes for `instanceof`,
 * a stateful Plugin base so command registration can be asserted, and
 * fire-and-forget UI primitives. Everything else is a no-op.
 *
 * NOTE: this file is test-only. It must never be imported from production
 * code (nothing under src/ except src/testing/ may reference it), and it is
 * not reachable from main.ts, so it never enters the bundle.
 */

export class TAbstractFile {
	path = "";
	name = "";
	parent: TFolder | null = null;
	vault: unknown = null;
}

export class TFile extends TAbstractFile {
	basename = "";
	extension = "";
	stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "";
	}
}

export class Plugin {
	app: unknown = { vault: undefined, metadataCache: undefined };
	manifest: Record<string, unknown> = {};
	/** Registered commands, keyed by command id — assert against this. */
	commands: Record<string, { id: string; name?: string; callback: () => unknown }> = {};

	addCommand(command: { id: string; name?: string; callback: () => unknown }) {
		this.commands[command.id] = command;
		return command;
	}
	addSettingTab(_tab: unknown): void {}
	registerView(_type: string, _viewCreator: (leaf: unknown) => unknown): void {}
	registerEvent(_event: unknown): void {}
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(_data: unknown): Promise<void> {}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: unknown = {};
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	display(): void {}
	hide(): void {}
}

/** Captures the message so tests can assert on Notices. */
export class Notice {
	message: string | DocumentFragment;
	constructor(message: string | DocumentFragment, _timeout?: number) {
		this.message = message instanceof DocumentFragment ? message : String(message);
	}
}

export class Modal {
	app: unknown;
	constructor(app?: unknown) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
	onOpen(): void {}
	onClose(): void {}
}

export class ItemView {
	app: unknown;
	leaf: unknown;
	constructor(leaf: unknown) {
		this.leaf = leaf;
	}
	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
	render(): void {}
}

export class SuggestModal<T> extends Modal {
	getSuggestions(_query: string): T[] {
		return [];
	}
	renderSuggestion(_value: T, _el: unknown): void {}
	onChooseSuggestion(_item: T, _evt: unknown): void {}
}

/** Minimal DOM-less stand-in for Obsidian's Setting builder. */
export class Setting {
	settingEl: Record<string, unknown> = {};
	constructor(_containerEl?: unknown) {}
	setName(_name: string): this {
		return this;
	}
	setDesc(_desc: string): this {
		return this;
	}
	addText(_cb: (text: unknown) => unknown): this {
		return this;
	}
	addToggle(_cb: (toggle: unknown) => unknown): this {
		return this;
	}
	addDropdown(_cb: (dropdown: unknown) => unknown): this {
		return this;
	}
	addButton(_cb: (button: unknown) => unknown): this {
		return this;
	}
}

/** Mirrors Obsidian's path normalization closely enough for tests. */
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+/, "")
		.replace(/\/+$/, "");
}

/** No network in tests, ever — OllamaClient's transport fails loudly here. */
export function requestUrl(): never {
	throw new Error("requestUrl is not available in tests");
}
