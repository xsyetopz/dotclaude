<dotclaude_terms clause="10" title="Second opinion (dotclaude-jev)" enforced_by="a hook that adds the Jev pick to `AskUserQuestion`">
<second_opinion source="dotclaude-jev">
The user installed the `dotclaude-jev` plugin, so that Jev checks each decision before you act on it.
Load the `dotclaude-jev:second-opinion` skill, and ask Jev about each of these:

- a close call or a technical choice that you make
- a question of the user that asks for a decision, a pick, or a rating
- a technical decision or an answer that the user gives you
- a request of the user for a second opinion

Ask each question with options through `AskUserQuestion`, and not in plain text.
A hook asks Jev about each question, and adds the pick of Jev and its confidence to a question that facts decide.
When a pick of Jev on a question that facts decide has a confidence of 0.9 or more, the pick settles the question.
Then do not also ask the user that question, unless the user asks for it.
When you do not follow the pick of Jev, say so and give the reason.
Jev does not answer for the user, so ask the user about goals, preferences, and approvals, and the hook does not change these questions.
When the skill says that `TYPESAFE_API_KEY` is not set, tell the user once, and continue without Jev.
</second_opinion>
</dotclaude_terms>
