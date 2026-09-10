import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { buildNote } from "../frontmatter";
import {
	assembleOverviewContext,
	buildOverviewPrompt,
	type OverviewPromptInput,
} from "./overview-context";
import { MAX_NOTE_CHARS, truncateForPrompt } from "./prep-context";
import { DEFAULT_SETTINGS } from "../settings";
import type { TeamSyncSettings } from "../settings";
import { createMockVault } from "../testing/vault-mock";
import type { MockVault } from "../testing/vault-mock";

/** Create a file (and its folders) in the mock vault with given content. */
async function seedNote(
	vault: MockVault,
	path: string,
	content: string,
): Promise<TFile> {
	await vault.adapter.mkdir(path.slice(0, path.lastIndexOf("/")));
	return vault.create(path, content);
}

function oneOnOneContent(person: string, date: string, body: string): string {
	return buildNote(
		{ type: "one-on-one", person, date, action_items_open: 0 },
		`\n${body}`,
	);
}

function goalContent(
	person: string,
	title: string,
	status: string,
	extra: Record<string, string> = {},
): string {
	return buildNote(
		{ type: "goal", person, title, status, created_date: "2026-01-05", ...extra },
		"\n## Goal\n",
	);
}

async function seedJaneVault(settings: TeamSyncSettings = { ...DEFAULT_SETTINGS }): Promise<{
	vault: MockVault;
	settings: TeamSyncSettings;
}> {
	const vault = createMockVault();
	await seedNote(
		vault,
		"Team/Jane Doe/_index.md",
		buildNote(
			{ type: "person", name: "Jane Doe", role: "Senior Engineer", start_date: "2024-03-01", status: "active" },
			"\n# Jane Doe\n",
		),
	);
	await seedNote(
		vault,
		"Team/Jane Doe/1-on-1s/2026-08-05.md",
		oneOnOneContent("Jane Doe", "2026-08-05", "## Notes\nFIRST-NOTE talk about onboarding friction."),
	);
	await seedNote(
		vault,
		"Team/Jane Doe/1-on-1s/2026-08-19.md",
		oneOnOneContent("Jane Doe", "2026-08-19", "## Notes\nSECOND-NOTE worried about launch load."),
	);
	await seedNote(
		vault,
		"Team/Jane Doe/1-on-1s/2026-09-02.md",
		oneOnOneContent("Jane Doe", "2026-09-02", "## Notes\nTHIRD-NOTE promotion path discussion."),
	);
	await seedNote(
		vault,
		"Team/Jane Doe/Goals/2026-q3-improve-review-turnaround.md",
		goalContent("Jane Doe", "Improve review turnaround", "in-progress", {
			target_date: "2026-12-31",
		}),
	);
	await seedNote(
		vault,
		"Team/Jane Doe/Goals/2026-q2-migrate-service.md",
		goalContent("Jane Doe", "Migrate service", "done"),
	);
	await seedNote(
		vault,
		"Team/Jane Doe/Goals/2026-q3-learn-rust.md",
		goalContent("Jane Doe", "Learn Rust", "blocked"),
	);
	return { vault, settings };
}

const PROFILE = { role: "Senior Engineer", startDate: "2024-03-01" };

function promptInput(
	overrides: Partial<OverviewPromptInput> = {},
): OverviewPromptInput {
	return {
		personName: "Jane Doe",
		profile: PROFILE,
		notes: [
			{ path: "Team/Jane Doe/1-on-1s/2026-08-19.md", date: "2026-08-19", body: "SECOND-NOTE" },
			{ path: "Team/Jane Doe/1-on-1s/2026-09-02.md", date: "2026-09-02", body: "THIRD-NOTE" },
		],
		goals: [
			{ path: "Team/Jane Doe/Goals/g1.md", title: "Improve reviews", status: "in-progress", description: undefined, targetDate: "2026-12-31" },
			{ path: "Team/Jane Doe/Goals/g2.md", title: "Migrate service", status: "done", description: undefined, targetDate: undefined },
		],
		devPlan: {
			path: "Team/Jane Doe/Development-Plan.md",
			body: "Grow toward staff engineer.",
		},
		...overrides,
	};
}

