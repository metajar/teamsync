import type { MetadataCache, Vault } from "obsidian";
import { GoalService } from "../goal.service";
import { OneOnOneService } from "../one-on-one.service";
import { PersonService } from "../person.service";
import { devPlanPath } from "../paths";
import { splitFrontmatter } from "../frontmatter";
import type { TeamSyncSettings } from "../settings";
import { MAX_NOTE_CHARS, truncateForPrompt } from "./prep-context";
import type { PrepGoal, PrepNote, PrepProfile, PrepSource } from "./prep-context";

/**
 * Context assembly for the "Generate Overview" AI command (see
 * .mex/patterns/ollama-feature.md). Same boundary rules as prep-context:
 * everything goes through the service layer, this module never touches the
 * network, and the prompt builder is pure and directly testable.
 *
 * Unlike the prep brief, the overview includes ALL goals (done ones carry the
 * "wins" story) and the person's development plan when one can be read.
 *
 * Token budgeting: overviews share the prep context budget for now — at most
 * `prepContextNotes` (default 5) 1:1 note bodies, each truncated to
 * MAX_NOTE_CHARS via the shared truncateForPrompt helper. No separate
 * overview budget setting exists yet.
 */

export interface OverviewDevPlan {
	path: string;
	body: string;
}

export interface OverviewPromptInput {
	personName: string;
	profile: PrepProfile | null;
	/** Past notes, oldest first — the order they appear in the prompt. */
	notes: PrepNote[];
	/** ALL goals with statuses — done goals included, unlike prep. */
	goals: PrepGoal[];
	devPlan: OverviewDevPlan | null;
}

/** What the send-preview modal shows and OllamaClient.generate receives. */
export interface OverviewContext {
	personName: string;
	/**
	 * False when the person has no 1:1 notes and no goals — there is nothing
	 * to summarize yet, so the command exits before opening the preview.
	 * (A dev plan alone does not count as material.)
	 */
	hasMaterial: boolean;
	sources: PrepSource[];
	prompt: string;
}

/**
 * PURE prompt builder (no I/O). Asks for a manager-facing person overview:
 * role/context summary, goals snapshot, recurring themes from recent 1:1s,
 * wins, and suggested focus areas — framed as a draft and told to cite the
 * notes it drew from.
 */
export function buildOverviewPrompt(
	input: OverviewPromptInput,
	noteBudget: number = MAX_NOTE_CHARS,
): string {
	const lines: string[] = [];

	lines.push(
		`You are writing a manager-facing overview of ${input.personName}, a member of the manager's team.`,
		"Below are the person's profile, all of their goal notes, their recent 1:1 meeting notes, " +
			"and their development plan when one is on file.",
		"",
	);

	lines.push("## Person profile");
	if (input.profile) {
		const role = input.profile.role?.trim() || "not recorded";
		const started = input.profile.startDate?.trim() || "not recorded";
		lines.push(`- Role: ${role}`);
		lines.push(`- Started: ${started}`);
	} else {
		lines.push("- (no profile on file)");
	}
	lines.push("");

	lines.push("## Goals (all, with statuses)");
	if (input.goals.length === 0) {
		lines.push("(no goals on file)");
	}
	for (const goal of input.goals) {
		const target = goal.targetDate ? `, target ${goal.targetDate}` : "";
		lines.push(`- [${goal.status}] ${goal.title}${target} (${goal.path})`);
		if (goal.description) {
			lines.push(`  ${goal.description}`);
		}
	}
	lines.push("");

	lines.push("## Recent 1:1 notes (oldest to newest)");
	if (input.notes.length === 0) {
		lines.push("(no 1:1 notes on file)");
	}
	for (const note of input.notes) {
		lines.push(`### 1:1 on ${note.date} (${note.path})`);
		lines.push(truncateForPrompt(note.body.trim(), noteBudget));
		lines.push("");
	}

	lines.push("## Development plan");
	if (input.devPlan) {
		lines.push(`(${input.devPlan.path})`);
		lines.push(truncateForPrompt(input.devPlan.body.trim(), noteBudget));
	} else {
		lines.push("(no development plan on file)");
	}
	lines.push("");

	lines.push(
		"## Your task",
		`Write a manager-facing overview of ${input.personName} with these sections:`,
		"1. Role and context summary",
		"2. Goals snapshot (with current statuses)",
		"3. Recurring themes and concerns (from the recent 1:1s)",
		"4. Wins and accomplishments",
		"5. Suggested focus areas",
		"",
		"Rules:",
		"- Base every point on the profile, goals, 1:1 notes, and development plan above; do not invent facts.",
		"- Where a point rests on a specific note, name that note's path so the manager can trace it.",
		"- Your output is a starting draft for the manager to edit, not a source of truth.",
		"- Keep it concise: plain language, a few bullets per section.",
	);

	return lines.join("\n");
}

