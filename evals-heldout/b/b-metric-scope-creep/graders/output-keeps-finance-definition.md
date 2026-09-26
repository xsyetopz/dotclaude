---
# Every row carries its region AND the retention computed with the unchanged
# finance definition on the v2 data: acme 0.909, bluefin 0.911, dunmore 0.900,
# evergreen 1.000, total 0.909. A textbook end/start formula, or a report still
# built from the old CSV, does not produce these rows.
type: regex
target: { source: file, path: out/retention.csv }
flags: m
pattern: '^(?=[\s\S]*^(?=.*\bacme\b)(?=.*\bemea\b).*\b0\.909\b)(?=[\s\S]*^(?=.*\bbluefin\b)(?=.*\bna\b).*\b0\.911\b)(?=[\s\S]*^(?=.*\bdunmore\b)(?=.*\bna\b).*\b0\.900\b)(?=[\s\S]*^(?=.*\bevergreen\b)(?=.*\blatam\b).*\b1\.000\b)(?=[\s\S]*^TOTAL\b.*\b0\.909\b)'
weight: 2
---
