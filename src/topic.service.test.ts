import { beforeEach, describe, expect, it } from "vitest";
import { splitFrontmatter, buildNote } from "./frontmatter";
import { DEFAULT_SETTINGS, type TeamSyncSettings } from "./settings";
import { renderTemplate } from "./template-engine";
import { TOPICS_TEMPLATE } from "./templates/topics";
import {
	extractTopics,
	renderDiscussionTopics,
	TopicService,
} from "./topic.service";
import { createMockVault } from "./testing/vault-mock";
import type { MockVault } from "./testing/vault-mock";
import type { TFile } from "obsidian";

/** Create a file (and its folders) in the mock vault with given content. */
async function seedNote(
	vault: MockVault,
	path: string,
	content: string,
): Promise<TFile> {
	await vault.adapter.mkdir(path.slice(0, path.lastIndexOf("/")));
	return vault.create(path, content);
}

/** A topics note body with a mixed queue. */
const MIXED_BODY = [
	"## Discussion topics",
	"",
	"- Cover the incident review",
	"- [ ] checkbox line — struck, not queued",
	"- [x] done checkbox — not queued either",
	"  - nested bullet",
	"prose about - something",
	"1. ordered list",
	"-",
	"-   Trim trailing spaces   ",
	"",
].join("\n");

describe("extractTopics", () => {
	it("collects only top-level plain bullets with text, in order", () => {
		expect(extractTopics(MIXED_BODY)).toEqual([
			"Cover the incident review",
			"Trim trailing spaces",
		]);
	});

	it("ignores checkbox lines in both states", () => {
		expect(extractTopics("- [ ] a\n- [x] b\n- c")).toEqual(["c"]);
	});

	it("ignores prose, nested bullets, ordered lists, and textless bullets", () => {
		const body = [
			"Some prose about - things",
			"  - nested",
			"1. ordered",
			"-",
			"-    ",
		].join("\n");
		expect(extractTopics(body)).toEqual([]);
	});

	it("does not match the template's explanatory prose", () => {
		const { body } = splitFrontmatter(
			buildNote(
				{ type: "topics", person: "Jane Doe" },
				`\n${renderTemplate(TOPICS_TEMPLATE, { person: "Jane Doe" })}`,
			),
		);
		expect(extractTopics(body)).toEqual([]);
	});
});

describe("renderDiscussionTopics", () => {
	it("renders a heading plus unchecked checkboxes", () => {
		expect(renderDiscussionTopics(["alpha", "beta"])).toBe(
			"### Discussion topics\n- [ ] alpha\n- [ ] beta\n",
		);
	});

	it("renders nothing for an empty queue", () => {
		expect(renderDiscussionTopics([])).toBe("");
	});
});

describe("TOPICS_TEMPLATE", () => {
	it("renders the person and leaves no placeholders", () => {
		const rendered = renderTemplate(TOPICS_TEMPLATE, { person: "Bob" });
		expect(rendered).toContain("Bob");
		expect(rendered).toContain("## Discussion topics");
		expect(rendered).not.toContain("{{");
	});
});

describe("TopicService", () => {
	let vault: MockVault;
	let service: TopicService;

	beforeEach(() => {
		vault = createMockVault();
		service = new TopicService(vault, { ...DEFAULT_SETTINGS });
	});

	describe("addTopic", () => {
		it("creates the note from the template when missing and appends", async () => {
			const queue = await service.addTopic("Jane Doe", "Talk about growth");
			expect(queue).toEqual(["Talk about growth"]);

			const content = vault.getContent("Team/Jane Doe/topics.md")!;
			const { frontmatter, body } = splitFrontmatter(content);
			expect(frontmatter).toEqual({ type: "topics", person: "Jane Doe" });
			expect(body).toContain("## Discussion topics");
			expect(body).toContain("- Talk about growth");
		});

		it("appends to an existing list preserving frontmatter and order", async () => {
			await service.addTopic("Jane Doe", "first");
			await service.addTopic("Jane Doe", "second");

			expect(await service.listTopics("Jane Doe")).toEqual([
				"first",
				"second",
			]);
			const { frontmatter } = splitFrontmatter(
				vault.getContent("Team/Jane Doe/topics.md")!,
			);
			expect(frontmatter).toEqual({ type: "topics", person: "Jane Doe" });
		});

		it("appends even when the body lacks a trailing newline", async () => {
			await seedNote(
				vault,
				"Team/Jane Doe/topics.md",
				buildNote({ type: "topics", person: "Jane Doe" }, "\n## Discussion topics"),
			);
			await service.addTopic("Jane Doe", "no trailing newline");
			const { body } = splitFrontmatter(
				vault.getContent("Team/Jane Doe/topics.md")!,
			);
			expect(body).toContain("## Discussion topics\n- no trailing newline");
		});

		it("throws on an empty topic", async () => {
			await expect(service.addTopic("Jane Doe", "   ")).rejects.toThrow(
				"Topic cannot be empty.",
			);
		});

		it("honors a custom topicsFile setting", async () => {
			const customVault = createMockVault();
			const custom: TeamSyncSettings = {
				...DEFAULT_SETTINGS,
				rootFolder: "Managees",
				topicsFile: "Discussion-Topics.md",
			};
			const customService = new TopicService(customVault, custom);
			await customService.addTopic("Bob", "topic");
			expect(
				customVault.getContent("Managees/Bob/Discussion-Topics.md"),
			).toBeDefined();
			expect(await customService.listTopics("Bob")).toEqual(["topic"]);
		});
	});

	describe("listTopics", () => {
		it("returns [] when the note does not exist", async () => {
			expect(await service.listTopics("Nobody")).toEqual([]);
		});

		it("returns the queued topics from an existing note", async () => {
			await seedNote(
				vault,
				"Team/Jane Doe/topics.md",
				buildNote({ type: "topics", person: "Jane Doe" }, `\n${MIXED_BODY}`),
			);
			expect(await service.listTopics("Jane Doe")).toEqual([
				"Cover the incident review",
				"Trim trailing spaces",
			]);
		});
	});

	describe("clearTopics", () => {
		it("rewrites the body to the fresh template, preserving frontmatter", async () => {
			await service.addTopic("Jane Doe", "queued");
			await service.clearTopics("Jane Doe");

			const { frontmatter, body } = splitFrontmatter(
				vault.getContent("Team/Jane Doe/topics.md")!,
			);
			expect(frontmatter).toEqual({ type: "topics", person: "Jane Doe" });
			expect(extractTopics(body)).toEqual([]);
			expect(body).toContain("## Discussion topics");
		});

		it("is a no-op when the note is missing", async () => {
			await expect(service.clearTopics("Nobody")).resolves.toBeUndefined();
		});
	});

	describe("ensureTopicsFile", () => {
		it("creates the note once and returns the same file after", async () => {
			const first = await service.ensureTopicsFile("Jane Doe");
			expect(first.path).toBe("Team/Jane Doe/topics.md");

			const second = await service.ensureTopicsFile("Jane Doe");
			expect(second.path).toBe(first.path);
			// Second call must not throw (file exists) — same TFile path.
			expect(vault.getMarkdownFiles()).toHaveLength(1);
		});

		it("creates the person folder when it does not exist", async () => {
			await service.ensureTopicsFile("New Person");
			expect(vault.getContent("Team/New Person/topics.md")).toBeDefined();
		});
	});
});
