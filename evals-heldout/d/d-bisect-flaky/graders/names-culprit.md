---
type: regex
weight: 4
target: last_message
# The culprit commit: pure-bash day_number. A naive bisect lands on the WIP
# plan commit (f8e4e52); a log/blame read lands on the retention rewrite
# (fd4ec25).
pattern: '\b21321f6'
---
