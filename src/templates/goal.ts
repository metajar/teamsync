/**
 * Default body template for goal notes. GoalService fills it via
 * `renderTemplate` and prepends the `goal` frontmatter via `buildNote`.
 *
 * Structured data (status, dates, links) lives in frontmatter only — the body
 * is free-form and never parsed for structure. The status line below is
 * display-only and intentionally not a placeholder: status changes go through
 * `TeamSync: Update goal status`, which rewrites frontmatter.
 *
 * Placeholders:
 *   title       goal statement (required)
 *   person      person name (required)
 */
export const GOAL_TEMPLATE = `# {{title}}

For {{person}}.

## Status legend

- \`not-started\` — agreed, no work yet
- \`in-progress\` — actively being worked
- \`blocked\` — stuck; discuss in the next 1:1
- \`done\` — completed

## Notes

Context, success criteria, and what "done" looks like.

## Progress log

- [ ] First update goes here.
`;
