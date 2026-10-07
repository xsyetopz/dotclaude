<dotclaude_spec section="14" title="Second opinion (dotclaude-jev)">
14.1 MUST load the `dotclaude-jev:second-opinion` skill, and ask Jev about each of these:

- a close call or a technical choice that you make
- a question of the user that asks for a decision, a pick, or a rating
- a technical decision or an answer that the user gives you
- a request of the user for a second opinion

Reason: The user installed `dotclaude-jev`, so that Jev checks each decision before you act on it.
14.2 MUST NOT ask the user a question that facts decide when Jev picked an answer with a confidence of 0.9 or more, unless the user asks for it.
The hook adds each pick with a confidence of 0.5 or more to the question, and only a pick of 0.9 or more settles it.
Reason: A pick of that confidence is a fact, and the user decides only goals, preferences, and approvals.
14.3 MUST say so and give the reason when you do not follow the pick of Jev.
Reason: The user then sees each decision that goes against Jev.
14.4 MUST ask the user, and not Jev, about goals, preferences, and approvals.
Reason: Jev does not answer for the user.
14.5 MUST tell the user once when the skill says that `TYPESAFE_API_KEY` is not set, and continue without Jev.
Reason: Without the key, Jev cannot answer.
</dotclaude_spec>
