/**
 * Default template for `one-on-one` notes.
 *
 * Rendered via renderTemplate() — placeholders:
 *   {{person}}         person name (heading)
 *   {{date}}           ISO date of the meeting (heading)
 *   {{carried_forward}} injected block of open items from the previous 1:1
 *                       ("### Carried forward from <date>" + unchecked
 *                       checkboxes), or "" when there is nothing to carry.
 *
 * The empty `- [ ] ` checkbox under Action Items is intentional scaffolding;
 * the carry-forward parser ignores checkboxes with no text, so it never
 * propagates into the next note.
 */
export const ONE_ON_ONE_TEMPLATE = `# 1:1 — {{person}} — {{date}}

## Agenda / Talking Points

{{carried_forward}}
## Notes


## Wins / Concerns


## Action Items

- [ ]

## Pulse

Mood:
`;
