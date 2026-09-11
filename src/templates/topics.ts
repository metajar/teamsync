/**
 * Default template for the per-person `topics` note (`topics.md` by default —
 * see `topicsFile` in settings): the running list of discussion topics queued
 * for the next 1:1.
 *
 * Rendered via renderTemplate() — placeholders:
 *   {{person}}  person name (body context only; the name also goes to
 *               frontmatter via buildNote)
 *
 * Topics live as plain top-level bullets (`- something to discuss`) under the
 * heading — one of the two sanctioned body reads (see .mex/context/
 * data-model.md, Discussion Topics Rule). Checkbox lines (`- [ ] …`) are
 * deliberately NOT topics: they are ignored by the parser, so a user can
 * strike a queued topic without deleting the line.
 */
export const TOPICS_TEMPLATE = `## Discussion topics

Topics to raise at the next 1:1 with {{person}}. One per line as a plain
bullet — creating the 1:1 note moves them into its agenda and empties this
list. Unticked topics in past 1:1s carry forward on their own.
`;
