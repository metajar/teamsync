import type { MetadataCache, Vault } from "obsidian";
import { GoalService } from "../goal.service";
import { OneOnOneService } from "../one-on-one.service";
import { PersonService } from "../person.service";
import type { TeamSyncSettings } from "../settings";

/**
 * Context assembly for the "Prep 1:1 with AI" command (see
 * .mex/patterns/ollama-feature.md). All vault access goes through the
 * service layer — OllamaClient never reads the vault, and this module never
 * touches the network. The prompt builder is a pure exported function so
 * prompt shape and truncation are directly testable.
 */

/**
 * Character budget per 1:1 note in the prompt. 4000 chars is roughly 1k
 * tokens — five notes plus goals stays comfortably inside a small model's
 * context window while still carrying the full structure of each note.
 * Years of history degrade by including fewer notes (prepContextNotes),
 * not by blowing the window.
 */
export const MAX_NOTE_CHARS = 4000;

export type PrepSourceKind = "one-on-one" | "goal" | "person" | "dev-plan";

/** A note the prompt drew from — shown to the user as the citation list. */
export interface PrepSource {
	path: string;
	date: string;
	kind: PrepSourceKind;
}

/** What the send-preview modal shows and OllamaClient.generate receives. */
export interface PrepContext {
	personName: string;
	sources: PrepSource[];
	prompt: string;
}

export interface PrepProfile {
	role: string | undefined;
	startDate: string | undefined;
}

export interface PrepNote {
	path: string;
	date: string;
	body: string;
}

export interface PrepGoal {
	path: string;
	title: string;
	status: string;
	description: string | undefined;
	targetDate: string | undefined;
}

/** Cap a note body at `budget` characters with an explicit truncation marker. */
export function truncateForPrompt(text: string, budget: number = MAX_NOTE_CHARS): string {
	if (text.length <= budget) {
		return text;
	}
	const omitted = text.length - budget;
	return `${text.slice(0, budget)}\n[…truncated — ${omitted} more characters omitted]`;
}

export interface PrepPromptInput {
	personName: string;
	profile: PrepProfile | null;
	/** Past notes, oldest first — the order they appear in the prompt. */
	notes: PrepNote[];
	/** Open goals only; the assembler filters. */
	goals: PrepGoal[];
}

/**
 * PURE prompt builder (no I/O) — same input, same prompt, testable directly.
 * Instructs the model to return a brief with the four prep sections and to
 * treat its own output as a starting draft, not a source of truth.
 */
export function buildPrepPrompt(
	input: PrepPromptInput,
	noteBudget: number = MAX_NOTE_CHARS,
): string {
	const lines: string[] = [];

	lines.push(
		`You are preparing a manager for their next one-on-one meeting with ${input.personName}.`,
		"Below are the person's profile, their recent 1:1 meeting notes, and their open goals.",
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

	lines.push("## Past 1:1 notes (oldest to newest)");
	if (input.notes.length === 0) {
		lines.push("(no past 1:1 notes on file)");
	}
	for (const note of input.notes) {
		lines.push(`### 1:1 on ${note.date} (${note.path})`);
		lines.push(truncateForPrompt(note.body.trim(), noteBudget));
		lines.push("");
	}

	lines.push("## Open goals");
	if (input.goals.length === 0) {
		lines.push("(no open goals)");
	}
	for (const goal of input.goals) {
		const target = goal.targetDate ? `, target ${goal.targetDate}` : "";
		lines.push(`- [${goal.status}] ${goal.title}${target} (${goal.path})`);
		if (goal.description) {
			lines.push(`  ${goal.description}`);
		}
	}
	lines.push("");

	lines.push(
		"## Your task",
		"Write a concise prep brief for the manager's next 1:1 with these sections:",
		"1. Suggested talking points",
		"2. Open action items to follow up",
		"3. Past concerns to revisit",
		"4. Goal check-in prompts",
		"",
		"Rules:",
		"- Base every point on the notes and goals above; do not invent facts.",
		"- Your output is a starting draft for the manager to edit, not a source of truth.",
		"- Keep it brief: a few bullets per section, in plain language.",
	);

	return lines.join("\n");
}

export interface PrepContextDeps {
	vault: Vault;
	settings: TeamSyncSettings;
	metadataCache?: MetadataCache;
	/** Overrides settings.prepContextNotes (tests). */
	noteCount?: number;
}

/**
 * Gather the prep context for one person via the service layer: the last
 * `prepContextNotes` 1:1 note bodies, open goals, and the person profile.
 * Throws with an actionable message when the person does not exist.
 */
export async function assemblePrepContext(
	personName: string,
	deps: PrepContextDeps,
): Promise<PrepContext> {
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

	const goals: PrepGoal[] = (await goalService.listGoals(person.name))
		.filter((goal) => goal.status !== "done")
		.map((goal) => ({
			path: goal.path,
			title: goal.title,
			status: goal.status,
			description: goal.description,
			targetDate: goal.targetDate,
		}));

	// TODO(Phase 2): once DevPlanService exists, include the development plan
	// here as another prompt section and a source of kind "dev-plan".

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

	const prompt = buildPrepPrompt({
		personName: person.name,
		profile: person,
		notes,
		goals,
	});

	return { personName: person.name, sources, prompt };
}