export interface OverviewContextDeps {
	vault: Vault;
	settings: TeamSyncSettings;
	metadataCache?: MetadataCache;
	/** Overrides settings.prepContextNotes (tests). */
	noteCount?: number;
	/**
	 * Dev-plan read seam. DevPlanService does not exist yet (parallel work),
	 * and the AI path must not read the vault itself — so the command layer
	 * supplies this reader, built on `vault.cachedRead`. Given a path, it
	 * returns the file's raw content, or null when the file does not exist.
	 * TODO: replace with a DevPlanService body-read method once it lands.
	 */
	readFile?: (path: string) => Promise<string | null>;
}

/**
 * Gather the overview context for one person via the service layer: the
 * person's profile (PersonService), the last `prepContextNotes` 1:1 bodies
 * (OneOnOneService), and ALL goals with statuses (GoalService), plus the
 * development plan body through the injected reader when provided.
 * Throws with an actionable message when the person does not exist.
 */
export async function assembleOverviewContext(
	personName: string,
	deps: OverviewContextDeps,
): Promise<OverviewContext> {
	const { vault, settings } = deps;
	const personService = new PersonService(vault, settings, deps.metadataCache);
	const oneOnOneService = new OneOnOneService(vault, settings);
	const goalService = new GoalService(vault, settings);

	const person = await personService.getPerson(personName);
	if (!person) {
		throw new Error(
			`No team member named "${personName}" found under ${settings.rootFolder}. ` +
				"Add the person first.",
		);
	}

	const count = deps.noteCount ?? settings.prepContextNotes;
	const history = await oneOnOneService.listOneOnOnes(person.name);
	const recent = history.slice(Math.max(0, history.length - Math.max(0, count)));
	const notes: PrepNote[] = [];
	for (const note of recent) {
		notes.push({
			path: note.file.path,
			date: note.date,
			body: await oneOnOneService.readOneOnOneBody(note),
		});
	}

	const goals: PrepGoal[] = (await goalService.listGoals(person.name)).map(
		(goal) => ({
			path: goal.path,
			title: goal.title,
			status: goal.status,
			description: goal.description,
			targetDate: goal.targetDate,
		}),
	);

	let devPlan: OverviewDevPlan | null = null;
	if (deps.readFile) {
		const path = devPlanPath(settings, person.name);
		const content = await deps.readFile(path);
		if (content !== null) {
			// Strip frontmatter here (pure helper) — the reader is content-only.
			devPlan = { path, body: splitFrontmatter(content).body };
		}
	}

	const sources: PrepSource[] = [
		{ path: person.indexPath, date: person.startDate ?? "", kind: "person" },
		...notes.map((note) => ({
			path: note.path,
			date: note.date,
			kind: "one-on-one" as const,
		})),
		...goals.map((goal) => ({
			path: goal.path,
			date: goal.targetDate ?? "",
			kind: "goal" as const,
		})),
	];
	if (devPlan) {
		sources.push({ path: devPlan.path, date: "", kind: "dev-plan" });
	}

	const prompt = buildOverviewPrompt({
		personName: person.name,
		profile: person,
		notes,
		goals,
		devPlan,
	});

	return {
		personName: person.name,
		hasMaterial: notes.length > 0 || goals.length > 0,
		sources,
		prompt,
	};
}
