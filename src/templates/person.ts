/**
 * Default body template for the person index note (`_index.md` by default —
 * see `personIndexFile` in settings). The service fills it via
 * `renderTemplate` and prepends the `person` frontmatter via `buildNote`.
 *
 * Placeholders:
 *   name              display name (required)
 *   role              job title (optional — renders empty when unset)
 *   start_date        ISO date (optional — renders empty when unset)
 *   one_on_ones_link  vault path of the person's 1:1 folder
 *   goals_link        vault path of the person's Goals folder
 *   dev_plan_link     vault path of the person's development plan note
 *   topics_link       vault path of the person's running discussion-topics note
 */
export const PERSON_TEMPLATE = `# {{name}}

## Profile

- **Role:** {{role}}
- **Start date:** {{start_date}}

## Quick links

- [[{{one_on_ones_link}}|1:1 notes]]
- [[{{topics_link}}|Discussion topics]]
- [[{{goals_link}}|Goals]]
- [[{{dev_plan_link}}|Development plan]]

## Notes

Context that helps you manage them well: what they own, how they like
feedback, current focus.
`;
