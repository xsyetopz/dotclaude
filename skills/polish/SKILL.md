---
name: polish
description: Lightly edits a doc, message, or README section that the user names, and keeps its meaning, voice, and structure. Use when the user asks to polish or tidy a deliverable.
argument-hint: "[file or section to polish]"
disable-model-invocation: true
---

<procedure>
1. Find the deliverable that the user names. Use `$ARGUMENTS`, or the user's last message when `$ARGUMENTS` is empty. If the name fits more than one file or section, ask which one, because an edit of the wrong file is hard to see.
2. Read all of it before you edit, so you know its voice, its terms, and how its parts relate.
3. Edit the file in place, with small edits to the lines that need them. Do not rewrite the file, because a rewrite hides what changed.
4. Read the result against the original. Check that no fact, number, name, link, or code item changed.
</procedure>

<keep>
Keep these as they are, because the user chose them:

- the meaning: no claim added, removed, or made stronger or weaker
- the voice and the register
- the order and the headings
- the terms, including product names, jargon, and code items
- each fact, number, quote, link, and command
</keep>

<change>
Change only what a careful reader sees as a slip or as needless friction: grammar, spelling, punctuation, word choice, sentence length, repeated words, and inconsistent formatting. When a sentence is unclear and a fix needs a guess about the meaning, leave it and name it in your reply.
</change>

<output_format>
After the edit, give the path and one short list of the kinds of change you made, for example: grammar, word choice, sentence length. Do not list each change. Add the unclear sentences that you left, if any.
</output_format>

<task>
Polish the deliverable that the user names with a light edit that keeps its meaning, voice, structure, terms, and facts.
</task>
