---
type: regex
weight: 5
target: { source: file, path: var/plan/db-01.plan }
# Summary line of the db-01 plan with base-10 dates (kept set checked against
# an independent implementation). The stale plan from the buggy main says
# "keep 19, delete 419, frees 17.2T, cksum 1392039981". Fixing only the month
# keeps 7 April instead of 9 April (April's newest; db-01 was down from 10
# April), giving the same counts but cksum 3970360194.
pattern: '# keep 20, delete 418, frees 17\.1T, cksum 1241224179\n?$'
---
