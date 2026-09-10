import { describe, expect, it } from "vitest";
import {
	devPlanPath,
	goalsFolder,
	joinPath,
	oneOnOneFolder,
	personFolder,
	personIndexPath,
} from "./paths";
import { DEFAULT_SETTINGS, type TeamSyncSettings } from "./settings";

const custom: TeamSyncSettings = {
	rootFolder: "People/",
	oneOnOnesFolder: "One-on-Ones",
	goalsFolder: "/Objectives/",
	personIndexFile: "profile.md",
	devPlanFile: "Dev-Plan.md",
};

describe("path derivation (default settings)", () => {
	const s = DEFAULT_SETTINGS;

	it("derives the person folder", () => {
		expect(personFolder(s, "Jane Doe")).toBe("Team/Jane Doe");
	});

	it("derives the 1:1 folder", () => {
		expect(oneOnOneFolder(s, "Jane Doe")).toBe("Team/Jane Doe/1-on-1s");
	});

	it("derives the goals folder", () => {
		expect(goalsFolder(s, "Jane Doe")).toBe("Team/Jane Doe/Goals");
	});

	it("derives the person index path", () => {
		expect(personIndexPath(s, "Jane Doe")).toBe("Team/Jane Doe/_index.md");
	});

	it("derives the dev plan path", () => {
		expect(devPlanPath(s, "Jane Doe")).toBe("Team/Jane Doe/Development-Plan.md");
	});
});

describe("path derivation (custom settings)", () => {
	it("normalizes stray slashes from settings values", () => {
		expect(personFolder(custom, "Jane Doe")).toBe("People/Jane Doe");
		expect(goalsFolder(custom, "Jane Doe")).toBe("People/Jane Doe/Objectives");
		expect(personIndexPath(custom, "Jane Doe")).toBe("People/Jane Doe/profile.md");
		expect(devPlanPath(custom, "Jane Doe")).toBe("People/Jane Doe/Dev-Plan.md");
	});
});

describe("joinPath", () => {
	it("joins non-empty segments", () => {
		expect(joinPath("a", "b", "c")).toBe("a/b/c");
	});

	it("drops empty segments and trims slashes", () => {
		expect(joinPath("/a/", "", "b//", "c")).toBe("a/b/c");
	});

	it("returns the root as the empty string when nothing remains", () => {
		expect(joinPath("", "/", "")).toBe("");
	});
});
