/**
 * Hand-rolled YAML frontmatter reader/writer (no YAML library).
 *
 * Scope: the flat scalar + simple string-list YAML this project needs —
 * string, number, ISO date, and `string[]` values under snake_case keys.
 * Not supported: nested maps, multiline block scalars, anchors, booleans
 * (true/false parse back as strings), flow maps.
 *
 * Round-trip guarantee: for any Frontmatter value shape above,
 * `splitFrontmatter(buildNote(fm, body))` returns `fm` and `body` exactly.
 */

/** Values this module can read and write: string, number, or string list. */
export type FrontmatterValue = string | number | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface SplitResult {
	frontmatter: Frontmatter;
	body: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const QUOTED_STRING = /^(["'])([\s\S]*)\1$/;

/**
 * Split a note into frontmatter and body. If the content does not start with
 * a `---` fence, the whole content is the body and frontmatter is `{}`.
 */
export function splitFrontmatter(content: string): SplitResult {
	const lines = content.split("\n");
	if (lines[0].trim() !== "---") {
		return { frontmatter: {}, body: content };
	}

	const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
	if (end === -1) {
		return { frontmatter: {}, body: content };
	}

	const frontmatter: Frontmatter = {};
	let pendingListKey: string | null = null;

	for (const line of lines.slice(1, end)) {
		const item = line.match(/^\s+-\s?(.*)$/);
		if (item && pendingListKey !== null) {
			const list = frontmatter[pendingListKey];
			if (Array.isArray(list)) {
				list.push(parseQuoted(item[1].trim()));
			}
			continue;
		}

		const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!entry) {
			continue; // blank or malformed line — skip
		}
		const [, key, raw] = entry;
		pendingListKey = null;

		if (raw === "") {
			// Block list follows, or an empty value.
			frontmatter[key] = [];
			pendingListKey = key;
		} else if (raw.startsWith("[") && raw.endsWith("]")) {
			frontmatter[key] = raw
				.slice(1, -1)
				.split(",")
				.map((part) => parseQuoted(part.trim()))
				.filter((part) => part !== "");
		} else {
			frontmatter[key] = parseScalar(raw.trim());
		}
	}

	const body = lines.slice(end + 1).join("\n");
	return { frontmatter, body };
}

/**
 * Serialize frontmatter + body into a note. Output shape:
 * `---\n<yaml>---\n<body>` — the body is inserted verbatim after the closing
 * fence's newline, so pass a leading newline yourself if you want a blank
 * line between frontmatter and body.
 */
export function buildNote(frontmatter: Frontmatter, body: string): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${key}: []`);
			} else {
				lines.push(`${key}:`);
				for (const item of value) {
					lines.push(`  - ${formatScalar(item)}`);
				}
			}
		} else {
			lines.push(`${key}: ${formatScalar(value)}`);
		}
	}
	const yaml = lines.length > 0 ? lines.join("\n") + "\n" : "";
	return `---\n${yaml}---\n${body}`;
}

/** Parse a YAML scalar: quoted string, ISO date, number, or plain string. */
function parseScalar(raw: string): FrontmatterValue {
	const unquoted = parseQuoted(raw);
	if (unquoted !== raw) {
		return unquoted; // was quoted — never coerce the type
	}
	if (ISO_DATE.test(raw)) {
		return raw; // dates stay strings
	}
	if (NUMBER.test(raw)) {
		return Number(raw);
	}
	return raw;
}

/** Strip matching surrounding quotes; single quotes unescape '' → '. */
function parseQuoted(raw: string): string {
	const quoted = raw.match(QUOTED_STRING);
	if (!quoted) {
		return raw;
	}
	if (quoted[1] === "'") {
		return quoted[2].replace(/''/g, "'");
	}
	return quoted[2];
}

/**
 * Format one scalar for YAML: bare when safe, single-quoted otherwise.
 * Quoting preserves strings that would otherwise re-parse as another type
 * (numbers, booleans, null — ISO dates are already strings on the way back,
 * so they stay unquoted) and strings containing YAML-special characters
 * (`: ` trailing `:`, `#`, flow indicators, quotes, leading/trailing
 * whitespace, empty).
 */
function formatScalar(value: string | number): string {
	if (typeof value === "number") {
		return String(value);
	}
	if (needsQuote(value)) {
		return `'${value.replace(/'/g, "''")}'`;
	}
	return value;
}

function needsQuote(value: string): boolean {
	if (value === "") {
		return true;
	}
	if (NUMBER.test(value)) {
		return true; // it's a string that must not coerce to a number
	}
	if (/^(true|false|null|~)$/.test(value)) {
		return true;
	}
	if (value !== value.trim()) {
		return true;
	}
	if (/^[-?:][\s]/.test(value) || /^[-?]$/.test(value)) {
		return true;
	}
	// Colon-space anywhere, trailing colon, hash anywhere, or any of the
	// indicator/quote characters makes a plain scalar unsafe.
	if (/: |\s#$| #|:|^#/.test(value)) {
		return true;
	}
	if (/["'#\[\]{}&*!|>%@`,]/.test(value)) {
		return true;
	}
	return false;
}
