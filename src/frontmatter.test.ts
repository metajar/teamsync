import { describe, expect, it } from "vitest";
import { buildNote, splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
	it("parses the PRD's 1:1 example", () => {
		const content = [
			"---",
			"type: one-on-one",
			"person: Jane Doe",
			"date: 2026-09-09",
			"mood: 4",
			"action_items_open: 2",
			"---",
			"",
			"# 1:1 with Jane",
		].join("\n");
		expect(splitFrontmatter(content)).toEqual({
			frontmatter: {
				type: "one-on-one",
				person: "Jane Doe",
				date: "2026-09-09",
				mood: 4,
				action_items_open: 2,
			},
			body: "\n# 1:1 with Jane",
		});
	});

	it("keeps ISO dates as strings, numbers as numbers", () => {
		const { frontmatter } = splitFrontmatter(
			"---\ndate: 2026-09-09\nmood: 4\nversion: 1.5\n---\n",
		);
		expect(frontmatter.date).toBe("2026-09-09");
		expect(frontmatter.mood).toBe(4);
		expect(frontmatter.version).toBe(1.5);
	});

	it("returns empty frontmatter when there is no fence", () => {
		expect(splitFrontmatter("# Just a note\n")).toEqual({
			frontmatter: {},
			body: "# Just a note\n",
		});
	});

	it("returns empty frontmatter for an unterminated fence", () => {
		const content = "---\ntype: person\nno closing fence";
		expect(splitFrontmatter(content)).toEqual({ frontmatter: {}, body: content });
	});

	it("parses block-style string lists", () => {
		const { frontmatter } = splitFrontmatter(
			"---\ndiscussed_in:\n  - \"[[2026-09-02]]\"\n  - \"[[2026-09-09]]\"\n---\n",
		);
		expect(frontmatter.discussed_in).toEqual(["[[2026-09-02]]", "[[2026-09-09]]"]);
	});

	it("parses inline-style string lists", () => {
		const { frontmatter } = splitFrontmatter(
			"---\ntags: [one-on-one, prep]\n---\n",
		);
		expect(frontmatter.tags).toEqual(["one-on-one", "prep"]);
	});
});

describe("buildNote", () => {
	it("round-trips scalars, including strings with colons", () => {
		const fm = {
			type: "person",
			name: "Jane: Doe",
			role: "Staff Engineer",
			start_date: "2024-01-15",
			level: "5",
			headcount: 5,
		};
		const note = buildNote(fm, "\nbody text");
		expect(splitFrontmatter(note).frontmatter).toEqual(fm);
	});

	it("round-trips string lists, including items needing quotes", () => {
		const fm = {
			discussed_in: ["[[2026-09-02]]", "note: with colon", "plain"],
			empty: [] as string[],
		};
		const note = buildNote(fm, "");
		expect(splitFrontmatter(note).frontmatter).toEqual(fm);
	});

	it("round-trips the body verbatim", () => {
		const body = "\n## Agenda\n\n- [ ] item one\n- [x] done\n";
		expect(splitFrontmatter(buildNote({ type: "goal" }, body)).body).toBe(body);
	});

	it("writes ISO dates and numbers unquoted", () => {
		const note = buildNote(
			{ date: "2026-09-09", mood: 4, person: "Jane Doe" },
			"",
		);
		expect(note).toContain("date: 2026-09-09");
		expect(note).toContain("mood: 4");
		expect(note).toContain("person: Jane Doe");
	});

	it("quotes strings that would otherwise coerce to another type", () => {
		const note = buildNote({ badge: "42", flag: "true" }, "");
		expect(note).toContain("badge: '42'");
		expect(note).toContain("flag: 'true'");
		expect(splitFrontmatter(note).frontmatter).toEqual({
			badge: "42",
			flag: "true",
		});
	});

	it("escapes single quotes inside quoted strings", () => {
		const fm = { note: "it's Jane's" };
		expect(splitFrontmatter(buildNote(fm, "")).frontmatter).toEqual(fm);
	});

	it("produces the exact documented envelope", () => {
		expect(buildNote({ type: "person" }, "body")).toBe(
			"---\ntype: person\n---\nbody",
		);
	});

	it("round-trips an empty frontmatter object", () => {
		const note = buildNote({}, "\nbody");
		expect(note).toBe("---\n---\n\nbody");
		expect(splitFrontmatter(note)).toEqual({ frontmatter: {}, body: "\nbody" });
	});
});