describe("buildOverviewPrompt (pure)", () => {
	it("includes the profile", () => {
		const prompt = buildOverviewPrompt(promptInput());
		expect(prompt).toContain("- Role: Senior Engineer");
		expect(prompt).toContain("- Started: 2024-03-01");
	});

	it("includes ALL goals with statuses — done goals stay in (wins need them)", () => {
		const prompt = buildOverviewPrompt(promptInput());
		expect(prompt).toContain("- [in-progress] Improve reviews, target 2026-12-31");
		expect(prompt).toContain("- [done] Migrate service");
	});

	it("includes the 1:1 notes oldest-to-newest, in order, with date and path", () => {
		const prompt = buildOverviewPrompt(promptInput());
		const second = prompt.indexOf("SECOND-NOTE");
		const third = prompt.indexOf("THIRD-NOTE");
		expect(second).toBeGreaterThan(-1);
		expect(third).toBeGreaterThan(second);
		expect(prompt).toContain("### 1:1 on 2026-08-19 (Team/Jane Doe/1-on-1s/2026-08-19.md)");
		expect(prompt).toContain("### 1:1 on 2026-09-02 (Team/Jane Doe/1-on-1s/2026-09-02.md)");
	});

	it("includes the dev-plan body with its path", () => {
		const prompt = buildOverviewPrompt(promptInput());
		expect(prompt).toContain("## Development plan");
		expect(prompt).toContain("(Team/Jane Doe/Development-Plan.md)");
		expect(prompt).toContain("Grow toward staff engineer.");
	});

	it("uses an explicit placeholder when there is no dev plan", () => {
		const prompt = buildOverviewPrompt(promptInput({ devPlan: null }));
		expect(prompt).toContain("(no development plan on file)");
	});

	it("instructs the five overview sections and the draft framing", () => {
		const prompt = buildOverviewPrompt(promptInput());
		for (const section of [
			"Role and context summary",
			"Goals snapshot (with current statuses)",
			"Recurring themes and concerns (from the recent 1:1s)",
			"Wins and accomplishments",
			"Suggested focus areas",
		]) {
			expect(prompt).toContain(section);
		}
		expect(prompt).toContain("starting draft");
		expect(prompt).toContain("not a source of truth");
		expect(prompt).toContain("do not invent facts");
		// The model must cite which notes it drew from.
		expect(prompt).toContain("name that note's path");
	});

	it("states its purpose with the person's name", () => {
		expect(buildOverviewPrompt(promptInput())).toContain(
			"manager-facing overview of Jane Doe",
		);
	});

	it("uses explicit placeholders when there is nothing to include", () => {
		const prompt = buildOverviewPrompt({
			personName: "New",
			profile: null,
			notes: [],
			goals: [],
			devPlan: null,
		});
		expect(prompt).toContain("(no profile on file)");
		expect(prompt).toContain("(no 1:1 notes on file)");
		expect(prompt).toContain("(no goals on file)");
	});

	it("caps each note body at the budget with a truncation marker", () => {
		const longBody = "x".repeat(MAX_NOTE_CHARS + 5000);
		const prompt = buildOverviewPrompt(
			promptInput({ notes: [{ path: "p.md", date: "2026-01-01", body: longBody }] }),
		);
		expect(prompt).toContain("[…truncated — 5000 more characters omitted]");
		expect(prompt.length).toBeLessThan(MAX_NOTE_CHARS + 2200);
	});

	it("caps the dev-plan body at the same budget", () => {
		const longPlan = "y".repeat(MAX_NOTE_CHARS + 2000);
		const prompt = buildOverviewPrompt(promptInput({ devPlan: { path: "p.md", body: longPlan } }));
		expect(prompt).toContain("[…truncated — 2000 more characters omitted]");
	});

	it("leaves short bodies untouched", () => {
		expect(truncateForPrompt("short body", 100)).toBe("short body");
		expect(buildOverviewPrompt(promptInput())).toContain("SECOND-NOTE");
	});
});

