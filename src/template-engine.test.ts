import { describe, expect, it } from "vitest";
import { renderTemplate } from "./template-engine";

describe("renderTemplate", () => {
	it("fills placeholders from values", () => {
		expect(renderTemplate("Hello {{name}}!", { name: "Jane" })).toBe(
			"Hello Jane!",
		);
	});

	it("replaces every occurrence of a placeholder", () => {
		expect(
			renderTemplate("{{person}} said {{person}} would", { person: "Jane" }),
		).toBe("Jane said Jane would");
	});

	it("resolves missing placeholders to the empty string", () => {
		expect(renderTemplate("Hello {{name}}!", {})).toBe("Hello !");
	});

	it("resolves explicitly-undefined placeholders to the empty string", () => {
		expect(renderTemplate("Hello {{name}}!", { name: undefined })).toBe(
			"Hello !",
		);
	});

	it("tolerates whitespace inside the braces", () => {
		expect(renderTemplate("Hello {{  name }} and {{name }}!", { name: "Jane" })).toBe(
			"Hello Jane and Jane!",
		);
	});

	it("passes values through verbatim, including YAML/template specials", () => {
		expect(
			renderTemplate("date: {{date}}\nnote: {{note}}", {
				date: "2026-09-10",
				note: "has: colon, {{nested}} and #tag",
			}),
		).toBe("date: 2026-09-10\nnote: has: colon, {{nested}} and #tag");
	});

	it("leaves non-placeholder braces untouched", () => {
		const template = "if (x) { return {{value}}; } — {{!invalid}} stays";
		expect(renderTemplate(template, { value: "42" })).toBe(
			"if (x) { return 42; } — {{!invalid}} stays",
		);
	});

	it("renders an empty template to an empty string", () => {
		expect(renderTemplate("", { anything: "x" })).toBe("");
	});
});
