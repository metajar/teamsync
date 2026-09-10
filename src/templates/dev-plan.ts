/**
 * Default body template for development plan notes (`Development-Plan.md` by
 * default — see `devPlanFile` in settings). DevPlanService fills it via
 * `renderTemplate` and prepends the `dev-plan` frontmatter via `buildNote`.
 *
 * Structured data lives in frontmatter only (`last_reviewed` drives the
 * dashboard freshness badge); the body is free-form apart from the
 * revision-log section heading, which `markReviewed` locates to append dated
 * review lines.
 *
 * Placeholders:
 *   person             person name (required)
 *   last_reviewed      ISO date of creation/review (required)
 *   goals_link         vault path of the person's Goals folder
 *   one_on_ones_link   vault path of the person's 1:1 folder
 */
export const DEV_PLAN_TEMPLATE = `# Development plan — {{person}}

## Growth areas

- Growth area one
- Growth area two

## Skills to build

- Skill one
- Skill two

## Target role / level

Where they want to head next, and what the next level looks like on their track.

## Stretch opportunities

- A project or responsibility slightly beyond current scope

## Evidence

Goals and 1:1 notes that back this plan:

- [[{{goals_link}}|Goals]]
- [[{{one_on_ones_link}}|1:1 notes]]

## Revision log

- {{last_reviewed}} — plan created
`;
