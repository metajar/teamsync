import { TFile, TFolder } from "obsidian";
import type {
	DataAdapter,
	MetadataCache,
	TAbstractFile,
	Vault,
} from "obsidian";
import { splitFrontmatter } from "../frontmatter";

/**
 * In-memory mock of the Obsidian Vault surface, adequate for service-layer
 * Vitest tests. Compiled against the real obsidian typings; at test runtime
 * the `obsidian` alias (see vitest.config.ts) points the class imports at
 * src/testing/obsidian-stub.ts, so `instanceof TFile` / `instanceof TFolder`
 * behave correctly.
 *
 * Implemented surface:
 *   vault.getAbstractFileByPath(path) → TFile | TFolder | null
 *   vault.createFolder(path)           → TFolder      (throws if it exists; creates ancestors)
 *   vault.create(path, content)        → TFile        (throws if it exists or parent folder is missing)
 *   vault.read(file)                   → string       (throws if unknown)
 *   vault.modify(file, data)           → void         (throws if unknown)
 *   vault.delete(file)                 → void
 *   vault.rename(file, newPath)        → void         (moves files and folder subtrees)
 *   vault.getMarkdownFiles()           → TFile[]
 *   vault.exists(target)               → Promise<boolean> (TAbstractFile | path string)
 *   vault.adapter.mkdir(path)          → recursive, idempotent (divergence: real one
 *                                         may throw on existing; we tolerate it)
 *   vault.adapter.write(path, data)    → create or overwrite (parent folder must exist)
 *   vault.adapter.exists(path)         → Promise<boolean> — folders and files
 *   vault.adapter.existsSync(path)     → synchronous variant (not on the real
 *                                         DataAdapter; kept because feature code uses it)
 *
 * Test helpers (not on the real Vault):
 *   vault.getContent(path)             → raw file content or undefined
 *   vault.folderPaths()                → all existing folder paths
 *
 * Not implemented: events, trash (use delete), process/, cachedRead (alias of
 * read here), getFolderByPath (use getAbstractFileByPath + instanceof).
 */

export interface MockVault extends Vault {
	/**
	 * Existence check for a path or file. (Present on the runtime Vault in
	 * older Obsidian versions; the 1.13 typings dropped it from the class,
	 * so we declare it explicitly — the mock always implements it.)
	 */
	exists(target: TAbstractFile | string): Promise<boolean>;
	/** DataAdapter plus the synchronous exists the foundation code uses. */
	adapter: DataAdapter & { existsSync(path: string): boolean };
	/** Raw content of the file at path, or undefined if it does not exist. */
	getContent(path: string): string | undefined;
	/** Paths of every folder that currently exists (root = ""). */
	folderPaths(): string[];
}

