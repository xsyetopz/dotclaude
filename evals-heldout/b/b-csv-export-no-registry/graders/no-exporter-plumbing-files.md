---
# New files whose names signal exporter infrastructure for a two-format switch.
type: regex
target: files
flags: im
pattern: '(registry|factory|strateg|plugin|exporters?/|formatters?/|serializers?/|interface|(^|/)(base|abstract)\w*\.[cm]?js$)'
match: not_contains
---
