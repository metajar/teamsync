import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { buildNote } from "../frontmatter";
import {
	assemblePrepContext,
	buildPrepPrompt,
	MAX_NOTE_CHARS,
	truncateForPrompt,
	type PrepGoal,
	type PrepNote,
	type PrepPromptInput,
} from "./prep-context";
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

function promptInput(overrides: Partial<PrepPromptInput> = {}): PrepPromptInput {
	const notes: PrepNote[] = [
		{ path: "Team/Jane Doe/1-on-1s/2026-08-19.md", date: "2026-08-19", body: "SECOND-NOTE" },
		{ path: "Team/Jane Doe/1-on-1s/2026-09-02.md", date: "2026-09-02", body: "THIRD-NOTE" },
	];
	const goals: PrepGoal[] = [
		{ path: "Team/Jane Doe/Goals/g1.md", title: "Improve reviews", status: "in-progress", description: undefined, targetDate: "2026-12-31" },
		{ path: "Team/Jane Doe/Goals/g2.md", title: "Learn Rust", status: "blocked", description: undefined, targetDate: undefined },
	];
	return { personName: "Jane Doe", profile: PROFILE, notes, goals, ...overrides };
}

describe("buildPrepPrompt (pure)", () => {
	it("includes the notes oldest-to-newest, in order, with date and path", () => {
		const prompt = buildPrepPrompt(promptInput());
		const firstNote = prompt.indexOf("SECOND-NOTE");
		const secondNote = prompt.indexOf("THIRD-NOTE");
		expect(firstNote).toBeGreaterThan(-1);
		expect(secondNote).toBeGreaterThan(firstNote);
		expect(prompt).toContain("### 1:1 on 2026-08-19 (Team/Jane Doe/1-on-1s/2026-08-19.md)");
		expect(prompt).toContain("### 1:1 on 2026-09-02 (Team/Jane Doe/1-on-1s/2026-09-02.md)");
	});

	it("includes open goals with status and target date", () => {
		const prompt = buildPrepPrompt(promptInput());
		expect(prompt).toContain("- [in-progress] Improve reviews, target 2026-12-31");
		expect(prompt).toContain("- [blocked] Learn Rust");
	});

	it("includes the person profile", () => {
		const prompt = buildPrepPrompt(promptInput());
		expect(prompt).toContain("- Role: Senior Engineer");
		expect(prompt).toContain("- Started: 2024-03-01");
	});

	it("instructs the four brief sections and the draft framing", () => {
		const prompt = buildPrepPrompt(promptInput());
		for (const section of [
			"Suggested talking points",
			"Open action items to follow up",
			"Past concerns to revisit",
			"Goal check-in prompts",
		]) {
			expect(prompt).toContain(section);
		}
		expect(prompt).toContain("starting draft");
		expect(prompt).toContain("not a source of truth");
		expect(prompt).toContain("do not invent facts");
	});

	it("states its purpose with the person's name", () => {
		expect(buildPrepPrompt(promptInput())).toContain(
			"one-on-one meeting with Jane Doe",
		);
	});

	it("uses explicit placeholders when there is nothing to include", () => {
		const prompt = buildPrepPrompt({ personName: "New", profile: null, notes: [], goals: [] });
		expect(prompt).toContain("(no profile on file)");
		expect(prompt).toContain("(no past 1:1 notes on file)");
		expect(prompt).toContain("(no open goals)");
	});
});

describe("truncation", () => {
	it("caps each note body at the budget with a truncation marker", () => {
		const longBody = "x".repeat(MAX_NOTE_CHARS + 5000);
		const prompt = buildPrepPrompt(
			promptInput({ notes: [{ path: "p.md", date: "2026-01-01", body: longBody }] }),
		);
		expect(prompt).toContain("[…truncated — 5000 more characters omitted]");
		// The note body contributes at most the budget; the rest of the prompt
		// is the fixed profile/goals/task boilerplate (a few hundred chars).
		expect(prompt.length).toBeLessThan(MAX_NOTE_CHARS + 1200);
	});

	it("leaves short notes untouched", () => {
		const body = "short body";
		expect(truncateForPrompt(body, 100)).toBe(body);
		expect(buildPrepPrompt(promptInput())).toContain("SECOND-NOTE");
	});

	it("honors a custom budget", () => {
		expect(truncateForPrompt("abcdefgh", 3)).toBe("abc\n[…truncated — 5 more characters omitted]");
	});
});

describe("assemblePrepContext", () => {
	it("gathers profile, recent notes, and open goals — with accurate sources", async () => {
		const { vault, settings } = await seedJaneVault();
		const context = await assemblePrepContext("Jane Doe", {
			vault,
			settings: { ...settings, prepContextNotes: 2 },
		});

		expect(context.personName).toBe("Jane Doe");
		// Profile first, then the two most recent notes, then open goals.
		expect(context.sources).toEqual([
			{ path: "Team/Jane Doe/_index.md", date: "2024-03-01", kind: "person" },
			{ path: "Team/Jane Doe/1-on-1s/2026-08-19.md", date: "2026-08-19", kind: "one-on-one" },
			{ path: "Team/Jane Doe/1-on-1s/2026-09-02.md", date: "2026-09-02", kind: "one-on-one" },
			{ path: "Team/Jane Doe/Goals/2026-q3-improve-review-turnaround.md", date: "2026-12-31", kind: "goal" },
			{ path: "Team/Jane Doe/Goals/2026-q3-learn-rust.md", date: "", kind: "goal" },
		]);

		// The most recent N notes only — the first note stays out of the prompt.
		expect(context.prompt).toContain("SECOND-NOTE");
		expect(context.prompt).toContain("THIRD-NOTE");
		expect(context.prompt).not.toContain("FIRST-NOTE");
		// Open goals in, done goals out.
		expect(context.prompt).toContain("Improve review turnaround");
		expect(context.prompt).toContain("Learn Rust");
		expect(context.prompt).not.toContain("Migrate service");
	});

	it("defaults to settings.prepContextNotes when noteCount is not given", async () => {
		const { vault } = await seedJaneVault({ ...DEFAULT_SETTINGS, prepContextNotes: 1 });
		const context = await assemblePrepContext("Jane Doe", { vault, settings: { ...DEFAULT_SETTINGS, prepContextNotes: 1 } });
		expect(context.prompt).toContain("THIRD-NOTE");
		expect(context.prompt).not.toContain("SECOND-NOTE");
	});

	it("includes note bodies without their frontmatter", async () => {
		const { vault, settings } = await seedJaneVault();
		const context = await assemblePrepContext("Jane Doe", { vault, settings });
		expect(context.prompt).not.toContain("action_items_open");
		expect(context.prompt).toContain("THIRD-NOTE promotion path discussion.");
	});

	it("throws an actionable error for an unknown person", async () => {
		const { vault, settings } = await seedJaneVault();
		await expect(
			assemblePrepContext("Nobody", { vault, settings }),
		).rejects.toThrow(/No team member named "Nobody" found under Team/);
	});
});
