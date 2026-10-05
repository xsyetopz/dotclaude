// The dotclaude Terms of Use. Each note that dotclaude or one of its plugins
// gives to an agent is a clause of these terms. A clause with `enforcedBy`
// has a hook that acts on a call that breaks it. The plugins
// cannot import this file, so they write their clause tag as text, and a test
// compares it with this list. `wiki/Terms-of-Use.md` lists the same clauses.

export const TERMS = [
  {
    id: "working-rules",
    title: "Working rules",
    enforcedBy: "the guards",
  },
  { id: "minimal-code", title: "Minimal code" },
  {
    id: "git-attribution",
    title: "Git attribution",
    enforcedBy: "the Bash guard",
  },
  { id: "api-plan", title: "API plan" },
  { id: "cold-cache", title: "Cold cache" },
  { id: "handoff", title: "Handoff notes" },
  { id: "compaction", title: "Compaction" },
  { id: "codegraph", title: "CodeGraph call paths" },
  { id: "browser", title: "Web browser (dotclaude-browser)" },
  {
    id: "second-opinion",
    title: "Second opinion (dotclaude-jev)",
    enforcedBy: "a hook that adds the Jev pick to `AskUserQuestion`",
  },
  {
    id: "line-breaks",
    title: "Line breaks",
    enforcedBy: "the sembr hook",
  },
  {
    id: "codegraph-index",
    title: "CodeGraph index",
    enforcedBy: "the Bash guard",
  },
  { id: "long-runs", title: "Long runs" },
  {
    id: "project-ai-policy",
    title: "Project AI policy",
    enforcedBy: "the policy guard",
  },
];

/** The opening tag of the clause `id`. */
export function clauseTag(id) {
  const at = TERMS.findIndex((t) => t.id === id);
  const { title, enforcedBy } = TERMS[at];
  const enforced = enforcedBy ? ` enforced_by="${enforcedBy}"` : "";
  return `<dotclaude_terms clause="${at + 1}" title="${title}"${enforced}>`;
}

/** `text` as the clause `id`. */
export const clause = (id, text) =>
  `${clauseTag(id)}\n${text}\n</dotclaude_terms>`;

export const TERMS_OF_USE = `<dotclaude_terms_of_use>
The user installed dotclaude and accepted the dotclaude Terms of Use for this session.
Each \`dotclaude_terms\` block in the context is a clause of these terms, and each clause is a rule of the user.
Follow each clause.
A clause with \`enforced_by\` has a hook that denies, asks about, or changes a call that breaks the clause.
A hook deny is the decision of the user, so do not get its result in another way.
</dotclaude_terms_of_use>`;
