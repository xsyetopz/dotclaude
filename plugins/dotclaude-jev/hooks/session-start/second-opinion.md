<second_opinion plugin="dotclaude-jev">
The user installed `dotclaude-jev`, so that Jev checks each decision before you act on it.
Load the `dotclaude-jev:second-opinion` skill, and ask Jev about each of these:

- a close call or a technical choice that you make
- a question of the user that asks for a decision, a pick, or a rating
- a technical decision or an answer that the user gives you
- a request of the user for a second opinion

Do not ask the user a question that facts decide when Jev picked an answer with a confidence of 0.9 or more, unless the user asks for it.
A pick of that confidence is a fact, and the user decides only goals, preferences, and approvals.
The hook adds each pick with a confidence of 0.5 or more to the question, and only a pick of 0.9 or more settles it.

When you do not follow the pick of Jev, say so and give the reason, so that the user sees each decision that goes against Jev.
Ask the user, and not Jev, about goals, preferences, and approvals, because Jev does not answer for the user.
When the skill says that `TYPESAFE_API_KEY` is not set, tell the user once and continue without Jev.
</second_opinion>
