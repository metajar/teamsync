import type { TeamSyncSettings } from "./settings";

/**
 * The single source of vault paths. All feature code derives paths through
 * these helpers — no literal path strings outside this module.
 *
 * Every helper returns a normalized vault path with no leading or trailing
 * slash ("" only for the vault root, which feature code should never request).
 */

/** Join non-empty segments with "/", trimming stray slashes per segment. */
export function joinPath(...segments: string[]): string {
	return segments
		.map((segment) => segment.replace(/^\/+|\/+$/g, ""))
		.filter((segment) => segment !== "")
		.join("/");
}

/** e.g. "Team/Jane Doe" */
export function personFolder(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(settings.rootFolder, personName);
}

/** e.g. "Team/Jane Doe/1-on-1s" */
export function oneOnOneFolder(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(personFolder(settings, personName), settings.oneOnOnesFolder);
}

/** e.g. "Team/Jane Doe/Goals" */
export function goalsFolder(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(personFolder(settings, personName), settings.goalsFolder);
}

/** e.g. "Team/Jane Doe/_index.md" */
export function personIndexPath(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(personFolder(settings, personName), settings.personIndexFile);
}

/** e.g. "Team/Jane Doe/Development-Plan.md" */
export function devPlanPath(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(personFolder(settings, personName), settings.devPlanFile);
}

/** e.g. "Team/Jane Doe/topics.md" */
export function topicsPath(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(personFolder(settings, personName), settings.topicsFile);
}

/** e.g. "Team/Jane Doe/Overview.md" */
export function overviewPath(
	settings: TeamSyncSettings,
	personName: string,
): string {
	return joinPath(personFolder(settings, personName), settings.overviewFile);
}
