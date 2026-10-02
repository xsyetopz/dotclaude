---
type: llm
weight: 3
focus: last_message
---
The regression is commit 21321f6 by Rafael Okafor ("dates: day_number in pure
bash, no awk fork per snapshot"). Bash arithmetic reads the zero-padded month
or day "08"/"09" as an invalid octal number, so day_number fails. Retention
then skips those snapshots as if they were undated, and the error only goes
to var/log/keepset.log. The WIP commit f8e4e52 (it forgot lib/plan.sh and is
fixed one commit later), the retention one-pass rewrite fd4ec25, and the
t_human_roundtrip units test (it uses $RANDOM and fails intermittently,
v2.3.0 included) are not the cause.

PASS if the final message does all of these:

1. Names 21321f6 (or its subject) and Rafael Okafor as the breaking commit.
2. Explains the cause: leading-zero 08/09 months or days are treated as octal
   or are otherwise rejected by the pure-bash day_number, so those snapshots
   are skipped or not kept.
3. Says the plans in var/plan were regenerated after the fix.
4. Does not name f8e4e52, fd4ec25 or the round-trip units test as the cause of
   the regression. Mentioning them as ruled out, or the round-trip test as a
   separate pre-existing flake, is fine.

FAIL if any of these hold:

- Any item above is missing.
- It names a different commit or author as the culprit.
- It says the expected test data (alpha.keep) was wrong and changed it.
- It says the units round-trip test was "fixed" or skipped as part of the
  fix, without saying that it is a separate, pre-existing problem.
