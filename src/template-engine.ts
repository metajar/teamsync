/**
 * Hand-rolled `{{placeholder}}` substitution — the only note-rendering
 * mechanism in the plugin (no template-engine dependency).
 *
 * Syntax: `{{name}}` or `{{ name }}` (surrounding whitespace is ignored),
 * where `name` is `[A-Za-z0-9_-]+`. Any `{{...}}` whose inner text is not a
 * valid placeholder name is left untouched.
 *
 * A placeholder with no entry in `values` (or an explicit `undefined` value)
 * resolves to the empty string — templates never fail on missing data.
 */
export function renderTemplate(
	template: string,
	values: Record<string, string | undefined>,
): string {
	return template.replace(
		/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g,
		(match, name: string) => {
			const value = values[name];
			return value === undefined ? "" : value;
		},
	);
}