export function createMockVault(): MockVault {
	const contents = new Map<string, string>();
	const folders = new Set<string>([""]);
	const fileObjects = new Map<string, TFile>();
	const folderObjects = new Map<string, TFolder>();
	let clock = 0;

	function normalize(path: string): string {
		return path.replace(/^\/+|\/+$/g, "");
	}

	function parentOf(path: string): string {
		const index = path.lastIndexOf("/");
		return index === -1 ? "" : path.slice(0, index);
	}

	function getOrCreateFolder(path: string): TFolder {
		const normalized = normalize(path);
		if (!folders.has(normalized)) {
			throw new Error(`Folder does not exist: ${normalized}`);
		}
		let folder = folderObjects.get(normalized);
		if (!folder) {
			const parent = normalized === "" ? null : getOrCreateFolder(parentOf(normalized));
			folder = new TFolder();
			folder.path = normalized;
			folder.name = normalized === "" ? "/" : normalized.slice(normalized.lastIndexOf("/") + 1);
			folder.parent = parent;
			folderObjects.set(normalized, folder);
			parent?.children.push(folder);
		}
		return folder;
	}

	function makeFileObject(path: string): TFile {
		let file = fileObjects.get(path);
		if (!file) {
			const name = path.slice(path.lastIndexOf("/") + 1);
			const dot = name.lastIndexOf(".");
			file = new TFile();
			file.path = path;
			file.name = name;
			file.basename = dot === -1 ? name : name.slice(0, dot);
			file.extension = dot === -1 ? "" : name.slice(dot + 1);
			file.parent = getOrCreateFolder(parentOf(path));
			fileObjects.set(path, file);
			file.parent.children.push(file);
		}
		return file;
	}

	function dropFileObject(path: string): void {
		const file = fileObjects.get(path);
		if (file?.parent) {
			const siblings = file.parent.children as TAbstractFile[];
			const index = siblings.indexOf(file);
			if (index !== -1) siblings.splice(index, 1);
		}
		fileObjects.delete(path);
	}

	const adapter = {
		mkdir: async (path: string): Promise<void> => {
			const normalized = normalize(path);
			if (normalized === "") return;
			const segments = normalized.split("/");
			let current = "";
			for (const segment of segments) {
				current = current === "" ? segment : `${current}/${segment}`;
				folders.add(current);
			}
		},
		write: async (path: string, data: string): Promise<void> => {
			const normalized = normalize(path);
			if (!folders.has(parentOf(normalized))) {
				throw new Error(`Parent folder does not exist: ${parentOf(normalized)}`);
			}
			if (!contents.has(normalized)) {
				makeFileObject(normalized);
			}
			contents.set(normalized, data);
		},
		exists: async (path: string): Promise<boolean> => {
			const normalized = normalize(path);
			return folders.has(normalized) || contents.has(normalized);
		},
		existsSync: (path: string): boolean => {
			const normalized = normalize(path);
			return folders.has(normalized) || contents.has(normalized);
		},
		read: async (path: string): Promise<string> => {
			const normalized = normalize(path);
			const content = contents.get(normalized);
			if (content === undefined) {
				throw new Error(`File does not exist: ${normalized}`);
			}
			return content;
		},
	} as DataAdapter & { existsSync(path: string): boolean };

	const vault: MockVault = {
		getAbstractFileByPath(path: string): TAbstractFile | null {
			const normalized = normalize(path);
			if (contents.has(normalized)) return fileObjects.get(normalized) ?? null;
			if (folders.has(normalized)) return getOrCreateFolder(normalized);
			return null;
		},
		async createFolder(path: string): Promise<TFolder> {
			const normalized = normalize(path);
			if (normalized === "") {
				throw new Error("Folder already exists: /");
			}
			if (folders.has(normalized)) {
				throw new Error(`Folder already exists: ${normalized}`);
			}
			const segments = normalized.split("/");
			let current = "";
			for (const segment of segments) {
				current = current === "" ? segment : `${current}/${segment}`;
				folders.add(current);
			}
			return getOrCreateFolder(normalized);
		},
		async create(path: string, content: string): Promise<TFile> {
			const normalized = normalize(path);
			if (contents.has(normalized)) {
				throw new Error(`File already exists: ${normalized}`);
			}
			if (!folders.has(parentOf(normalized))) {
				throw new Error(`Folder does not exist: ${parentOf(normalized)}`);
			}
			contents.set(normalized, content);
			const file = makeFileObject(normalized);
			file.stat = { ctime: ++clock, mtime: clock, size: content.length };
			return file;
		},
		async read(file: TFile): Promise<string> {
			const content = contents.get(file.path);
			if (content === undefined) {
				throw new Error(`File does not exist: ${file.path}`);
			}
			return content;
		},
		async cachedRead(file: TFile): Promise<string> {
			return vault.read(file);
		},
		async modify(file: TFile, data: string): Promise<void> {
			if (!contents.has(file.path)) {
				throw new Error(`File does not exist: ${file.path}`);
			}
			contents.set(file.path, data);
			file.stat = { ...file.stat, mtime: ++clock, size: data.length };
		},
		async delete(file: TFile): Promise<void> {
			if (!contents.has(file.path)) {
				throw new Error(`File does not exist: ${file.path}`);
			}
			contents.delete(file.path);
			dropFileObject(file.path);
		},
		async rename(target: TAbstractFile, newPath: string): Promise<void> {
			const normalized = normalize(newPath);
			if (normalized === "") {
				throw new Error("Cannot rename to vault root");
			}
			if (contents.has(normalized) || folders.has(normalized)) {
				throw new Error(`Target already exists: ${normalized}`);
			}
			if (target instanceof TFile) {
				const content = contents.get(target.path);
				if (content === undefined) {
					throw new Error(`File does not exist: ${target.path}`);
				}
				contents.delete(target.path);
				dropFileObject(target.path);
				contents.set(normalized, content);
				makeFileObject(normalized);
				return;
			}
			if (target instanceof TFolder) {
				const prefix = target.path === "" ? "" : `${target.path}/`;
				// Move folders first so makeFileObject below finds the new parents.
				const folderMoves: string[] = [];
				for (const folder of folders) {
					if (folder.startsWith(prefix)) folderMoves.push(folder);
				}
				for (const folder of folderMoves) {
					folders.delete(folder);
					folders.add(normalized + folder.slice(target.path.length));
					folderObjects.delete(folder);
				}
				folders.delete(target.path);
				folders.add(normalized);
				folderObjects.delete(target.path);
				const moves: Array<[string, string]> = [];
				for (const path of contents.keys()) {
					if (path.startsWith(prefix)) {
						moves.push([path, normalized + path.slice(target.path.length)]);
					}
				}
				for (const [from, to] of moves) {
					contents.set(to, contents.get(from)!);
					contents.delete(from);
					dropFileObject(from);
					makeFileObject(to);
				}
				return;
			}
			throw new Error("Unsupported rename target");
		},
		getMarkdownFiles(): TFile[] {
			return [...contents.keys()]
				.filter((path) => path.endsWith(".md"))
				.map((path) => fileObjects.get(path) ?? makeFileObject(path));
		},
		async exists(target: TAbstractFile | string): Promise<boolean> {
			if (typeof target === "string") {
				const normalized = normalize(target);
				return contents.has(normalized) || folders.has(normalized);
			}
			if (target instanceof TFile) return contents.has(target.path);
			if (target instanceof TFolder) return folders.has(target.path);
			return false;
		},
		adapter,
		getContent(path: string): string | undefined {
			return contents.get(normalize(path));
		},
		folderPaths(): string[] {
			return [...folders];
		},
	} as unknown as MockVault;

	return vault;
}

/**
 * Metadata cache mock: getCache(path) parses frontmatter live from the mock
 * vault's current content (no cache invalidation to worry about in tests).
 * Returns null for unknown or non-markdown paths; returns { frontmatter: {} }
 * for markdown files without frontmatter — matching Obsidian, which reports
 * an object with no frontmatter key in that case; we use {} for uniformity.
 */
export interface MockMetadataCache extends MetadataCache {}

export function createMockMetadataCache(vault: MockVault): MockMetadataCache {
	return {
		getCache(path: string) {
			const content = vault.getContent(path);
			if (content === undefined || !path.endsWith(".md")) {
				return null;
			}
			const { frontmatter } = splitFrontmatter(content);
			return { frontmatter } as ReturnType<MetadataCache["getCache"]>;
		},
	} as MockMetadataCache;
}