describe("assembleOverviewContext", () => {
	/**
	 * The dev-plan read seam as the command layer supplies it: cachedRead for
	 * an existing file, null when missing.
	 */
	function readerFor(vault: MockVault): (path: string) => Promise<string | null> {
		return async (path) => {
			const file = vault.getAbstractFileByPath(path);
			return file instanceof TFile ? vault.cachedRead(file) : null;
		};
	}

	it("gathers profile, recent notes, ALL goals, and the dev plan — with accurate sources", async () => {
		const { vault, settings } = await seedJaneVault();
		await seedNote(
			vault,
			"Team/Jane Doe/Development-Plan.md",
			buildNote(
				{ type: "dev-plan", person: "Jane Doe", last_reviewed: "2026-06-01" },
				"\nDEV-PLAN-BODY grow toward staff engineer.\n",
			),
		);
		const context = await assembleOverviewContext("Jane Doe", {
			vault,
			settings: { ...settings, prepContextNotes: 2 },
			readFile: readerFor(vault),
		});

		expect(context.personName).toBe("Jane Doe");
		expect(context.hasMaterial).toBe(true);
		expect(context.sources).toEqual([
			{ path: "Team/Jane Doe/_index.md", date: "2024-03-01", kind: "person" },
			{ path: "Team/Jane Doe/1-on-1s/2026-08-19.md", date: "2026-08-19", kind: "one-on-one" },
			{ path: "Team/Jane Doe/1-on-1s/2026-09-02.md", date: "2026-09-02", kind: "one-on-one" },
			{ path: "Team/Jane Doe/Goals/2026-q2-migrate-service.md", date: "", kind: "goal" },
			{ path: "Team/Jane Doe/Goals/2026-q3-improve-review-turnaround.md", date: "2026-12-31", kind: "goal" },
			{ path: "Team/Jane Doe/Goals/2026-q3-learn-rust.md", date: "", kind: "goal" },
			{ path: "Team/Jane Doe/Development-Plan.md", date: "", kind: "dev-plan" },
		]);

		// Most recent N notes only; done goals INCLUDED (overview, not prep);
		// dev-plan body without frontmatter.
		expect(context.prompt).toContain("SECOND-NOTE");
		expect(context.prompt).toContain("THIRD-NOTE");
		expect(context.prompt).not.toContain("FIRST-NOTE");
		expect(context.prompt).toContain("Migrate service");
		expect(context.prompt).toContain("DEV-PLAN-BODY");
		expect(context.prompt).not.toContain("last_reviewed");
	});

	it("shares the prep budget: defaults to settings.prepContextNotes notes", async () => {
		const { vault } = await seedJaneVault();
		const context = await assembleOverviewContext("Jane Doe", {
			vault,
			settings: { ...DEFAULT_SETTINGS, prepContextNotes: 1 },
			readFile: readerFor(vault),
		});
		expect(context.prompt).toContain("THIRD-NOTE");
		expect(context.prompt).not.toContain("SECOND-NOTE");
	});

	it("omits the dev-plan section when the reader returns null (no plan on file)", async () => {
		const { vault, settings } = await seedJaneVault();
		const context = await assembleOverviewContext("Jane Doe", {
			vault,
			settings,
			readFile: readerFor(vault),
		});
		expect(context.sources.some((source) => source.kind === "dev-plan")).toBe(false);
		expect(context.prompt).toContain("(no development plan on file)");
	});

	it("returns hasMaterial false when there are no 1:1s and no goals", async () => {
		const vault = createMockVault();
		await seedNote(
			vault,
			"Team/New Person/_index.md",
			buildNote(
				{ type: "person", name: "New Person", status: "active" },
				"\n# New Person\n",
			),
		);
		const context = await assembleOverviewContext("New Person", {
			vault,
			settings: { ...DEFAULT_SETTINGS },
			readFile: readerFor(vault),
		});
		expect(context.hasMaterial).toBe(false);
		expect(context.sources).toEqual([
			{ path: "Team/New Person/_index.md", date: "", kind: "person" },
		]);
	});

	it("throws an actionable error for an unknown person", async () => {
		const { vault, settings } = await seedJaneVault();
		await expect(
			assembleOverviewContext("Nobody", { vault, settings }),
		).rejects.toThrow(/No team member named "Nobody" found under Team/);
	});
});
