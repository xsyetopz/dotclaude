#!/usr/bin/env bash
# keepset: bash/awk GFS retention for backup snapshot manifests; v2.3.0 tagged and deployed.
# Since the tag: the pure-bash day_number commit treats 08/09 as invalid octal, the
# arithmetic error goes to var/log (stderr is not a tty) and Aug/Sep or 8th/9th snapshots
# are skipped as undated. Decoys: a WIP commit at the first bisect midpoint that forgot
# lib/plan.sh (every CLI test red), a later retention rewrite (innocent), and a $RANDOM
# round-trip test that fails ~1 run in 3 since before v2.3.0. var/plan holds stale plans
# generated with the bug.
set -euo pipefail

export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io"
export GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

# --- import keepset 2.2.0 from ops-scripts
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
cat > .gitignore <<'__FX__'
var/
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.2.0
- `report` shows human-readable sizes.

## 2.0.0
- Rewrite in bash: manifests in, GFS keep list out.
__FX__
cat > README.md <<'__FX__'
# keepset

Grandfather-father-son retention for snapshot manifests. The backup hosts
export a manifest of their snapshots every night; keepset decides which ones
the policy keeps.

```
bin/keepset keep   var/manifests/db-01.manifest     # ids the policy keeps
bin/keepset report var/manifests/*.manifest         # counts and sizes
test/run.sh                                          # tests (bash, awk)
```

The policy is `etc/policy.conf`.

__FX__
cat > VERSION <<'__FX__'
2.2.0
__FX__
mkdir -p bin
cat > bin/keepset <<'__FX__'
#!/usr/bin/env bash
# keepset: grandfather-father-son retention for snapshot manifests.
set -euo pipefail
KEEPSET_HOME=$(cd "$(dirname "$0")/.." && pwd)

# Under cron nobody reads stderr, so when it isn't a terminal, warnings and
# errors go to the log instead.
KEEPSET_LOG=${KEEPSET_LOG:-$KEEPSET_HOME/var/log/keepset.log}
if [ ! -t 2 ]; then
  mkdir -p "$(dirname "$KEEPSET_LOG")"
  exec 2>>"$KEEPSET_LOG"
fi

for lib in common units dates manifest retention report; do
  . "$KEEPSET_HOME/lib/$lib.sh"
done

usage() {
  cat <<'USAGE'
usage: keepset keep   [--policy FILE] MANIFEST
       keepset report [--policy FILE] MANIFEST...

  keep    print the snapshot ids the policy keeps, newest first
  report  snapshot counts and sizes, kept and prunable

The policy defaults to etc/policy.conf.
USAGE
}

policy=$KEEPSET_HOME/etc/policy.conf
cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  -h|--help|'') usage; exit 0 ;;
  keep|report) ;;
  *) usage >&2; die "unknown command: $cmd" ;;
esac
args=()
while [ $# -gt 0 ]; do
  case $1 in
    --policy) policy=${2:?--policy needs a file}; shift 2 ;;
    -*) die "unknown option: $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -gt 0 ] || die "$cmd: no manifest given"
load_policy "$policy"

case $cmd in
  keep)
    [ ${#args[@]} -eq 1 ] || die "keep takes one manifest"
    manifest_entries "${args[0]}" | retention_keep
    ;;
  report)
    for m in "${args[@]}"; do report_host "$m"; done
    ;;
esac
__FX__
chmod +x bin/keepset
mkdir -p etc
cat > etc/policy.conf <<'__FX__'
# Retention policy for the nightly prune. Each rule keeps the newest snapshot
# of that many of the newest days / weeks (Monday to Sunday) / months.
daily=7
weekly=5
monthly=6
__FX__
mkdir -p lib
cat > lib/common.sh <<'__FX__'
# shellcheck shell=bash
die() { echo "keepset: $*" >&2; exit 1; }
warn() { echo "keepset: warning: $*" >&2; }

# load_policy FILE: sets KEEP_DAILY, KEEP_WEEKLY and KEEP_MONTHLY from
# "key=value" lines.
load_policy() {
  local f=$1 k v
  [ -r "$f" ] || die "policy file not found: $f"
  KEEP_DAILY=0 KEEP_WEEKLY=0 KEEP_MONTHLY=0
  while IFS='=' read -r k v; do
    case $k in
      '' | '#'*) continue ;;
      daily) KEEP_DAILY=$v ;;
      weekly) KEEP_WEEKLY=$v ;;
      monthly) KEEP_MONTHLY=$v ;;
      *) die "$f: unknown key '$k'" ;;
    esac
  done <"$f"
}

# host_of MANIFEST: the host a manifest belongs to (its file name).
host_of() {
  local b=${1##*/}
  echo "${b%.manifest}"
}
__FX__
mkdir -p lib
cat > lib/dates.sh <<'__FX__'
# shellcheck shell=bash
# Snapshot ids are timestamps: YYYYMMDDTHHMM (UTC), e.g. 20250314T0215.

# day_number ID: days since 1970-01-01 for a snapshot id.
day_number() {
  awk -v id="$1" 'BEGIN {
    y = substr(id, 1, 4) + 0; m = substr(id, 5, 2) + 0; d = substr(id, 7, 2) + 0
    a = int((14 - m) / 12); y += 4800 - a; m += 12 * a - 3
    print d + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - int(y / 100) + int(y / 400) - 2472633
  }'
}

# week_number DAY: weeks since the Monday before the epoch, so weeks run
# Monday to Sunday.
week_number() {
  echo $((($1 + 3) / 7))
}
__FX__
mkdir -p lib
cat > lib/manifest.sh <<'__FX__'
# shellcheck shell=bash
# A manifest lists one snapshot per line: "<id> <bytes> <path>". Blank lines
# and lines starting with # are ignored.

# manifest_entries FILE: "id bytes" lines, newest id first.
manifest_entries() {
  [ -r "$1" ] || die "manifest not found: $1"
  awk '/^[ \t]*(#|$)/ { next } { print $1, $2 }' "$1" | LC_ALL=C sort -r
}
__FX__
mkdir -p lib
cat > lib/report.sh <<'__FX__'
# shellcheck shell=bash
# report_host MANIFEST: snapshot counts and sizes for one host.
report_host() {
  local manifest=$1 host kept
  host=$(host_of "$manifest")
  kept=" $(manifest_entries "$manifest" | retention_keep | tr '\n' ' ')"
  manifest_entries "$manifest" | awk -v host="$host" -v kept="$kept" '
    function human(n,   u, i) {
      split("B K M G T P", u, " "); i = 1
      while (n >= 1024 && i < 6) { n /= 1024; i++ }
      return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
    }
    {
      total++; bytes += $2
      if (index(kept, " " $1 " ")) { k++; kb += $2 } else { d++; db += $2 }
      if (oldest == "" || $1 < oldest) oldest = $1; if ($1 > newest) newest = $1
    }
    END {
      printf "%-10s %5d snapshots %8s   oldest %s   newest %s\n", host, total, human(bytes), oldest, newest
      printf "%-10s %5d kept      %8s\n", "", k, human(kb)
      printf "%-10s %5d prunable  %8s\n", "", d, human(db)
    }'
}
__FX__
mkdir -p lib
cat > lib/retention.sh <<'__FX__'
# shellcheck shell=bash
# Grandfather-father-son retention. A snapshot is kept if it is the newest
# snapshot of one of the KEEP_DAILY newest days, the KEEP_WEEKLY newest weeks
# or the KEEP_MONTHLY newest months that have snapshots.

# retention_pass FIELD N: reads "id day week month" lines, newest first; prints
# the first id of each of the N newest distinct values of FIELD.
retention_pass() {
  awk -v f="$1" -v n="$2" 'NF && !seen[$f]++ && ++c <= n { print $1 }'
}

# retention_keep: reads "id bytes" lines, newest first; prints kept ids,
# newest first.
retention_keep() {
  local id bytes dn rows=
  while read -r id bytes; do
    dn=$(day_number "$id")
    rows="$rows$id $dn $(week_number "$dn") ${id:0:6}"$'\n'
  done
  {
    retention_pass 2 "$KEEP_DAILY" <<<"$rows"
    retention_pass 3 "$KEEP_WEEKLY" <<<"$rows"
    retention_pass 4 "$KEEP_MONTHLY" <<<"$rows"
  } | LC_ALL=C sort -u -r
}
__FX__
mkdir -p lib
cat > lib/units.sh <<'__FX__'
# shellcheck shell=bash
# Manifests store sizes in bytes; people read binary units (K, M, G, T are
# powers of 1024).

human() {
  awk -v n="$1" 'BEGIN {
    split("B K M G T P", u, " "); i = 1
    while (n >= 1024 && i < 6) { n /= 1024; i++ }
    if (i == 1) printf "%dB\n", n; else printf "%.1f%s\n", n, u[i]
  }'
}

# parse_size 41.2G -> bytes. No suffix means bytes.
parse_size() {
  awk -v s="$1" 'BEGIN {
    n = s + 0; u = substr(s, length(s), 1); m = 1
    if (u == "K") m = 1024; else if (u == "M") m = 1024 ^ 2; else if (u == "G") m = 1024 ^ 3
    else if (u == "T") m = 1024 ^ 4; else if (u == "P") m = 1024 ^ 5
    printf "%.0f\n", n * m
  }'
}
__FX__
mkdir -p test
cat > test/cli.t.sh <<'__FX__'
t_unknown_command_fails() {
  "$KEEPSET" frobnicate 2>/dev/null && fail "unknown command accepted"
  grep -q 'unknown command' "$KEEPSET_LOG" || fail "nothing logged"
}

t_report_alpha() {
  "$KEEPSET" report --policy test/data/policy.conf test/data/alpha.manifest >"$T/out"
  grep -Eq '^alpha +81 snapshots' "$T/out" || fail "$(cat "$T/out")"
}

t_missing_manifest() {
  "$KEEPSET" keep "$T/nope.manifest" && fail "missing manifest accepted"
  grep -q 'manifest not found' "$KEEPSET_LOG" || fail "nothing logged"
}
__FX__
mkdir -p test/data
cat > test/data/alpha.keep <<'__FX__'
20250320T0215
20250319T1130
20250318T0215
20250317T0215
20250316T0215
20250315T0215
20250314T1400
20250309T0215
20250302T0215
20250228T0215
20250131T0215
__FX__
mkdir -p test/data
cat > test/data/alpha.manifest <<'__FX__'
# alpha: test host, nightly at 02:15 plus a few manual runs
20250102T0215 53158485444 /srv/snap/alpha/20250102T0215
20250103T0215 58860023069 /srv/snap/alpha/20250103T0215
20250104T0215 52914488363 /srv/snap/alpha/20250104T0215
20250105T0215 52039193678 /srv/snap/alpha/20250105T0215
20250106T0215 49872795630 /srv/snap/alpha/20250106T0215
20250107T0215 54724178272 /srv/snap/alpha/20250107T0215
20250108T0215 53585844445 /srv/snap/alpha/20250108T0215
20250109T0215 53308376241 /srv/snap/alpha/20250109T0215
20250110T0215 50641734529 /srv/snap/alpha/20250110T0215
20250111T0215 47288578916 /srv/snap/alpha/20250111T0215
20250112T0215 50545838195 /srv/snap/alpha/20250112T0215
20250113T0215 49380235481 /srv/snap/alpha/20250113T0215
20250114T0215 50062832075 /srv/snap/alpha/20250114T0215
20250115T0215 47831994700 /srv/snap/alpha/20250115T0215
20250116T0215 52485800344 /srv/snap/alpha/20250116T0215
20250117T0215 47156544256 /srv/snap/alpha/20250117T0215
20250118T0215 49045356660 /srv/snap/alpha/20250118T0215
20250119T0215 54943419981 /srv/snap/alpha/20250119T0215
20250120T0215 56274282980 /srv/snap/alpha/20250120T0215
20250121T0215 49635713148 /srv/snap/alpha/20250121T0215
20250122T0215 51194199520 /srv/snap/alpha/20250122T0215
20250123T0215 50077437806 /srv/snap/alpha/20250123T0215
20250124T0215 47403283048 /srv/snap/alpha/20250124T0215
20250125T0215 58960697967 /srv/snap/alpha/20250125T0215
20250126T0215 53019872475 /srv/snap/alpha/20250126T0215
20250127T0215 56554748344 /srv/snap/alpha/20250127T0215
20250128T0215 56007585335 /srv/snap/alpha/20250128T0215
20250129T0215 52365840721 /srv/snap/alpha/20250129T0215
20250130T0215 58809232521 /srv/snap/alpha/20250130T0215
20250131T0215 56536399651 /srv/snap/alpha/20250131T0215
20250201T0215 51620858955 /srv/snap/alpha/20250201T0215
20250202T0215 55060321617 /srv/snap/alpha/20250202T0215
20250203T0215 49902181435 /srv/snap/alpha/20250203T0215
20250204T0215 57671737868 /srv/snap/alpha/20250204T0215
20250205T0215 55333585429 /srv/snap/alpha/20250205T0215
20250206T0215 50422861266 /srv/snap/alpha/20250206T0215
20250207T0215 55501339602 /srv/snap/alpha/20250207T0215
20250207T1800 51855446386 /srv/snap/alpha/20250207T1800
20250208T0215 53048398185 /srv/snap/alpha/20250208T0215
20250209T0215 48531055140 /srv/snap/alpha/20250209T0215
20250210T0215 57272255498 /srv/snap/alpha/20250210T0215
20250211T0215 58566679525 /srv/snap/alpha/20250211T0215
20250212T0215 54081155348 /srv/snap/alpha/20250212T0215
20250213T0215 57337242651 /srv/snap/alpha/20250213T0215
20250214T0215 54427028227 /srv/snap/alpha/20250214T0215
20250215T0215 56177034903 /srv/snap/alpha/20250215T0215
20250216T0215 53686063337 /srv/snap/alpha/20250216T0215
20250217T0215 48574947882 /srv/snap/alpha/20250217T0215
20250218T0215 56334945637 /srv/snap/alpha/20250218T0215
20250219T0215 55462221551 /srv/snap/alpha/20250219T0215
20250220T0215 57831527638 /srv/snap/alpha/20250220T0215
20250221T0215 50452346253 /srv/snap/alpha/20250221T0215
20250222T0215 47440178800 /srv/snap/alpha/20250222T0215
20250223T0215 58716709930 /srv/snap/alpha/20250223T0215
20250224T0215 55472051430 /srv/snap/alpha/20250224T0215
20250225T0215 57951629448 /srv/snap/alpha/20250225T0215
20250226T0215 47189500618 /srv/snap/alpha/20250226T0215
20250227T0215 58678981929 /srv/snap/alpha/20250227T0215
20250228T0215 54831694412 /srv/snap/alpha/20250228T0215
20250301T0215 56878788757 /srv/snap/alpha/20250301T0215
20250302T0215 53641955185 /srv/snap/alpha/20250302T0215
20250303T0215 57984322357 /srv/snap/alpha/20250303T0215
20250304T0215 51940039444 /srv/snap/alpha/20250304T0215
20250305T0215 59121990967 /srv/snap/alpha/20250305T0215
20250306T0215 58412714767 /srv/snap/alpha/20250306T0215
20250307T0215 56524460602 /srv/snap/alpha/20250307T0215
20250308T0215 57295576859 /srv/snap/alpha/20250308T0215
20250309T0215 59246662903 /srv/snap/alpha/20250309T0215
20250310T0215 52451174545 /srv/snap/alpha/20250310T0215
20250311T0215 57681420135 /srv/snap/alpha/20250311T0215
20250312T0215 54572134781 /srv/snap/alpha/20250312T0215
20250313T0215 58700070190 /srv/snap/alpha/20250313T0215
20250314T0215 50509287643 /srv/snap/alpha/20250314T0215
20250314T1400 51554788499 /srv/snap/alpha/20250314T1400
20250315T0215 57418091583 /srv/snap/alpha/20250315T0215
20250316T0215 58724791336 /srv/snap/alpha/20250316T0215
20250317T0215 49585728455 /srv/snap/alpha/20250317T0215
20250318T0215 49870257574 /srv/snap/alpha/20250318T0215
20250319T0215 57138738143 /srv/snap/alpha/20250319T0215
20250319T1130 58556451368 /srv/snap/alpha/20250319T1130
20250320T0215 47153593588 /srv/snap/alpha/20250320T0215
__FX__
mkdir -p test/data
cat > test/data/policy.conf <<'__FX__'
daily=7
weekly=4
monthly=3
__FX__
mkdir -p test
cat > test/dates.t.sh <<'__FX__'
t_day_number_epoch() {
  assert_eq 0 "$(day_number 19700101T0000)" "epoch"
  assert_eq 1 "$(day_number 19700102T2359)" "next day"
}

t_day_number_known_dates() {
  assert_eq 20089 "$(day_number 20250101T0215)" "2025-01-01"
}

t_week_number_mondays() {
  # 2025-01-05 is a Sunday, 2025-01-06 a Monday
  local sun mon
  sun=$(week_number "$(day_number 20250105T1200)")
  mon=$(week_number "$(day_number 20250106T0000)")
  assert_eq "$((sun + 1))" "$mon" "week starts on Monday"
  assert_eq "$sun" "$(week_number "$(day_number 20241230T0000)")" "Monday 2024-12-30 starts that week"
}
__FX__
mkdir -p test
cat > test/lib.sh <<'__FX__'
# shellcheck shell=bash
# Helpers for test/*.t.sh. A test is a function named t_*; it fails by
# calling fail. $T is a fresh temp dir per test, $KEEPSET the CLI.
KEEPSET=$PWD/bin/keepset
for lib in lib/*.sh; do . "$lib"; done
fail() { FAILED="${FAILED}$*"$'\n'; }
assert_eq() {  # assert_eq EXPECTED ACTUAL [WHAT]
  [ "$1" = "$2" ] || fail "${3:-value}: expected '$1', got '$2'"
}
assert_file_eq() {  # assert_file_eq EXPECTED_FILE ACTUAL_FILE
  local d
  d=$(diff -u "$1" "$2") || fail "$(printf '%s\n' "$d" | head -40)"
}
__FX__
mkdir -p test
cat > test/manifest.t.sh <<'__FX__'
t_entries_newest_first() {
  printf '# host x\n20250102T0215 10 /a\n\n20250103T0215 20 /b\n20250101T0215 30 /c\n' >"$T/x.manifest"
  assert_eq "20250103T0215 20|20250102T0215 10|20250101T0215 30" "$(manifest_entries "$T/x.manifest" | paste -sd '|' -)" "entries"
}
__FX__
mkdir -p test
cat > test/retention.t.sh <<'__FX__'
# Expected keep lists were checked by hand against docs/retention.md.

t_keep_alpha() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest >"$T/keep"
  assert_file_eq test/data/alpha.keep "$T/keep"
}
__FX__
mkdir -p test
cat > test/run.sh <<'__FX__'
#!/usr/bin/env bash
# Runs every test/*.t.sh (or the files given). Prints one ok / not ok line
# per test and exits non-zero if any failed.
set -uo pipefail
cd "$(dirname "$0")/.."
. test/lib.sh

run_file() {
  . "$1"
  local t
  for t in $(declare -F | awk '$3 ~ /^t_/ { print $3 }'); do
    FAILED=
    T=$(mktemp -d "${TMPDIR:-/tmp}/keepset-test.XXXXXX")
    export KEEPSET_LOG=$T/keepset.log
    "$t"
    rm -rf "$T"
    if [ -n "$FAILED" ]; then
      echo "not ok - ${1#test/} $t"
      printf '%s' "$FAILED" | sed 's/^/    # /'
    else
      echo "ok - ${1#test/} $t"
    fi
  done
}

files=("$@")
[ ${#files[@]} -gt 0 ] || files=(test/*.t.sh)
for f in "${files[@]}"; do
  (run_file "$f")
done | awk '{ print } /^not ok/ { bad = 1 } END { exit bad }'
__FX__
chmod +x test/run.sh
mkdir -p test
cat > test/units.t.sh <<'__FX__'
t_human_units() {
  assert_eq 512B "$(human 512)" "human 512"
  assert_eq 1.0K "$(human 1024)" "human 1024"
  assert_eq 1.5M "$(human 1572864)" "human 1.5M"
  assert_eq 41.2G "$(human 44238163968)" "human 41.2G"
  assert_eq 2.0T "$(human 2199023255552)" "human 2T"
}

t_parse_size() {
  assert_eq 512 "$(parse_size 512)" "plain bytes"
  assert_eq 1536 "$(parse_size 1.5K)" "1.5K"
  assert_eq 44238163149 "$(parse_size 41.2G)" "41.2G"
}
__FX__
git add -A
commit "2025-11-03T09:40:00Z" "import keepset 2.2.0 from ops-scripts"

# --- units: round-trip test for human and parse_size
export GIT_AUTHOR_NAME="Rafael Okafor" GIT_AUTHOR_EMAIL="rafael.okafor@kelpwater.io" GIT_COMMITTER_NAME="Rafael Okafor" GIT_COMMITTER_EMAIL="rafael.okafor@kelpwater.io"
mkdir -p test
cat > test/lib.sh <<'__FX__'
# shellcheck shell=bash
# Helpers for test/*.t.sh. A test is a function named t_*; it fails by
# calling fail. $T is a fresh temp dir per test, $KEEPSET the CLI.
KEEPSET=$PWD/bin/keepset
for lib in lib/*.sh; do . "$lib"; done
fail() { FAILED="${FAILED}$*"$'\n'; }
assert_eq() {  # assert_eq EXPECTED ACTUAL [WHAT]
  [ "$1" = "$2" ] || fail "${3:-value}: expected '$1', got '$2'"
}
assert_file_eq() {  # assert_file_eq EXPECTED_FILE ACTUAL_FILE
  local d
  d=$(diff -u "$1" "$2") || fail "$(printf '%s\n' "$d" | head -40)"
}
within_pct() {  # within_pct A B PCT: |A - B| <= PCT% of B
  awk -v a="$1" -v b="$2" -v p="$3" 'BEGIN { d = a - b; if (d < 0) d = -d; exit !(d <= b * p / 100) }'
}
__FX__
mkdir -p test
cat > test/units.t.sh <<'__FX__'
t_human_units() {
  assert_eq 512B "$(human 512)" "human 512"
  assert_eq 1.0K "$(human 1024)" "human 1024"
  assert_eq 1.5M "$(human 1572864)" "human 1.5M"
  assert_eq 41.2G "$(human 44238163968)" "human 41.2G"
  assert_eq 2.0T "$(human 2199023255552)" "human 2T"
}

t_parse_size() {
  assert_eq 512 "$(parse_size 512)" "plain bytes"
  assert_eq 1536 "$(parse_size 1.5K)" "1.5K"
  assert_eq 44238163149 "$(parse_size 41.2G)" "41.2G"
}

t_human_roundtrip() {
  # whatever human() prints must parse back to within 1% of the input
  local i n back
  for ((i = 0; i < 50; i++)); do
    n=$((RANDOM * RANDOM + RANDOM))
    back=$(parse_size "$(human "$n")")
    if ! within_pct "$back" "$n" 1; then
      fail "human($n) = $(human "$n"), which parses back as $back"
      return
    fi
  done
}
__FX__
git add -A
commit "2026-03-16T15:05:00Z" "units: round-trip test for human and parse_size"

# --- 2.3.0: manual-* snapshots are outside the policy
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.3.0
- Snapshot ids that aren't timestamps (manual-* snapshots) are outside the
  policy; they no longer claim a daily slot.

## 2.2.0
- `report` shows human-readable sizes.

## 2.0.0
- Rewrite in bash: manifests in, GFS keep list out.
__FX__
cat > VERSION <<'__FX__'
2.3.0
__FX__
mkdir -p lib
cat > lib/dates.sh <<'__FX__'
# shellcheck shell=bash
# Snapshot ids are timestamps: YYYYMMDDTHHMM (UTC), e.g. 20250314T0215.

# day_number ID: days since 1970-01-01 for a snapshot id; fails for ids that
# aren't timestamps.
day_number() {
  case $1 in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T*) ;;
    *) return 1 ;;
  esac
  awk -v id="$1" 'BEGIN {
    y = substr(id, 1, 4) + 0; m = substr(id, 5, 2) + 0; d = substr(id, 7, 2) + 0
    a = int((14 - m) / 12); y += 4800 - a; m += 12 * a - 3
    print d + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - int(y / 100) + int(y / 400) - 2472633
  }'
}

# week_number DAY: weeks since the Monday before the epoch, so weeks run
# Monday to Sunday.
week_number() {
  echo $((($1 + 3) / 7))
}
__FX__
mkdir -p lib
cat > lib/retention.sh <<'__FX__'
# shellcheck shell=bash
# Grandfather-father-son retention. A snapshot is kept if it is the newest
# snapshot of one of the KEEP_DAILY newest days, the KEEP_WEEKLY newest weeks
# or the KEEP_MONTHLY newest months that have snapshots. Ids that aren't
# timestamps (manual-*, imports) are outside the policy and never kept.

# retention_pass FIELD N: reads "id day week month" lines, newest first; prints
# the first id of each of the N newest distinct values of FIELD.
retention_pass() {
  awk -v f="$1" -v n="$2" 'NF && !seen[$f]++ && ++c <= n { print $1 }'
}

# retention_keep: reads "id bytes" lines, newest first; prints kept ids,
# newest first.
retention_keep() {
  local id bytes dn rows=
  while read -r id bytes; do
    dn=$(day_number "$id") || continue
    rows="$rows$id $dn $(week_number "$dn") ${id:0:6}"$'\n'
  done
  {
    retention_pass 2 "$KEEP_DAILY" <<<"$rows"
    retention_pass 3 "$KEEP_WEEKLY" <<<"$rows"
    retention_pass 4 "$KEEP_MONTHLY" <<<"$rows"
  } | LC_ALL=C sort -u -r
}
__FX__
mkdir -p test
cat > test/cli.t.sh <<'__FX__'
t_unknown_command_fails() {
  "$KEEPSET" frobnicate 2>/dev/null && fail "unknown command accepted"
  grep -q 'unknown command' "$KEEPSET_LOG" || fail "nothing logged"
}

t_report_alpha() {
  "$KEEPSET" report --policy test/data/policy.conf test/data/alpha.manifest >"$T/out"
  grep -Eq '^alpha +82 snapshots' "$T/out" || fail "$(cat "$T/out")"
}

t_missing_manifest() {
  "$KEEPSET" keep "$T/nope.manifest" && fail "missing manifest accepted"
  grep -q 'manifest not found' "$KEEPSET_LOG" || fail "nothing logged"
}
__FX__
mkdir -p test/data
cat > test/data/alpha.manifest <<'__FX__'
# alpha: test host, nightly at 02:15 plus a few manual runs
20250102T0215 53158485444 /srv/snap/alpha/20250102T0215
20250103T0215 58860023069 /srv/snap/alpha/20250103T0215
20250104T0215 52914488363 /srv/snap/alpha/20250104T0215
20250105T0215 52039193678 /srv/snap/alpha/20250105T0215
20250106T0215 49872795630 /srv/snap/alpha/20250106T0215
20250107T0215 54724178272 /srv/snap/alpha/20250107T0215
20250108T0215 53585844445 /srv/snap/alpha/20250108T0215
20250109T0215 53308376241 /srv/snap/alpha/20250109T0215
20250110T0215 50641734529 /srv/snap/alpha/20250110T0215
20250111T0215 47288578916 /srv/snap/alpha/20250111T0215
20250112T0215 50545838195 /srv/snap/alpha/20250112T0215
20250113T0215 49380235481 /srv/snap/alpha/20250113T0215
20250114T0215 50062832075 /srv/snap/alpha/20250114T0215
20250115T0215 47831994700 /srv/snap/alpha/20250115T0215
20250116T0215 52485800344 /srv/snap/alpha/20250116T0215
20250117T0215 47156544256 /srv/snap/alpha/20250117T0215
20250118T0215 49045356660 /srv/snap/alpha/20250118T0215
20250119T0215 54943419981 /srv/snap/alpha/20250119T0215
20250120T0215 56274282980 /srv/snap/alpha/20250120T0215
20250121T0215 49635713148 /srv/snap/alpha/20250121T0215
20250122T0215 51194199520 /srv/snap/alpha/20250122T0215
20250123T0215 50077437806 /srv/snap/alpha/20250123T0215
20250124T0215 47403283048 /srv/snap/alpha/20250124T0215
20250125T0215 58960697967 /srv/snap/alpha/20250125T0215
20250126T0215 53019872475 /srv/snap/alpha/20250126T0215
20250127T0215 56554748344 /srv/snap/alpha/20250127T0215
20250128T0215 56007585335 /srv/snap/alpha/20250128T0215
20250129T0215 52365840721 /srv/snap/alpha/20250129T0215
20250130T0215 58809232521 /srv/snap/alpha/20250130T0215
20250131T0215 56536399651 /srv/snap/alpha/20250131T0215
20250201T0215 51620858955 /srv/snap/alpha/20250201T0215
20250202T0215 55060321617 /srv/snap/alpha/20250202T0215
20250203T0215 49902181435 /srv/snap/alpha/20250203T0215
20250204T0215 57671737868 /srv/snap/alpha/20250204T0215
20250205T0215 55333585429 /srv/snap/alpha/20250205T0215
20250206T0215 50422861266 /srv/snap/alpha/20250206T0215
20250207T0215 55501339602 /srv/snap/alpha/20250207T0215
20250207T1800 51855446386 /srv/snap/alpha/20250207T1800
20250208T0215 53048398185 /srv/snap/alpha/20250208T0215
20250209T0215 48531055140 /srv/snap/alpha/20250209T0215
20250210T0215 57272255498 /srv/snap/alpha/20250210T0215
20250211T0215 58566679525 /srv/snap/alpha/20250211T0215
20250212T0215 54081155348 /srv/snap/alpha/20250212T0215
20250213T0215 57337242651 /srv/snap/alpha/20250213T0215
20250214T0215 54427028227 /srv/snap/alpha/20250214T0215
20250215T0215 56177034903 /srv/snap/alpha/20250215T0215
20250216T0215 53686063337 /srv/snap/alpha/20250216T0215
20250217T0215 48574947882 /srv/snap/alpha/20250217T0215
20250218T0215 56334945637 /srv/snap/alpha/20250218T0215
20250219T0215 55462221551 /srv/snap/alpha/20250219T0215
20250220T0215 57831527638 /srv/snap/alpha/20250220T0215
20250221T0215 50452346253 /srv/snap/alpha/20250221T0215
20250222T0215 47440178800 /srv/snap/alpha/20250222T0215
20250223T0215 58716709930 /srv/snap/alpha/20250223T0215
20250224T0215 55472051430 /srv/snap/alpha/20250224T0215
20250225T0215 57951629448 /srv/snap/alpha/20250225T0215
20250226T0215 47189500618 /srv/snap/alpha/20250226T0215
20250227T0215 58678981929 /srv/snap/alpha/20250227T0215
20250228T0215 54831694412 /srv/snap/alpha/20250228T0215
20250301T0215 56878788757 /srv/snap/alpha/20250301T0215
20250302T0215 53641955185 /srv/snap/alpha/20250302T0215
20250303T0215 57984322357 /srv/snap/alpha/20250303T0215
20250304T0215 51940039444 /srv/snap/alpha/20250304T0215
20250305T0215 59121990967 /srv/snap/alpha/20250305T0215
20250306T0215 58412714767 /srv/snap/alpha/20250306T0215
20250307T0215 56524460602 /srv/snap/alpha/20250307T0215
20250308T0215 57295576859 /srv/snap/alpha/20250308T0215
20250309T0215 59246662903 /srv/snap/alpha/20250309T0215
20250310T0215 52451174545 /srv/snap/alpha/20250310T0215
20250311T0215 57681420135 /srv/snap/alpha/20250311T0215
20250312T0215 54572134781 /srv/snap/alpha/20250312T0215
20250313T0215 58700070190 /srv/snap/alpha/20250313T0215
20250314T0215 50509287643 /srv/snap/alpha/20250314T0215
20250314T1400 51554788499 /srv/snap/alpha/20250314T1400
20250315T0215 57418091583 /srv/snap/alpha/20250315T0215
20250316T0215 58724791336 /srv/snap/alpha/20250316T0215
20250317T0215 49585728455 /srv/snap/alpha/20250317T0215
20250318T0215 49870257574 /srv/snap/alpha/20250318T0215
20250319T0215 57138738143 /srv/snap/alpha/20250319T0215
20250319T1130 58556451368 /srv/snap/alpha/20250319T1130
20250320T0215 47153593588 /srv/snap/alpha/20250320T0215
manual-pre-migration 61203464192 /srv/snap/alpha/manual-pre-migration
__FX__
mkdir -p test
cat > test/dates.t.sh <<'__FX__'
t_day_number_epoch() {
  assert_eq 0 "$(day_number 19700101T0000)" "epoch"
  assert_eq 1 "$(day_number 19700102T2359)" "next day"
}

t_day_number_known_dates() {
  assert_eq 20089 "$(day_number 20250101T0215)" "2025-01-01"
}

t_day_number_rejects_undated() {
  if day_number manual-pre-upgrade >/dev/null 2>&1; then fail "manual id accepted"; fi
  if day_number 2025-01-01 >/dev/null 2>&1; then fail "dashed date accepted"; fi
}

t_week_number_mondays() {
  # 2025-01-05 is a Sunday, 2025-01-06 a Monday
  local sun mon
  sun=$(week_number "$(day_number 20250105T1200)")
  mon=$(week_number "$(day_number 20250106T0000)")
  assert_eq "$((sun + 1))" "$mon" "week starts on Monday"
  assert_eq "$sun" "$(week_number "$(day_number 20241230T0000)")" "Monday 2024-12-30 starts that week"
}
__FX__
mkdir -p test
cat > test/retention.t.sh <<'__FX__'
# Expected keep lists were checked by hand against docs/retention.md.

t_keep_alpha() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest >"$T/keep"
  assert_file_eq test/data/alpha.keep "$T/keep"
}

t_undated_never_kept() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest | grep -q manual && fail "manual snapshot kept"
  return 0
}
__FX__
git add -A
commit "2026-08-27T11:30:00Z" "2.3.0: manual-* snapshots are outside the policy"

# --- start 2.4.0-dev
git tag v2.3.0
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
cat > VERSION <<'__FX__'
2.4.0-dev
__FX__
git add -A
commit "2026-08-31T08:50:00Z" "start 2.4.0-dev"

# --- docs: retention rules with a worked example
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
cat > README.md <<'__FX__'
# keepset

Grandfather-father-son retention for snapshot manifests. The backup hosts
export a manifest of their snapshots every night; keepset decides which ones
the policy keeps.

```
bin/keepset keep   var/manifests/db-01.manifest     # ids the policy keeps
bin/keepset report var/manifests/*.manifest         # counts and sizes
test/run.sh                                          # tests (bash, awk)
```

The policy is `etc/policy.conf`; how it is applied is in `docs/retention.md`.

__FX__
mkdir -p docs
cat > docs/retention.md <<'__FX__'
# Retention

The policy has three rules, each a count:

- `daily=N`: keep the newest snapshot of each of the N newest days that have
  snapshots;
- `weekly=N`: the same for weeks, which run Monday to Sunday (UTC);
- `monthly=N`: the same for calendar months.

A snapshot is kept if any rule keeps it. Everything else is prunable.
Days, weeks and months without snapshots don't count, so a host that was
down for a week still keeps N daily snapshots.

Snapshot ids are UTC timestamps, `YYYYMMDDTHHMM`. Ids that aren't (manual
snapshots such as `manual-before-pg17`, imports) are outside the policy:
they are never kept and show up as prunable. Move them out of the managed
dataset if you need them.

## Worked example

`test/data/alpha.manifest` with `test/data/policy.conf` (`daily=7 weekly=4
monthly=3`): nightly snapshots at 02:15 from 2 January to 20 March 2025,
plus extra runs on 7 February 18:00, 14 March 14:00 and 19 March 11:30.

- daily: 20 March, 19 March 11:30, 18, 17, 16 and 15 March, 14 March 14:00;
- weekly: the weeks of 17, 10 and 3 March and 24 February, so 20, 16, 9 and
  2 March (Sundays close a week);
- monthly: March, February and January, so 20 March, 28 February and
  31 January.

Several rules can keep the same snapshot (20 March is kept by all three), so
the keep list (`test/data/alpha.keep`, 11 ids) is shorter than daily +
weekly + monthly.
__FX__
git add -A
commit "2026-09-01T13:20:00Z" "docs: retention rules with a worked example"

# --- cli: --version
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
mkdir -p bin
cat > bin/keepset <<'__FX__'
#!/usr/bin/env bash
# keepset: grandfather-father-son retention for snapshot manifests.
set -euo pipefail
KEEPSET_HOME=$(cd "$(dirname "$0")/.." && pwd)

# Under cron nobody reads stderr, so when it isn't a terminal, warnings and
# errors go to the log instead.
KEEPSET_LOG=${KEEPSET_LOG:-$KEEPSET_HOME/var/log/keepset.log}
if [ ! -t 2 ]; then
  mkdir -p "$(dirname "$KEEPSET_LOG")"
  exec 2>>"$KEEPSET_LOG"
fi

for lib in common units dates manifest retention report; do
  . "$KEEPSET_HOME/lib/$lib.sh"
done

usage() {
  cat <<'USAGE'
usage: keepset keep   [--policy FILE] MANIFEST
       keepset report [--policy FILE] MANIFEST...
       keepset --version

  keep    print the snapshot ids the policy keeps, newest first
  report  snapshot counts and sizes, kept and prunable

The policy defaults to etc/policy.conf.
USAGE
}

policy=$KEEPSET_HOME/etc/policy.conf
cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  --version) cat "$KEEPSET_HOME/VERSION"; exit 0 ;;
  -h|--help|'') usage; exit 0 ;;
  keep|report) ;;
  *) usage >&2; die "unknown command: $cmd" ;;
esac
args=()
while [ $# -gt 0 ]; do
  case $1 in
    --policy) policy=${2:?--policy needs a file}; shift 2 ;;
    -*) die "unknown option: $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -gt 0 ] || die "$cmd: no manifest given"
load_policy "$policy"

case $cmd in
  keep)
    [ ${#args[@]} -eq 1 ] || die "keep takes one manifest"
    manifest_entries "${args[0]}" | retention_keep
    ;;
  report)
    for m in "${args[@]}"; do report_host "$m"; done
    ;;
esac
__FX__
chmod +x bin/keepset
mkdir -p test
cat > test/cli.t.sh <<'__FX__'
t_version() {
  assert_eq "$(cat VERSION)" "$("$KEEPSET" --version)" "--version"
}

t_unknown_command_fails() {
  "$KEEPSET" frobnicate 2>/dev/null && fail "unknown command accepted"
  grep -q 'unknown command' "$KEEPSET_LOG" || fail "nothing logged"
}

t_report_alpha() {
  "$KEEPSET" report --policy test/data/policy.conf test/data/alpha.manifest >"$T/out"
  grep -Eq '^alpha +82 snapshots' "$T/out" || fail "$(cat "$T/out")"
}

t_missing_manifest() {
  "$KEEPSET" keep "$T/nope.manifest" && fail "missing manifest accepted"
  grep -q 'manifest not found' "$KEEPSET_LOG" || fail "nothing logged"
}
__FX__
git add -A
commit "2026-09-02T10:05:00Z" "cli: --version"

# --- policy: keep 12 monthly snapshots
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
mkdir -p etc
cat > etc/policy.conf <<'__FX__'
# Retention policy for the nightly prune. Each rule keeps the newest snapshot
# of that many of the newest days / weeks (Monday to Sunday) / months.
daily=7
weekly=5
monthly=12
__FX__
git add -A
commit "2026-09-03T16:45:00Z" "policy: keep 12 monthly snapshots"

# --- manifest: tolerate CRLF line endings
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
mkdir -p lib
cat > lib/manifest.sh <<'__FX__'
# shellcheck shell=bash
# A manifest lists one snapshot per line: "<id> <bytes> <path>". Blank lines
# and lines starting with # are ignored, and CRLF line endings are tolerated.

# manifest_entries FILE: "id bytes" lines, newest id first.
manifest_entries() {
  [ -r "$1" ] || die "manifest not found: $1"
  awk '{ sub(/\r$/, "") } /^[ \t]*(#|$)/ { next } { print $1, $2 }' "$1" | LC_ALL=C sort -r
}
__FX__
mkdir -p test
cat > test/manifest.t.sh <<'__FX__'
t_entries_newest_first() {
  printf '# host x\n20250102T0215 10 /a\n\n20250103T0215 20 /b\r\n20250101T0215 30 /c\n' >"$T/x.manifest"
  assert_eq "20250103T0215 20|20250102T0215 10|20250101T0215 30" "$(manifest_entries "$T/x.manifest" | paste -sd '|' -)" "entries"
}
__FX__
git add -A
commit "2026-09-04T09:10:00Z" "manifest: tolerate CRLF line endings"

# --- test/run.sh: pass/fail summary line
export GIT_AUTHOR_NAME="Rafael Okafor" GIT_AUTHOR_EMAIL="rafael.okafor@kelpwater.io" GIT_COMMITTER_NAME="Rafael Okafor" GIT_COMMITTER_EMAIL="rafael.okafor@kelpwater.io"
mkdir -p test
cat > test/run.sh <<'__FX__'
#!/usr/bin/env bash
# Runs every test/*.t.sh (or the files given). Prints one ok / not ok line
# per test and exits non-zero if any failed.
set -uo pipefail
cd "$(dirname "$0")/.."
. test/lib.sh

run_file() {
  . "$1"
  local t
  for t in $(declare -F | awk '$3 ~ /^t_/ { print $3 }'); do
    FAILED=
    T=$(mktemp -d "${TMPDIR:-/tmp}/keepset-test.XXXXXX")
    export KEEPSET_LOG=$T/keepset.log
    "$t"
    rm -rf "$T"
    if [ -n "$FAILED" ]; then
      echo "not ok - ${1#test/} $t"
      printf '%s' "$FAILED" | sed 's/^/    # /'
    else
      echo "ok - ${1#test/} $t"
    fi
  done
}

files=("$@")
[ ${#files[@]} -gt 0 ] || files=(test/*.t.sh)
results=$(mktemp "${TMPDIR:-/tmp}/keepset-results.XXXXXX")
for f in "${files[@]}"; do
  (run_file "$f")
done | tee "$results"
passed=$(grep -c '^ok ' "$results")
failed=$(grep -c '^not ok ' "$results")
rm -f "$results"
echo "# $passed passed, $failed failed"
[ "$failed" -eq 0 ]
__FX__
chmod +x test/run.sh
git add -A
commit "2026-09-07T14:30:00Z" "test/run.sh: pass/fail summary line"

# --- README: install, cron and logging
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
cat > README.md <<'__FX__'
# keepset

Grandfather-father-son retention for snapshot manifests. The backup hosts
export a manifest of their snapshots every night; keepset decides which ones
the policy keeps.

```
bin/keepset keep   var/manifests/db-01.manifest     # ids the policy keeps
bin/keepset report var/manifests/*.manifest         # counts and sizes
test/run.sh                                          # tests (bash, awk)
```

The policy is `etc/policy.conf`; how it is applied is in `docs/retention.md`.

## Install

Clone to `/opt/keepset` on the backup host. Needs bash and a POSIX awk,
nothing else. The cron entry runs `bin/keepset plan` at 00:30; the prune job
runs at 02:00.

When stderr isn't a terminal (cron, CI), keepset writes warnings and errors
to `var/log/keepset.log`. Set `KEEPSET_LOG` to send them elsewhere.
__FX__
git add -A
commit "2026-09-08T11:00:00Z" "README: install, cron and logging"

# --- report: count undated snapshots
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
mkdir -p lib
cat > lib/report.sh <<'__FX__'
# shellcheck shell=bash
# report_host MANIFEST: snapshot counts and sizes for one host.
report_host() {
  local manifest=$1 host kept
  host=$(host_of "$manifest")
  kept=" $(manifest_entries "$manifest" | retention_keep | tr '\n' ' ')"
  manifest_entries "$manifest" | awk -v host="$host" -v kept="$kept" '
    function human(n,   u, i) {
      split("B K M G T P", u, " "); i = 1
      while (n >= 1024 && i < 6) { n /= 1024; i++ }
      return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
    }
    {
      total++; bytes += $2
      if (index(kept, " " $1 " ")) { k++; kb += $2 } else { d++; db += $2 }
      if ($1 ~ /^[0-9]/) { if (oldest == "" || $1 < oldest) oldest = $1; if ($1 > newest) newest = $1 } else undated++
    }
    END {
      printf "%-10s %5d snapshots %8s   oldest %s   newest %s\n", host, total, human(bytes), oldest, newest
      printf "%-10s %5d kept      %8s\n", "", k, human(kb)
      printf "%-10s %5d prunable  %8s\n", "", d, human(db)
      if (undated) printf "%-10s %5d undated (never kept)\n", "", undated
    }'
}
__FX__
git add -A
commit "2026-09-09T17:25:00Z" "report: count undated snapshots"

# --- units: case-insensitive size suffixes
export GIT_AUTHOR_NAME="Rafael Okafor" GIT_AUTHOR_EMAIL="rafael.okafor@kelpwater.io" GIT_COMMITTER_NAME="Rafael Okafor" GIT_COMMITTER_EMAIL="rafael.okafor@kelpwater.io"
mkdir -p lib
cat > lib/units.sh <<'__FX__'
# shellcheck shell=bash
# Manifests store sizes in bytes; people read binary units (K, M, G, T are
# powers of 1024).

human() {
  awk -v n="$1" 'BEGIN {
    split("B K M G T P", u, " "); i = 1
    while (n >= 1024 && i < 6) { n /= 1024; i++ }
    if (i == 1) printf "%dB\n", n; else printf "%.1f%s\n", n, u[i]
  }'
}

# parse_size 41.2G -> bytes. Suffixes are case-insensitive; none means bytes.
parse_size() {
  awk -v s="$1" 'BEGIN {
    n = s + 0; u = toupper(substr(s, length(s), 1)); m = 1
    if (u == "K") m = 1024; else if (u == "M") m = 1024 ^ 2; else if (u == "G") m = 1024 ^ 3
    else if (u == "T") m = 1024 ^ 4; else if (u == "P") m = 1024 ^ 5
    printf "%.0f\n", n * m
  }'
}
__FX__
mkdir -p test
cat > test/units.t.sh <<'__FX__'
t_human_units() {
  assert_eq 512B "$(human 512)" "human 512"
  assert_eq 1.0K "$(human 1024)" "human 1024"
  assert_eq 1.5M "$(human 1572864)" "human 1.5M"
  assert_eq 41.2G "$(human 44238163968)" "human 41.2G"
  assert_eq 2.0T "$(human 2199023255552)" "human 2T"
}

t_parse_size() {
  assert_eq 512 "$(parse_size 512)" "plain bytes"
  assert_eq 1536 "$(parse_size 1.5K)" "1.5K"
  assert_eq 44238163149 "$(parse_size 41.2G)" "41.2G"
  assert_eq 1048576 "$(parse_size 1m)" "lowercase suffix"
}

t_human_roundtrip() {
  # whatever human() prints must parse back to within 1% of the input
  local i n back
  for ((i = 0; i < 50; i++)); do
    n=$((RANDOM * RANDOM + RANDOM))
    back=$(parse_size "$(human "$n")")
    if ! within_pct "$back" "$n" 1; then
      fail "human($n) = $(human "$n"), which parses back as $back"
      return
    fi
  done
}
__FX__
git add -A
commit "2026-09-10T10:40:00Z" "units: case-insensitive size suffixes"

# --- scripts/lint.sh: bash -n every shell file
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
mkdir -p scripts
cat > scripts/lint.sh <<'__FX__'
#!/usr/bin/env bash
# Syntax-check every shell file (bash -n). Run before pushing.
cd "$(dirname "$0")/.."
rc=0
for f in bin/keepset lib/*.sh test/*.sh scripts/*.sh; do
  bash -n "$f" || rc=1
done
exit $rc
__FX__
chmod +x scripts/lint.sh
git add -A
commit "2026-09-11T09:55:00Z" "scripts/lint.sh: bash -n every shell file"

# --- plan: keepset plan writes var/plan/<host>.plan
export GIT_AUTHOR_NAME="Maeve Doyle" GIT_AUTHOR_EMAIL="maeve.doyle@kelpwater.io" GIT_COMMITTER_NAME="Maeve Doyle" GIT_COMMITTER_EMAIL="maeve.doyle@kelpwater.io"
cat > README.md <<'__FX__'
# keepset

Grandfather-father-son retention for snapshot manifests. The backup hosts
export a manifest of their snapshots every night; keepset decides which ones
the policy keeps and writes a prune plan listing the rest.

```
bin/keepset keep   var/manifests/db-01.manifest     # ids the policy keeps
bin/keepset report var/manifests/*.manifest         # counts and sizes
bin/keepset plan   var/manifests/*.manifest         # -> var/plan/<host>.plan
test/run.sh                                          # tests (bash, awk)
```

The policy is `etc/policy.conf`; how it is applied is in `docs/retention.md`.

## Install

Clone to `/opt/keepset` on the backup host. Needs bash and a POSIX awk,
nothing else. The cron entry runs `bin/keepset plan` at 00:30; the prune job
runs at 02:00.

When stderr isn't a terminal (cron, CI), keepset writes warnings and errors
to `var/log/keepset.log`. Set `KEEPSET_LOG` to send them elsewhere.
__FX__
mkdir -p bin
cat > bin/keepset <<'__FX__'
#!/usr/bin/env bash
# keepset: grandfather-father-son retention for snapshot manifests.
set -euo pipefail
KEEPSET_HOME=$(cd "$(dirname "$0")/.." && pwd)

# Under cron nobody reads stderr, so when it isn't a terminal, warnings and
# errors go to the log instead.
KEEPSET_LOG=${KEEPSET_LOG:-$KEEPSET_HOME/var/log/keepset.log}
if [ ! -t 2 ]; then
  mkdir -p "$(dirname "$KEEPSET_LOG")"
  exec 2>>"$KEEPSET_LOG"
fi

for lib in common units dates manifest retention report plan; do
  . "$KEEPSET_HOME/lib/$lib.sh"
done

usage() {
  cat <<'USAGE'
usage: keepset keep   [--policy FILE] MANIFEST
       keepset report [--policy FILE] MANIFEST...
       keepset plan   [--policy FILE] [--out DIR] MANIFEST...
       keepset --version

  keep    print the snapshot ids the policy keeps, newest first
  report  snapshot counts and sizes, kept and prunable
  plan    write the prune plan to DIR/<host>.plan (default var/plan)

The policy defaults to etc/policy.conf.
USAGE
}

policy=$KEEPSET_HOME/etc/policy.conf
out=$KEEPSET_HOME/var/plan
cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  --version) cat "$KEEPSET_HOME/VERSION"; exit 0 ;;
  -h|--help|'') usage; exit 0 ;;
  keep|report|plan) ;;
  *) usage >&2; die "unknown command: $cmd" ;;
esac
args=()
while [ $# -gt 0 ]; do
  case $1 in
    --policy) policy=${2:?--policy needs a file}; shift 2 ;;
    --out) out=${2:?--out needs a directory}; shift 2 ;;
    -*) die "unknown option: $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -gt 0 ] || die "$cmd: no manifest given"
load_policy "$policy"

case $cmd in
  keep)
    [ ${#args[@]} -eq 1 ] || die "keep takes one manifest"
    manifest_entries "${args[0]}" | retention_keep
    ;;
  report)
    for m in "${args[@]}"; do report_host "$m"; done
    ;;
  plan)
    for m in "${args[@]}"; do plan_write "$m" "$out"; done
    ;;
esac
__FX__
chmod +x bin/keepset
mkdir -p test
cat > test/plan.t.sh <<'__FX__'
t_plan_alpha() {
  "$KEEPSET" plan --policy test/data/policy.conf --out "$T" test/data/alpha.manifest >/dev/null
  [ -f "$T/alpha.plan" ] || { fail "no plan written"; return; }
  local kept deleted
  kept=$(awk 'END { print NR }' test/data/alpha.keep)
  deleted=$(grep -c '^delete ' "$T/alpha.plan")
  assert_eq "$(manifest_entries test/data/alpha.manifest | awk 'END { print NR }')" "$((kept + deleted))" "kept + deleted"
  grep -q '^delete manual-pre-migration ' "$T/alpha.plan" || fail "manual snapshot not in plan"
  while read -r id; do
    grep -q "^delete $id " "$T/alpha.plan" && fail "plan deletes kept snapshot $id"
  done <test/data/alpha.keep
  return 0
}
__FX__
git add -A
commit "2026-09-14T18:10:00Z" "plan: keepset plan writes var/plan/<host>.plan"

# --- plan: add lib/plan.sh (missed in the last commit)
export GIT_AUTHOR_NAME="Maeve Doyle" GIT_AUTHOR_EMAIL="maeve.doyle@kelpwater.io" GIT_COMMITTER_NAME="Maeve Doyle" GIT_COMMITTER_EMAIL="maeve.doyle@kelpwater.io"
mkdir -p lib
cat > lib/plan.sh <<'__FX__'
# shellcheck shell=bash
# plan_write MANIFEST DIR: write DIR/<host>.plan, the snapshots the nightly
# prune will delete for this host. The prune job only deletes
# what a reviewed plan lists.
plan_write() {
  local manifest=$1 dir=$2 host kept out
  host=$(host_of "$manifest")
  kept=" $(manifest_entries "$manifest" | retention_keep | tr '\n' ' ')"
  mkdir -p "$dir"
  out=$dir/$host.plan
  {
    echo "# keepset plan for $host"
    echo "# keepset $(cat "$KEEPSET_HOME/VERSION"), policy daily=$KEEP_DAILY weekly=$KEEP_WEEKLY monthly=$KEEP_MONTHLY"
    manifest_entries "$manifest" | awk -v kept="$kept" '
      function human(n,   u, i) {
        split("B K M G T P", u, " "); i = 1
        while (n >= 1024 && i < 6) { n /= 1024; i++ }
        return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
      }
      !index(kept, " " $1 " ") { printf "delete %s %s %s\n", $1, $2, human($2) }'
  } >"$out"
  echo "$out"
}
__FX__
git add -A
commit "2026-09-15T09:20:00Z" "plan: add lib/plan.sh (missed in the last commit)"

# --- plan: summary line with a checksum of the delete list
export GIT_AUTHOR_NAME="Maeve Doyle" GIT_AUTHOR_EMAIL="maeve.doyle@kelpwater.io" GIT_COMMITTER_NAME="Maeve Doyle" GIT_COMMITTER_EMAIL="maeve.doyle@kelpwater.io"
cat > .gitignore <<'__FX__'
var/
*.tmp
__FX__
mkdir -p lib
cat > lib/plan.sh <<'__FX__'
# shellcheck shell=bash
# plan_write MANIFEST DIR: write DIR/<host>.plan, the snapshots the nightly
# prune will delete for this host. The prune job only deletes
# what a reviewed plan lists.
plan_write() {
  local manifest=$1 dir=$2 host kept out
  host=$(host_of "$manifest")
  kept=" $(manifest_entries "$manifest" | retention_keep | tr '\n' ' ')"
  mkdir -p "$dir"
  out=$dir/$host.plan
  {
    echo "# keepset plan for $host"
    echo "# keepset $(cat "$KEEPSET_HOME/VERSION"), policy daily=$KEEP_DAILY weekly=$KEEP_WEEKLY monthly=$KEEP_MONTHLY"
    manifest_entries "$manifest" | awk -v kept="$kept" '
      function human(n,   u, i) {
        split("B K M G T P", u, " "); i = 1
        while (n >= 1024 && i < 6) { n /= 1024; i++ }
        return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
      }
      !index(kept, " " $1 " ") { printf "delete %s %s %s\n", $1, $2, human($2) }'
  } >"$out.tmp"
  local total sum
  total=$(manifest_entries "$manifest" | awk 'END { print NR }')
  sum=$(grep '^delete ' "$out.tmp" | cksum | awk '{ print $1 }')
  awk -v total="$total" -v sum="$sum" '
    function human(n,   u, i) {
      split("B K M G T P", u, " "); i = 1
      while (n >= 1024 && i < 6) { n /= 1024; i++ }
      return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
    }
    { print } /^delete / { n++; b += $3 }
    END { printf "# keep %d, delete %d, frees %s, cksum %s\n", total - n, n, human(b), sum }' "$out.tmp" >"$out"
  rm -f "$out.tmp"
  echo "$out"
}
__FX__
mkdir -p test
cat > test/plan.t.sh <<'__FX__'
t_plan_alpha() {
  "$KEEPSET" plan --policy test/data/policy.conf --out "$T" test/data/alpha.manifest >/dev/null
  [ -f "$T/alpha.plan" ] || { fail "no plan written"; return; }
  local kept deleted
  kept=$(awk 'END { print NR }' test/data/alpha.keep)
  deleted=$(grep -c '^delete ' "$T/alpha.plan")
  assert_eq "$(manifest_entries test/data/alpha.manifest | awk 'END { print NR }')" "$((kept + deleted))" "kept + deleted"
  grep -q '^delete manual-pre-migration ' "$T/alpha.plan" || fail "manual snapshot not in plan"
  while read -r id; do
    grep -q "^delete $id " "$T/alpha.plan" && fail "plan deletes kept snapshot $id"
  done <test/data/alpha.keep
  return 0
}

t_plan_summary() {
  "$KEEPSET" plan --policy test/data/policy.conf --out "$T" test/data/alpha.manifest >/dev/null
  tail -1 "$T/alpha.plan" | grep -Eq '^# keep [0-9]+, delete [0-9]+, frees [0-9.]+[BKMGT], cksum [0-9]+$' || fail "bad summary: $(tail -1 "$T/alpha.plan")"
}
__FX__
git add -A
commit "2026-09-15T15:35:00Z" "plan: summary line with a checksum of the delete list"

# --- docs: reviewing prune plans
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
cat > README.md <<'__FX__'
# keepset

Grandfather-father-son retention for snapshot manifests. The backup hosts
export a manifest of their snapshots every night; keepset decides which ones
the policy keeps and writes a prune plan listing the rest.

```
bin/keepset keep   var/manifests/db-01.manifest     # ids the policy keeps
bin/keepset report var/manifests/*.manifest         # counts and sizes
bin/keepset plan   var/manifests/*.manifest         # -> var/plan/<host>.plan
test/run.sh                                          # tests (bash, awk)
```

The policy is `etc/policy.conf`; how it is applied is in `docs/retention.md`.
Plans are reviewed before the 02:00 prune deletes anything, see
`docs/plan-review.md`.

## Install

Clone to `/opt/keepset` on the backup host. Needs bash and a POSIX awk,
nothing else. The cron entry runs `bin/keepset plan` at 00:30; the prune job
reads the reviewed plans at 02:00.

When stderr isn't a terminal (cron, CI), keepset writes warnings and errors
to `var/log/keepset.log`. Set `KEEPSET_LOG` to send them elsewhere.
__FX__
mkdir -p docs
cat > docs/plan-review.md <<'__FX__'
# Reviewing prune plans

From 2.4.0 the 02:00 prune deletes only what a reviewed plan lists.

1. `bin/keepset plan var/manifests/*.manifest` (cron does this at 00:30)
   writes `var/plan/<host>.plan`.
2. Read each plan. The last line summarises it:
   `# keep 21, delete 2, frees 88.6G, cksum 2840317005`.
   A normal night deletes one or two snapshots per host once the backlog
   from before 2.4.0 is gone. Check that the newest days, weeks and months
   are not in the delete list.
3. Approve with `touch var/plan/<host>.approved`. The prune job refuses a
   plan whose cksum changed after approval.

If a plan looks wrong, don't approve it: the prune job then skips that host
for the night.
__FX__
git add -A
commit "2026-09-16T11:15:00Z" "docs: reviewing prune plans"

# --- dates: day_number in pure bash, no awk fork per snapshot
export GIT_AUTHOR_NAME="Rafael Okafor" GIT_AUTHOR_EMAIL="rafael.okafor@kelpwater.io" GIT_COMMITTER_NAME="Rafael Okafor" GIT_COMMITTER_EMAIL="rafael.okafor@kelpwater.io"
mkdir -p lib
cat > lib/dates.sh <<'__FX__'
# shellcheck shell=bash
# Snapshot ids are timestamps: YYYYMMDDTHHMM (UTC), e.g. 20250314T0215.

# day_number ID: days since 1970-01-01 for a snapshot id; fails for ids that
# aren't timestamps. Pure bash: forking awk once per snapshot was most of
# plan's runtime on hosts with a few thousand snapshots.
day_number() {
  case $1 in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T*) ;;
    *) return 1 ;;
  esac
  local y=${1:0:4} m=${1:4:2} d=${1:6:2}
  echo $((d + (153 * (m + 12 * ((14 - m) / 12) - 3) + 2) / 5 + 365 * (y + 4800 - (14 - m) / 12) + (y + 4800 - (14 - m) / 12) / 4 - (y + 4800 - (14 - m) / 12) / 100 + (y + 4800 - (14 - m) / 12) / 400 - 2472633))
}

# week_number DAY: weeks since the Monday before the epoch, so weeks run
# Monday to Sunday.
week_number() {
  echo $((($1 + 3) / 7))
}
__FX__
git add -A
commit "2026-09-17T22:48:00Z" "dates: day_number in pure bash, no awk fork per snapshot"

# --- manifest: warn about duplicate ids
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
mkdir -p lib
cat > lib/manifest.sh <<'__FX__'
# shellcheck shell=bash
# A manifest lists one snapshot per line: "<id> <bytes> <path>". Blank lines
# and lines starting with # are ignored, and CRLF line endings are tolerated.

# manifest_entries FILE: "id bytes" lines, newest id first.
manifest_entries() {
  [ -r "$1" ] || die "manifest not found: $1"
  manifest_dupes "$1"
  awk '{ sub(/\r$/, "") } /^[ \t]*(#|$)/ { next } { print $1, $2 }' "$1" | LC_ALL=C sort -r
}

# manifest_dupes FILE: warn about ids listed more than once.
manifest_dupes() {
  local id
  for id in $(awk '{ sub(/\r$/, "") } /^[ \t]*(#|$)/ { next } { print $1 }' "$1" | LC_ALL=C sort | uniq -d); do
    warn "$(host_of "$1"): snapshot $id is listed more than once"
  done
}
__FX__
mkdir -p test
cat > test/manifest.t.sh <<'__FX__'
t_entries_newest_first() {
  printf '# host x\n20250102T0215 10 /a\n\n20250103T0215 20 /b\r\n20250101T0215 30 /c\n' >"$T/x.manifest"
  assert_eq "20250103T0215 20|20250102T0215 10|20250101T0215 30" "$(manifest_entries "$T/x.manifest" | paste -sd '|' -)" "entries"
}

t_duplicate_ids_warn() {
  printf '20250102T0215 10 /a\n20250102T0215 10 /a\n' >"$T/dup.manifest"
  manifest_entries "$T/dup.manifest" >/dev/null 2>"$T/err"
  grep -q 'listed more than once' "$T/err" || fail "no duplicate warning"
}
__FX__
git add -A
commit "2026-09-18T10:30:00Z" "manifest: warn about duplicate ids"

# --- report --json
export GIT_AUTHOR_NAME="Jun Park" GIT_AUTHOR_EMAIL="jun.park@kelpwater.io" GIT_COMMITTER_NAME="Jun Park" GIT_COMMITTER_EMAIL="jun.park@kelpwater.io"
mkdir -p bin
cat > bin/keepset <<'__FX__'
#!/usr/bin/env bash
# keepset: grandfather-father-son retention for snapshot manifests.
set -euo pipefail
KEEPSET_HOME=$(cd "$(dirname "$0")/.." && pwd)

# Under cron nobody reads stderr, so when it isn't a terminal, warnings and
# errors go to the log instead.
KEEPSET_LOG=${KEEPSET_LOG:-$KEEPSET_HOME/var/log/keepset.log}
if [ ! -t 2 ]; then
  mkdir -p "$(dirname "$KEEPSET_LOG")"
  exec 2>>"$KEEPSET_LOG"
fi

for lib in common units dates manifest retention report plan; do
  . "$KEEPSET_HOME/lib/$lib.sh"
done

usage() {
  cat <<'USAGE'
usage: keepset keep   [--policy FILE] MANIFEST
       keepset report [--policy FILE] [--json] MANIFEST...
       keepset plan   [--policy FILE] [--out DIR] MANIFEST...
       keepset --version

  keep    print the snapshot ids the policy keeps, newest first
  report  snapshot counts and sizes, kept and prunable
  plan    write the prune plan to DIR/<host>.plan (default var/plan)

The policy defaults to etc/policy.conf.
USAGE
}

policy=$KEEPSET_HOME/etc/policy.conf
out=$KEEPSET_HOME/var/plan
json=
cmd=${1:-}
[ $# -gt 0 ] && shift
case $cmd in
  --version) cat "$KEEPSET_HOME/VERSION"; exit 0 ;;
  -h|--help|'') usage; exit 0 ;;
  keep|report|plan) ;;
  *) usage >&2; die "unknown command: $cmd" ;;
esac
args=()
while [ $# -gt 0 ]; do
  case $1 in
    --policy) policy=${2:?--policy needs a file}; shift 2 ;;
    --out) out=${2:?--out needs a directory}; shift 2 ;;
    --json) json=1; shift ;;
    -*) die "unknown option: $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -gt 0 ] || die "$cmd: no manifest given"
load_policy "$policy"

case $cmd in
  keep)
    [ ${#args[@]} -eq 1 ] || die "keep takes one manifest"
    manifest_entries "${args[0]}" | retention_keep
    ;;
  report)
    for m in "${args[@]}"; do report_host "$m" "$json"; done
    ;;
  plan)
    for m in "${args[@]}"; do plan_write "$m" "$out"; done
    ;;
esac
__FX__
chmod +x bin/keepset
mkdir -p lib
cat > lib/report.sh <<'__FX__'
# shellcheck shell=bash
# report_host MANIFEST [JSON]: snapshot counts and sizes for one host.
report_host() {
  local manifest=$1 json=${2:-} host kept
  host=$(host_of "$manifest")
  kept=" $(manifest_entries "$manifest" | retention_keep | tr '\n' ' ')"
  manifest_entries "$manifest" | awk -v host="$host" -v kept="$kept" -v json="$json" '
    function human(n,   u, i) {
      split("B K M G T P", u, " "); i = 1
      while (n >= 1024 && i < 6) { n /= 1024; i++ }
      return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
    }
    {
      total++; bytes += $2
      if (index(kept, " " $1 " ")) { k++; kb += $2 } else { d++; db += $2 }
      if ($1 ~ /^[0-9]/) { if (oldest == "" || $1 < oldest) oldest = $1; if ($1 > newest) newest = $1 } else undated++
    }
    END {
      if (json) {
        printf "{\"host\":\"%s\",\"snapshots\":%d,\"bytes\":%.0f,\"kept\":%d,\"kept_bytes\":%.0f,\"prunable\":%d,\"prunable_bytes\":%.0f,\"undated\":%d,\"oldest\":\"%s\",\"newest\":\"%s\"}\n", host, total, bytes, k, kb, d, db, undated, oldest, newest
        exit
      }
      printf "%-10s %5d snapshots %8s   oldest %s   newest %s\n", host, total, human(bytes), oldest, newest
      printf "%-10s %5d kept      %8s\n", "", k, human(kb)
      printf "%-10s %5d prunable  %8s\n", "", d, human(db)
      if (undated) printf "%-10s %5d undated (never kept)\n", "", undated
    }'
}
__FX__
mkdir -p test
cat > test/cli.t.sh <<'__FX__'
t_version() {
  assert_eq "$(cat VERSION)" "$("$KEEPSET" --version)" "--version"
}

t_unknown_command_fails() {
  "$KEEPSET" frobnicate 2>/dev/null && fail "unknown command accepted"
  grep -q 'unknown command' "$KEEPSET_LOG" || fail "nothing logged"
}

t_report_alpha() {
  "$KEEPSET" report --policy test/data/policy.conf test/data/alpha.manifest >"$T/out"
  grep -Eq '^alpha +82 snapshots' "$T/out" || fail "$(cat "$T/out")"
}

t_report_json() {
  local j
  j=$("$KEEPSET" report --json --policy test/data/policy.conf test/data/alpha.manifest)
  case $j in '{"host":"alpha","snapshots":82,'*) ;; *) fail "json: $j" ;; esac
}

t_missing_manifest() {
  "$KEEPSET" keep "$T/nope.manifest" && fail "missing manifest accepted"
  grep -q 'manifest not found' "$KEEPSET_LOG" || fail "nothing logged"
}
__FX__
git add -A
commit "2026-09-21T14:00:00Z" "report --json"

# --- test: year-end retention fixture
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
mkdir -p test/data
cat > test/data/yearend.keep <<'__FX__'
20250107T0215
20250106T0215
20250105T0215
20250104T0215
20250103T0215
20250102T0215
20250101T0215
20241231T1900
20241229T0215
20241222T0215
__FX__
mkdir -p test/data
cat > test/data/yearend.manifest <<'__FX__'
# yearend: test host across a year boundary
20241214T0215 8369757366 /srv/snap/yearend/20241214T0215
20241215T0215 7731152248 /srv/snap/yearend/20241215T0215
20241216T0215 8706202221 /srv/snap/yearend/20241216T0215
20241217T0215 8034500790 /srv/snap/yearend/20241217T0215
20241218T0215 8534865093 /srv/snap/yearend/20241218T0215
20241219T0215 7598988247 /srv/snap/yearend/20241219T0215
20241220T0215 8249544871 /srv/snap/yearend/20241220T0215
20241221T0215 8498321009 /srv/snap/yearend/20241221T0215
20241222T0215 9184652758 /srv/snap/yearend/20241222T0215
20241223T0215 7292176437 /srv/snap/yearend/20241223T0215
20241224T0215 9076344740 /srv/snap/yearend/20241224T0215
20241225T0215 9096801710 /srv/snap/yearend/20241225T0215
20241226T0215 9069195700 /srv/snap/yearend/20241226T0215
20241227T0215 7698324156 /srv/snap/yearend/20241227T0215
20241228T0215 8085337591 /srv/snap/yearend/20241228T0215
20241229T0215 8029079390 /srv/snap/yearend/20241229T0215
20241230T0215 8908165884 /srv/snap/yearend/20241230T0215
20241231T0215 7202714872 /srv/snap/yearend/20241231T0215
20241231T1900 9056071949 /srv/snap/yearend/20241231T1900
20250101T0215 8237753874 /srv/snap/yearend/20250101T0215
20250102T0215 9170247507 /srv/snap/yearend/20250102T0215
20250103T0215 7702961159 /srv/snap/yearend/20250103T0215
20250104T0215 7526195717 /srv/snap/yearend/20250104T0215
20250105T0215 7606418860 /srv/snap/yearend/20250105T0215
20250106T0215 9019900393 /srv/snap/yearend/20250106T0215
20250107T0215 7793336582 /srv/snap/yearend/20250107T0215
__FX__
mkdir -p test
cat > test/retention.t.sh <<'__FX__'
# Expected keep lists were checked by hand against docs/retention.md.

t_keep_alpha() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest >"$T/keep"
  assert_file_eq test/data/alpha.keep "$T/keep"
}

t_keep_year_end() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/yearend.manifest >"$T/keep"
  assert_file_eq test/data/yearend.keep "$T/keep"
}

t_undated_never_kept() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest | grep -q manual && fail "manual snapshot kept"
  return 0
}
__FX__
git add -A
commit "2026-09-22T09:45:00Z" "test: year-end retention fixture"

# --- retention: one pass over the snapshots instead of three
export GIT_AUTHOR_NAME="Maeve Doyle" GIT_AUTHOR_EMAIL="maeve.doyle@kelpwater.io" GIT_COMMITTER_NAME="Maeve Doyle" GIT_COMMITTER_EMAIL="maeve.doyle@kelpwater.io"
mkdir -p lib
cat > lib/retention.sh <<'__FX__'
# shellcheck shell=bash
# Grandfather-father-son retention. A snapshot is kept if it is the newest
# snapshot of one of the KEEP_DAILY newest days, the KEEP_WEEKLY newest weeks
# or the KEEP_MONTHLY newest months that have snapshots. Ids that aren't
# timestamps (manual-*, imports) are outside the policy and never kept.

# retention_keep: reads "id bytes" lines, newest first; prints kept ids,
# newest first. One pass: each bucket's first (newest) snapshot claims it.
retention_keep() {
  local id bytes dn wk mo keep nd=0 nw=0 nm=0 seen_d=' ' seen_w=' ' seen_m=' '
  while read -r id bytes; do
    dn=$(day_number "$id") || continue
    wk=$(week_number "$dn")
    mo=${id:0:6}
    keep=
    case $seen_d in
      *" $dn "*) ;;
      *)
        seen_d="$seen_d$dn "
        nd=$((nd + 1))
        if [ "$nd" -le "$KEEP_DAILY" ]; then keep=1; fi
        ;;
    esac
    case $seen_w in
      *" $wk "*) ;;
      *)
        seen_w="$seen_w$wk "
        nw=$((nw + 1))
        if [ "$nw" -le "$KEEP_WEEKLY" ]; then keep=1; fi
        ;;
    esac
    case $seen_m in
      *" $mo "*) ;;
      *)
        seen_m="$seen_m$mo "
        nm=$((nm + 1))
        if [ "$nm" -le "$KEEP_MONTHLY" ]; then keep=1; fi
        ;;
    esac
    if [ -n "$keep" ]; then echo "$id"; fi
  done
  return 0
}
__FX__
mkdir -p test
cat > test/retention.t.sh <<'__FX__'
# Expected keep lists were checked by hand against docs/retention.md.

t_keep_alpha() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest >"$T/keep"
  assert_file_eq test/data/alpha.keep "$T/keep"
}

t_keep_year_end() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/yearend.manifest >"$T/keep"
  assert_file_eq test/data/yearend.keep "$T/keep"
}

t_undated_never_kept() {
  "$KEEPSET" keep --policy test/data/policy.conf test/data/alpha.manifest | grep -q manual && fail "manual snapshot kept"
  return 0
}

t_newest_of_day_wins() {
  printf '20250110T0215 1 /a\n20250110T1400 1 /b\n20250109T0215 1 /c\n' >"$T/h.manifest"
  printf 'daily=1\nweekly=0\nmonthly=0\n' >"$T/p"
  assert_eq 20250110T1400 "$("$KEEPSET" keep --policy "$T/p" "$T/h.manifest")" "newest of the day"
}
__FX__
git add -A
commit "2026-09-23T16:20:00Z" "retention: one pass over the snapshots instead of three"

# --- plan: list deletions oldest first
export GIT_AUTHOR_NAME="Maeve Doyle" GIT_AUTHOR_EMAIL="maeve.doyle@kelpwater.io" GIT_COMMITTER_NAME="Maeve Doyle" GIT_COMMITTER_EMAIL="maeve.doyle@kelpwater.io"
mkdir -p lib
cat > lib/plan.sh <<'__FX__'
# shellcheck shell=bash
# plan_write MANIFEST DIR: write DIR/<host>.plan, the snapshots the nightly
# prune will delete for this host, oldest first. The prune job only deletes
# what a reviewed plan lists.
plan_write() {
  local manifest=$1 dir=$2 host kept out
  host=$(host_of "$manifest")
  kept=" $(manifest_entries "$manifest" | retention_keep | tr '\n' ' ')"
  mkdir -p "$dir"
  out=$dir/$host.plan
  {
    echo "# keepset plan for $host"
    echo "# keepset $(cat "$KEEPSET_HOME/VERSION"), policy daily=$KEEP_DAILY weekly=$KEEP_WEEKLY monthly=$KEEP_MONTHLY"
    manifest_entries "$manifest" | LC_ALL=C sort | awk -v kept="$kept" '
      function human(n,   u, i) {
        split("B K M G T P", u, " "); i = 1
        while (n >= 1024 && i < 6) { n /= 1024; i++ }
        return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
      }
      !index(kept, " " $1 " ") { printf "delete %s %s %s\n", $1, $2, human($2) }'
  } >"$out.tmp"
  local total sum
  total=$(manifest_entries "$manifest" | awk 'END { print NR }')
  sum=$(grep '^delete ' "$out.tmp" | cksum | awk '{ print $1 }')
  awk -v total="$total" -v sum="$sum" '
    function human(n,   u, i) {
      split("B K M G T P", u, " "); i = 1
      while (n >= 1024 && i < 6) { n /= 1024; i++ }
      return i == 1 ? sprintf("%dB", n) : sprintf("%.1f%s", n, u[i])
    }
    { print } /^delete / { n++; b += $3 }
    END { printf "# keep %d, delete %d, frees %s, cksum %s\n", total - n, n, human(b), sum }' "$out.tmp" >"$out"
  rm -f "$out.tmp"
  echo "$out"
}
__FX__
mkdir -p test
cat > test/plan.t.sh <<'__FX__'
t_plan_alpha() {
  "$KEEPSET" plan --policy test/data/policy.conf --out "$T" test/data/alpha.manifest >/dev/null
  [ -f "$T/alpha.plan" ] || { fail "no plan written"; return; }
  local kept deleted
  kept=$(awk 'END { print NR }' test/data/alpha.keep)
  deleted=$(grep -c '^delete ' "$T/alpha.plan")
  assert_eq "$(manifest_entries test/data/alpha.manifest | awk 'END { print NR }')" "$((kept + deleted))" "kept + deleted"
  grep -q '^delete manual-pre-migration ' "$T/alpha.plan" || fail "manual snapshot not in plan"
  while read -r id; do
    grep -q "^delete $id " "$T/alpha.plan" && fail "plan deletes kept snapshot $id"
  done <test/data/alpha.keep
  return 0
}

t_plan_oldest_first() {
  "$KEEPSET" plan --policy test/data/policy.conf --out "$T" test/data/yearend.manifest >/dev/null
  grep '^delete [0-9]' "$T/yearend.plan" | awk '{ print $2 }' >"$T/ids"
  LC_ALL=C sort "$T/ids" | cmp -s - "$T/ids" || fail "plan not oldest first"
}

t_plan_summary() {
  "$KEEPSET" plan --policy test/data/policy.conf --out "$T" test/data/alpha.manifest >/dev/null
  tail -1 "$T/alpha.plan" | grep -Eq '^# keep [0-9]+, delete [0-9]+, frees [0-9.]+[BKMGT], cksum [0-9]+$' || fail "bad summary: $(tail -1 "$T/alpha.plan")"
}
__FX__
git add -A
commit "2026-09-24T11:05:00Z" "plan: list deletions oldest first"

# --- CHANGELOG for 2.4.0
export GIT_AUTHOR_NAME="Ines Duarte" GIT_AUTHOR_EMAIL="ines.duarte@kelpwater.io" GIT_COMMITTER_NAME="Ines Duarte" GIT_COMMITTER_EMAIL="ines.duarte@kelpwater.io"
cat > CHANGELOG.md <<'__FX__'
# Changelog

## 2.4.0 (unreleased)
- `keepset plan` writes a prune plan per host to `var/plan/`, oldest first,
  with a summary line. The prune job will read plans instead of calling
  `keep` itself once 2.4.0 is deployed.
- `report --json`.
- `--version`.
- Manifests: CRLF line endings and blank lines are tolerated; duplicate ids
  are logged.
- Size suffixes are case-insensitive.
- Faster: day numbers are computed without forking awk, and retention makes
  one pass over the snapshots instead of three.
- Default policy keeps 12 monthly snapshots (was 6).

## 2.3.0
- Snapshot ids that aren't timestamps (manual-* snapshots) are outside the
  policy; they no longer claim a daily slot.

## 2.2.0
- `report` shows human-readable sizes.

## 2.0.0
- Rewrite in bash: manifests in, GFS keep list out.
__FX__
git add -A
commit "2026-09-28T10:15:00Z" "CHANGELOG for 2.4.0"

# --- dates: tests for leap day and year end
export GIT_AUTHOR_NAME="Rafael Okafor" GIT_AUTHOR_EMAIL="rafael.okafor@kelpwater.io" GIT_COMMITTER_NAME="Rafael Okafor" GIT_COMMITTER_EMAIL="rafael.okafor@kelpwater.io"
mkdir -p test
cat > test/dates.t.sh <<'__FX__'
t_day_number_epoch() {
  assert_eq 0 "$(day_number 19700101T0000)" "epoch"
  assert_eq 1 "$(day_number 19700102T2359)" "next day"
}

t_day_number_known_dates() {
  assert_eq 20089 "$(day_number 20250101T0215)" "2025-01-01"
  assert_eq 19782 "$(day_number 20240229T0000)" "leap day"
  assert_eq 20453 "$(day_number 20251231T2300)" "2025-12-31"
}

t_day_number_rejects_undated() {
  if day_number manual-pre-upgrade >/dev/null 2>&1; then fail "manual id accepted"; fi
  if day_number 2025-01-01 >/dev/null 2>&1; then fail "dashed date accepted"; fi
}

t_week_number_mondays() {
  # 2025-01-05 is a Sunday, 2025-01-06 a Monday
  local sun mon
  sun=$(week_number "$(day_number 20250105T1200)")
  mon=$(week_number "$(day_number 20250106T0000)")
  assert_eq "$((sun + 1))" "$mon" "week starts on Monday"
  assert_eq "$sun" "$(week_number "$(day_number 20241230T0000)")" "Monday 2024-12-30 starts that week"
}
__FX__
git add -A
commit "2026-09-29T13:40:00Z" "dates: tests for leap day and year end"

# --- uncommitted
mkdir -p var/manifests
mkdir -p var/manifests
cat > var/manifests/db-01.manifest <<'__FX__'
# db-01: exported by snapd 2026-10-01 23:50 UTC
20250701T0215 48093625419 /tank/snap/db-01/20250701T0215
20250702T0215 47633437992 /tank/snap/db-01/20250702T0215
20250703T0215 45476554687 /tank/snap/db-01/20250703T0215
20250704T0215 41454609217 /tank/snap/db-01/20250704T0215
20250705T0215 43600535004 /tank/snap/db-01/20250705T0215
20250706T0215 39958541289 /tank/snap/db-01/20250706T0215
20250707T0215 46149962356 /tank/snap/db-01/20250707T0215
20250708T0215 43960846324 /tank/snap/db-01/20250708T0215
20250709T0215 45795224352 /tank/snap/db-01/20250709T0215
20250710T0215 45929996697 /tank/snap/db-01/20250710T0215
20250711T0215 46569761464 /tank/snap/db-01/20250711T0215
20250712T0215 43426488317 /tank/snap/db-01/20250712T0215
20250713T0215 47113670926 /tank/snap/db-01/20250713T0215
20250714T0215 41738404867 /tank/snap/db-01/20250714T0215
20250715T0215 50426879210 /tank/snap/db-01/20250715T0215
20250716T0215 40724625198 /tank/snap/db-01/20250716T0215
20250717T0215 42632820153 /tank/snap/db-01/20250717T0215
20250718T0215 46252027308 /tank/snap/db-01/20250718T0215
20250719T0215 46443187373 /tank/snap/db-01/20250719T0215
20250720T0215 39851269038 /tank/snap/db-01/20250720T0215
20250721T0215 41320365059 /tank/snap/db-01/20250721T0215
20250722T0215 41339114935 /tank/snap/db-01/20250722T0215
20250723T0215 48028130903 /tank/snap/db-01/20250723T0215
20250724T0215 44734340992 /tank/snap/db-01/20250724T0215
20250725T0215 42883702684 /tank/snap/db-01/20250725T0215
20250726T0215 39852120146 /tank/snap/db-01/20250726T0215
20250727T0215 50529635946 /tank/snap/db-01/20250727T0215
20250728T0215 48689667470 /tank/snap/db-01/20250728T0215
20250729T0215 46439303448 /tank/snap/db-01/20250729T0215
20250730T0215 43433848478 /tank/snap/db-01/20250730T0215
20250731T0215 45466035218 /tank/snap/db-01/20250731T0215
20250801T0215 39957157151 /tank/snap/db-01/20250801T0215
20250802T0215 44615467006 /tank/snap/db-01/20250802T0215
20250803T0215 45607836138 /tank/snap/db-01/20250803T0215
20250804T0215 47545331680 /tank/snap/db-01/20250804T0215
20250805T0215 40261790048 /tank/snap/db-01/20250805T0215
20250806T0215 47622914329 /tank/snap/db-01/20250806T0215
20250807T0215 45863068186 /tank/snap/db-01/20250807T0215
20250808T0215 43793370803 /tank/snap/db-01/20250808T0215
20250809T0215 42775588805 /tank/snap/db-01/20250809T0215
20250810T0215 49972524918 /tank/snap/db-01/20250810T0215
20250811T0215 43213591340 /tank/snap/db-01/20250811T0215
20250812T0215 44903725947 /tank/snap/db-01/20250812T0215
20250813T0215 39960225777 /tank/snap/db-01/20250813T0215
20250814T0215 43662573670 /tank/snap/db-01/20250814T0215
20250815T0215 39964992467 /tank/snap/db-01/20250815T0215
20250816T0215 40123647785 /tank/snap/db-01/20250816T0215
20250817T0215 42554233328 /tank/snap/db-01/20250817T0215
20250818T0215 47101867600 /tank/snap/db-01/20250818T0215
20250819T0215 44136392067 /tank/snap/db-01/20250819T0215
20250820T0215 41287933304 /tank/snap/db-01/20250820T0215
20250821T0215 40506722967 /tank/snap/db-01/20250821T0215
20250822T0215 39942221735 /tank/snap/db-01/20250822T0215
20250823T0215 47655473811 /tank/snap/db-01/20250823T0215
20250824T0215 48040729946 /tank/snap/db-01/20250824T0215
20250825T0215 45478180491 /tank/snap/db-01/20250825T0215
20250826T0215 50075809710 /tank/snap/db-01/20250826T0215
20250827T0215 49888244510 /tank/snap/db-01/20250827T0215
20250828T0215 39889319167 /tank/snap/db-01/20250828T0215
20250829T0215 49856219917 /tank/snap/db-01/20250829T0215
20250830T0215 43753395583 /tank/snap/db-01/20250830T0215
20250831T0215 50544459164 /tank/snap/db-01/20250831T0215
20250901T0215 50247502019 /tank/snap/db-01/20250901T0215
20250902T0215 41073074237 /tank/snap/db-01/20250902T0215
20250903T0215 39947609785 /tank/snap/db-01/20250903T0215
20250904T0215 44154835409 /tank/snap/db-01/20250904T0215
20250905T0215 41396165092 /tank/snap/db-01/20250905T0215
20250906T0215 44587090121 /tank/snap/db-01/20250906T0215
20250907T0215 46332530195 /tank/snap/db-01/20250907T0215
20250908T0215 48372165029 /tank/snap/db-01/20250908T0215
20250909T0215 39947771832 /tank/snap/db-01/20250909T0215
20250910T0215 44536208847 /tank/snap/db-01/20250910T0215
20250911T0215 43081790044 /tank/snap/db-01/20250911T0215
20250912T0215 44825013055 /tank/snap/db-01/20250912T0215
20250913T0215 44743429320 /tank/snap/db-01/20250913T0215
20250914T0215 44307625923 /tank/snap/db-01/20250914T0215
20250915T0215 50473072126 /tank/snap/db-01/20250915T0215
20250916T0215 49185133985 /tank/snap/db-01/20250916T0215
20250917T0215 43950391852 /tank/snap/db-01/20250917T0215
20250918T0215 46360447655 /tank/snap/db-01/20250918T0215
20250919T0215 44353639774 /tank/snap/db-01/20250919T0215
20250920T0215 41388238107 /tank/snap/db-01/20250920T0215
20250921T0215 46536406172 /tank/snap/db-01/20250921T0215
20250922T0215 49671590902 /tank/snap/db-01/20250922T0215
20250923T0215 48452930966 /tank/snap/db-01/20250923T0215
20250924T0215 44795036276 /tank/snap/db-01/20250924T0215
20250925T0215 42117358085 /tank/snap/db-01/20250925T0215
20250926T0215 50370258924 /tank/snap/db-01/20250926T0215
20250927T0215 41464618173 /tank/snap/db-01/20250927T0215
20250928T0215 44446928903 /tank/snap/db-01/20250928T0215
20250929T0215 50026789224 /tank/snap/db-01/20250929T0215
20250930T0215 49999391557 /tank/snap/db-01/20250930T0215
20251001T0215 40515469707 /tank/snap/db-01/20251001T0215
20251002T0215 47671867286 /tank/snap/db-01/20251002T0215
20251003T0215 42191396135 /tank/snap/db-01/20251003T0215
20251004T0215 48376039275 /tank/snap/db-01/20251004T0215
20251005T0215 41641275469 /tank/snap/db-01/20251005T0215
20251006T0215 44114164015 /tank/snap/db-01/20251006T0215
20251007T0215 43020127671 /tank/snap/db-01/20251007T0215
20251008T0215 46184045639 /tank/snap/db-01/20251008T0215
20251009T0215 47832606714 /tank/snap/db-01/20251009T0215
20251010T0215 41800559862 /tank/snap/db-01/20251010T0215
20251011T0215 48805081950 /tank/snap/db-01/20251011T0215
20251012T0215 45422200706 /tank/snap/db-01/20251012T0215
20251013T0215 41467372603 /tank/snap/db-01/20251013T0215
20251014T0215 44889308730 /tank/snap/db-01/20251014T0215
20251015T0215 41922806064 /tank/snap/db-01/20251015T0215
20251016T0215 43726918578 /tank/snap/db-01/20251016T0215
20251017T0215 41293764326 /tank/snap/db-01/20251017T0215
20251018T0215 39631804996 /tank/snap/db-01/20251018T0215
20251019T0215 48312677748 /tank/snap/db-01/20251019T0215
20251020T0215 49659648231 /tank/snap/db-01/20251020T0215
20251021T0215 41136584107 /tank/snap/db-01/20251021T0215
20251022T0215 41908996515 /tank/snap/db-01/20251022T0215
20251023T0215 49359748694 /tank/snap/db-01/20251023T0215
20251024T0215 44143087279 /tank/snap/db-01/20251024T0215
20251025T0215 48507442438 /tank/snap/db-01/20251025T0215
20251026T0215 41952187151 /tank/snap/db-01/20251026T0215
20251027T0215 50507861284 /tank/snap/db-01/20251027T0215
20251028T0215 41527183732 /tank/snap/db-01/20251028T0215
20251029T0215 47845927975 /tank/snap/db-01/20251029T0215
20251030T0215 49554133925 /tank/snap/db-01/20251030T0215
20251031T0215 47180863302 /tank/snap/db-01/20251031T0215
20251101T0215 43359953118 /tank/snap/db-01/20251101T0215
20251102T0215 42612323232 /tank/snap/db-01/20251102T0215
20251103T0215 47784364774 /tank/snap/db-01/20251103T0215
20251104T0215 44756204324 /tank/snap/db-01/20251104T0215
20251105T0215 41805200083 /tank/snap/db-01/20251105T0215
20251106T0215 44976793627 /tank/snap/db-01/20251106T0215
20251107T0215 41182102675 /tank/snap/db-01/20251107T0215
20251108T0215 43847930236 /tank/snap/db-01/20251108T0215
20251109T0215 43525441308 /tank/snap/db-01/20251109T0215
20251110T0215 46716926912 /tank/snap/db-01/20251110T0215
20251111T0215 45483767863 /tank/snap/db-01/20251111T0215
20251112T0215 42031502735 /tank/snap/db-01/20251112T0215
20251113T0215 40498173471 /tank/snap/db-01/20251113T0215
20251114T0215 44845429973 /tank/snap/db-01/20251114T0215
20251115T0215 48923122445 /tank/snap/db-01/20251115T0215
20251116T0215 41216931770 /tank/snap/db-01/20251116T0215
20251117T0215 42516760478 /tank/snap/db-01/20251117T0215
20251118T0215 46025619589 /tank/snap/db-01/20251118T0215
20251119T0215 40019754583 /tank/snap/db-01/20251119T0215
20251120T0215 39655278503 /tank/snap/db-01/20251120T0215
20251121T0215 39944403733 /tank/snap/db-01/20251121T0215
20251122T0215 39988769291 /tank/snap/db-01/20251122T0215
20251123T0215 44315752631 /tank/snap/db-01/20251123T0215
20251124T0215 40829039091 /tank/snap/db-01/20251124T0215
20251125T0215 41036754393 /tank/snap/db-01/20251125T0215
20251126T0215 48467901321 /tank/snap/db-01/20251126T0215
20251127T0215 43378267669 /tank/snap/db-01/20251127T0215
20251128T0215 45576431172 /tank/snap/db-01/20251128T0215
20251129T0215 41068281046 /tank/snap/db-01/20251129T0215
20251130T0215 44703017143 /tank/snap/db-01/20251130T0215
20251201T0215 40458657005 /tank/snap/db-01/20251201T0215
20251202T0215 46513012408 /tank/snap/db-01/20251202T0215
20251203T0215 47116188057 /tank/snap/db-01/20251203T0215
20251204T0215 49172475132 /tank/snap/db-01/20251204T0215
20251205T0215 44127418047 /tank/snap/db-01/20251205T0215
20251206T0215 45976933772 /tank/snap/db-01/20251206T0215
20251207T0215 48954730672 /tank/snap/db-01/20251207T0215
20251208T0215 42031002198 /tank/snap/db-01/20251208T0215
20251209T0215 41883507197 /tank/snap/db-01/20251209T0215
20251210T0215 41874694704 /tank/snap/db-01/20251210T0215
20251211T0215 45159808373 /tank/snap/db-01/20251211T0215
20251212T0215 46930071773 /tank/snap/db-01/20251212T0215
20251213T0215 48297859001 /tank/snap/db-01/20251213T0215
20251214T0215 47977876875 /tank/snap/db-01/20251214T0215
20251215T0215 40516083245 /tank/snap/db-01/20251215T0215
20251216T0215 47514610433 /tank/snap/db-01/20251216T0215
20251217T0215 42463091103 /tank/snap/db-01/20251217T0215
20251218T0215 49800072630 /tank/snap/db-01/20251218T0215
20251219T0215 42103262829 /tank/snap/db-01/20251219T0215
20251220T0215 40821868626 /tank/snap/db-01/20251220T0215
20251221T0215 49831129269 /tank/snap/db-01/20251221T0215
20251222T0215 49443895565 /tank/snap/db-01/20251222T0215
20251223T0215 41790943439 /tank/snap/db-01/20251223T0215
20251224T0215 46065053134 /tank/snap/db-01/20251224T0215
20251225T0215 42862640127 /tank/snap/db-01/20251225T0215
20251226T0215 46274259811 /tank/snap/db-01/20251226T0215
20251227T0215 44862845719 /tank/snap/db-01/20251227T0215
20251228T0215 45328273079 /tank/snap/db-01/20251228T0215
20251229T0215 46050459788 /tank/snap/db-01/20251229T0215
20251230T0215 48957285895 /tank/snap/db-01/20251230T0215
20251231T0215 47068240130 /tank/snap/db-01/20251231T0215
20260101T0215 42971411876 /tank/snap/db-01/20260101T0215
20260102T0215 46973858563 /tank/snap/db-01/20260102T0215
20260103T0215 46736285587 /tank/snap/db-01/20260103T0215
20260104T0215 46205891734 /tank/snap/db-01/20260104T0215
20260105T0215 40312604809 /tank/snap/db-01/20260105T0215
20260106T0215 49893770074 /tank/snap/db-01/20260106T0215
20260107T0215 48886600549 /tank/snap/db-01/20260107T0215
20260108T0215 45984290964 /tank/snap/db-01/20260108T0215
20260109T0215 42991295870 /tank/snap/db-01/20260109T0215
20260110T0215 46277651696 /tank/snap/db-01/20260110T0215
20260111T0215 41762657649 /tank/snap/db-01/20260111T0215
20260112T0215 47659110839 /tank/snap/db-01/20260112T0215
20260113T0215 40973146444 /tank/snap/db-01/20260113T0215
20260114T0215 48351113320 /tank/snap/db-01/20260114T0215
20260115T0215 47748279591 /tank/snap/db-01/20260115T0215
20260116T0215 45799493249 /tank/snap/db-01/20260116T0215
20260117T0215 49224694183 /tank/snap/db-01/20260117T0215
20260118T0215 40230819726 /tank/snap/db-01/20260118T0215
20260119T0215 42587139419 /tank/snap/db-01/20260119T0215
20260120T0215 42527783413 /tank/snap/db-01/20260120T0215
20260121T0215 45965058250 /tank/snap/db-01/20260121T0215
20260122T0215 44429437159 /tank/snap/db-01/20260122T0215
20260123T0215 45227662161 /tank/snap/db-01/20260123T0215
20260124T0215 41663686287 /tank/snap/db-01/20260124T0215
20260125T0215 42607286322 /tank/snap/db-01/20260125T0215
20260126T0215 45761117145 /tank/snap/db-01/20260126T0215
20260127T0215 49266284121 /tank/snap/db-01/20260127T0215
20260128T0215 47320823774 /tank/snap/db-01/20260128T0215
20260129T0215 45476528565 /tank/snap/db-01/20260129T0215
20260130T0215 49974386218 /tank/snap/db-01/20260130T0215
20260131T0215 47943191482 /tank/snap/db-01/20260131T0215
20260201T0215 41784535042 /tank/snap/db-01/20260201T0215
20260202T0215 47211613832 /tank/snap/db-01/20260202T0215
20260203T0215 46049355748 /tank/snap/db-01/20260203T0215
20260204T0215 41592780126 /tank/snap/db-01/20260204T0215
20260205T0215 46408421757 /tank/snap/db-01/20260205T0215
20260206T0215 49750140915 /tank/snap/db-01/20260206T0215
20260207T0215 45101928620 /tank/snap/db-01/20260207T0215
20260208T0215 48405740426 /tank/snap/db-01/20260208T0215
20260209T0215 47980911098 /tank/snap/db-01/20260209T0215
20260210T0215 49892386627 /tank/snap/db-01/20260210T0215
20260211T0215 48291153633 /tank/snap/db-01/20260211T0215
20260212T0215 48663173534 /tank/snap/db-01/20260212T0215
20260213T0215 41888198414 /tank/snap/db-01/20260213T0215
20260214T0215 47629250093 /tank/snap/db-01/20260214T0215
20260215T0215 48396480713 /tank/snap/db-01/20260215T0215
20260216T0215 45613444173 /tank/snap/db-01/20260216T0215
20260217T0215 48780438373 /tank/snap/db-01/20260217T0215
20260218T0215 45416653928 /tank/snap/db-01/20260218T0215
20260219T0215 49273300705 /tank/snap/db-01/20260219T0215
20260220T0215 41570851764 /tank/snap/db-01/20260220T0215
20260221T0215 40436776605 /tank/snap/db-01/20260221T0215
20260222T0215 42353445193 /tank/snap/db-01/20260222T0215
20260223T0215 43595230554 /tank/snap/db-01/20260223T0215
20260224T0215 46248064690 /tank/snap/db-01/20260224T0215
20260225T0215 43463874694 /tank/snap/db-01/20260225T0215
20260226T0215 45953818191 /tank/snap/db-01/20260226T0215
20260227T0215 49158864395 /tank/snap/db-01/20260227T0215
20260228T0215 41555389620 /tank/snap/db-01/20260228T0215
20260301T0215 44142702841 /tank/snap/db-01/20260301T0215
20260302T0215 47283271521 /tank/snap/db-01/20260302T0215
20260303T0215 47688202335 /tank/snap/db-01/20260303T0215
20260304T0215 45904235327 /tank/snap/db-01/20260304T0215
20260305T0215 40378227830 /tank/snap/db-01/20260305T0215
20260306T0215 49990164033 /tank/snap/db-01/20260306T0215
20260307T0215 47433205798 /tank/snap/db-01/20260307T0215
20260308T0215 42152882656 /tank/snap/db-01/20260308T0215
20260309T0215 42701124824 /tank/snap/db-01/20260309T0215
20260310T0215 49352238593 /tank/snap/db-01/20260310T0215
20260311T0215 44926221373 /tank/snap/db-01/20260311T0215
20260312T0215 47452358020 /tank/snap/db-01/20260312T0215
20260313T0215 44677170508 /tank/snap/db-01/20260313T0215
20260314T0215 47247861637 /tank/snap/db-01/20260314T0215
20260315T0215 41826026359 /tank/snap/db-01/20260315T0215
20260316T0215 49783336506 /tank/snap/db-01/20260316T0215
20260317T0215 40650991570 /tank/snap/db-01/20260317T0215
20260318T0215 45313403340 /tank/snap/db-01/20260318T0215
20260319T0215 42742578564 /tank/snap/db-01/20260319T0215
20260320T0215 47300098332 /tank/snap/db-01/20260320T0215
20260321T0215 49320443215 /tank/snap/db-01/20260321T0215
20260322T0215 45197197430 /tank/snap/db-01/20260322T0215
20260323T0215 48926956095 /tank/snap/db-01/20260323T0215
20260324T0215 42242239388 /tank/snap/db-01/20260324T0215
20260325T0215 45558329642 /tank/snap/db-01/20260325T0215
20260326T0215 47336577430 /tank/snap/db-01/20260326T0215
20260327T0215 42921643031 /tank/snap/db-01/20260327T0215
20260328T0215 40386451947 /tank/snap/db-01/20260328T0215
20260329T0215 48675556668 /tank/snap/db-01/20260329T0215
20260330T0215 47163668937 /tank/snap/db-01/20260330T0215
20260331T0215 50365659677 /tank/snap/db-01/20260331T0215
20260401T0215 49556767218 /tank/snap/db-01/20260401T0215
20260402T0215 41485826463 /tank/snap/db-01/20260402T0215
20260403T0215 41846838089 /tank/snap/db-01/20260403T0215
20260404T0215 42103174071 /tank/snap/db-01/20260404T0215
20260405T0215 40384747612 /tank/snap/db-01/20260405T0215
20260406T0215 41152997748 /tank/snap/db-01/20260406T0215
20260407T0215 46520344387 /tank/snap/db-01/20260407T0215
20260408T0215 39716126298 /tank/snap/db-01/20260408T0215
20260409T0215 41784222957 /tank/snap/db-01/20260409T0215
20260504T0215 47972721765 /tank/snap/db-01/20260504T0215
20260505T0215 44145748964 /tank/snap/db-01/20260505T0215
20260506T0215 47883726692 /tank/snap/db-01/20260506T0215
20260507T0215 47753740349 /tank/snap/db-01/20260507T0215
20260508T0215 44797083500 /tank/snap/db-01/20260508T0215
20260509T0215 43134673022 /tank/snap/db-01/20260509T0215
20260510T0215 49601609439 /tank/snap/db-01/20260510T0215
20260511T0215 44918023064 /tank/snap/db-01/20260511T0215
20260512T0215 44378553953 /tank/snap/db-01/20260512T0215
20260513T0215 42709411367 /tank/snap/db-01/20260513T0215
20260514T0215 46380262467 /tank/snap/db-01/20260514T0215
20260515T0215 40303265424 /tank/snap/db-01/20260515T0215
20260516T0215 45427289503 /tank/snap/db-01/20260516T0215
20260517T0215 44123477914 /tank/snap/db-01/20260517T0215
20260518T0215 50609124339 /tank/snap/db-01/20260518T0215
20260519T0215 41802296130 /tank/snap/db-01/20260519T0215
20260520T0215 40504460478 /tank/snap/db-01/20260520T0215
20260521T0215 49023411503 /tank/snap/db-01/20260521T0215
20260522T0215 49432753249 /tank/snap/db-01/20260522T0215
20260523T0215 46029566629 /tank/snap/db-01/20260523T0215
20260524T0215 47951901189 /tank/snap/db-01/20260524T0215
20260525T0215 50297880029 /tank/snap/db-01/20260525T0215
20260526T0215 43761671831 /tank/snap/db-01/20260526T0215
20260527T0215 46384702516 /tank/snap/db-01/20260527T0215
20260528T0215 43431317641 /tank/snap/db-01/20260528T0215
20260529T0215 45175165230 /tank/snap/db-01/20260529T0215
20260530T0215 46704238895 /tank/snap/db-01/20260530T0215
20260531T0215 45525815875 /tank/snap/db-01/20260531T0215
20260601T0215 46583846356 /tank/snap/db-01/20260601T0215
20260602T0215 43638033196 /tank/snap/db-01/20260602T0215
20260603T0215 49370721276 /tank/snap/db-01/20260603T0215
20260604T0215 48623455635 /tank/snap/db-01/20260604T0215
20260605T0215 43101867231 /tank/snap/db-01/20260605T0215
20260606T0215 43719376262 /tank/snap/db-01/20260606T0215
20260607T0215 40979158670 /tank/snap/db-01/20260607T0215
20260608T0215 41756820404 /tank/snap/db-01/20260608T0215
20260609T0215 49944161574 /tank/snap/db-01/20260609T0215
20260610T0215 44503557541 /tank/snap/db-01/20260610T0215
20260611T0215 48349003983 /tank/snap/db-01/20260611T0215
20260612T0215 48530963808 /tank/snap/db-01/20260612T0215
20260613T0215 39738326948 /tank/snap/db-01/20260613T0215
20260614T0215 46084975263 /tank/snap/db-01/20260614T0215
20260615T0215 42356885422 /tank/snap/db-01/20260615T0215
20260616T0215 40787567918 /tank/snap/db-01/20260616T0215
20260617T0215 47526249687 /tank/snap/db-01/20260617T0215
20260618T0215 49928233049 /tank/snap/db-01/20260618T0215
20260619T0215 45578844548 /tank/snap/db-01/20260619T0215
20260620T0215 43620364462 /tank/snap/db-01/20260620T0215
20260621T0215 41231015851 /tank/snap/db-01/20260621T0215
20260622T0215 43488585765 /tank/snap/db-01/20260622T0215
20260623T0215 39631587916 /tank/snap/db-01/20260623T0215
20260624T0215 48791549239 /tank/snap/db-01/20260624T0215
20260625T0215 50104685082 /tank/snap/db-01/20260625T0215
20260626T0215 40670558026 /tank/snap/db-01/20260626T0215
20260627T0215 46242227190 /tank/snap/db-01/20260627T0215
20260628T0215 41181888991 /tank/snap/db-01/20260628T0215
20260629T0215 46852815368 /tank/snap/db-01/20260629T0215
20260630T0215 49209275887 /tank/snap/db-01/20260630T0215
20260701T0215 42780882781 /tank/snap/db-01/20260701T0215
20260702T0215 47950579037 /tank/snap/db-01/20260702T0215
20260703T0215 45712825266 /tank/snap/db-01/20260703T0215
20260704T0215 39771215305 /tank/snap/db-01/20260704T0215
20260705T0215 49134433405 /tank/snap/db-01/20260705T0215
20260706T0215 40274232127 /tank/snap/db-01/20260706T0215
20260707T0215 40804447996 /tank/snap/db-01/20260707T0215
20260708T0215 42172851405 /tank/snap/db-01/20260708T0215
20260709T0215 42921390299 /tank/snap/db-01/20260709T0215
20260710T0215 48513978472 /tank/snap/db-01/20260710T0215
20260711T0215 47515056065 /tank/snap/db-01/20260711T0215
20260712T0215 42785747025 /tank/snap/db-01/20260712T0215
20260713T0215 41928875161 /tank/snap/db-01/20260713T0215
20260714T0215 43761826241 /tank/snap/db-01/20260714T0215
20260715T0215 48561560070 /tank/snap/db-01/20260715T0215
20260716T0215 47382960816 /tank/snap/db-01/20260716T0215
20260717T0215 40085279148 /tank/snap/db-01/20260717T0215
20260718T0215 46618848783 /tank/snap/db-01/20260718T0215
20260719T0215 39992916018 /tank/snap/db-01/20260719T0215
20260720T0215 46960362335 /tank/snap/db-01/20260720T0215
20260721T0215 50510408378 /tank/snap/db-01/20260721T0215
20260722T0215 39918058269 /tank/snap/db-01/20260722T0215
20260723T0215 50427184159 /tank/snap/db-01/20260723T0215
20260724T0215 49660728786 /tank/snap/db-01/20260724T0215
20260725T0215 49445444425 /tank/snap/db-01/20260725T0215
20260726T0215 50281673811 /tank/snap/db-01/20260726T0215
20260727T0215 42077987675 /tank/snap/db-01/20260727T0215
20260728T0215 46645146989 /tank/snap/db-01/20260728T0215
20260729T0215 50437923333 /tank/snap/db-01/20260729T0215
20260730T0215 45448521143 /tank/snap/db-01/20260730T0215
20260731T0215 46367408499 /tank/snap/db-01/20260731T0215
20260801T0215 50479222328 /tank/snap/db-01/20260801T0215
20260802T0215 43153705489 /tank/snap/db-01/20260802T0215
20260803T0215 43011697605 /tank/snap/db-01/20260803T0215
20260804T0215 49788835319 /tank/snap/db-01/20260804T0215
20260805T0215 50318270270 /tank/snap/db-01/20260805T0215
20260806T0215 40403391615 /tank/snap/db-01/20260806T0215
20260807T0215 50281637505 /tank/snap/db-01/20260807T0215
20260808T0215 42824705211 /tank/snap/db-01/20260808T0215
20260809T0215 46829533499 /tank/snap/db-01/20260809T0215
20260810T0215 44734140880 /tank/snap/db-01/20260810T0215
20260811T0215 46955359959 /tank/snap/db-01/20260811T0215
20260812T0215 42050101400 /tank/snap/db-01/20260812T0215
20260813T0215 47004837997 /tank/snap/db-01/20260813T0215
20260814T0215 46532130441 /tank/snap/db-01/20260814T0215
20260815T0215 50268155399 /tank/snap/db-01/20260815T0215
20260816T0215 46882083397 /tank/snap/db-01/20260816T0215
20260817T0215 45979903821 /tank/snap/db-01/20260817T0215
20260818T0215 48140013515 /tank/snap/db-01/20260818T0215
20260818T1610 49005528431 /tank/snap/db-01/20260818T1610
20260819T0215 39771345521 /tank/snap/db-01/20260819T0215
20260820T0215 50554554787 /tank/snap/db-01/20260820T0215
20260821T0215 44583363845 /tank/snap/db-01/20260821T0215
20260822T0215 47422962004 /tank/snap/db-01/20260822T0215
20260823T0215 45792244341 /tank/snap/db-01/20260823T0215
20260824T0215 47220993311 /tank/snap/db-01/20260824T0215
20260825T0215 46840703707 /tank/snap/db-01/20260825T0215
20260826T0215 40799510641 /tank/snap/db-01/20260826T0215
20260827T0215 47644073003 /tank/snap/db-01/20260827T0215
20260828T0215 44524679202 /tank/snap/db-01/20260828T0215
20260829T0215 41984981940 /tank/snap/db-01/20260829T0215
20260830T0215 44624567886 /tank/snap/db-01/20260830T0215
20260831T0215 43092806869 /tank/snap/db-01/20260831T0215
20260901T0215 39903827160 /tank/snap/db-01/20260901T0215
20260902T0215 41881538095 /tank/snap/db-01/20260902T0215
20260903T0215 41058443093 /tank/snap/db-01/20260903T0215
20260904T0215 48886158674 /tank/snap/db-01/20260904T0215
20260905T0215 43494423723 /tank/snap/db-01/20260905T0215
20260906T0215 39921720179 /tank/snap/db-01/20260906T0215
20260907T0215 47316836083 /tank/snap/db-01/20260907T0215
20260908T0215 40474033693 /tank/snap/db-01/20260908T0215
20260909T0215 40691252366 /tank/snap/db-01/20260909T0215
20260910T0215 41161235478 /tank/snap/db-01/20260910T0215
20260911T0215 41043212904 /tank/snap/db-01/20260911T0215
20260912T0215 45714006803 /tank/snap/db-01/20260912T0215
20260913T0215 42985256888 /tank/snap/db-01/20260913T0215
20260914T0215 45037810199 /tank/snap/db-01/20260914T0215
20260915T0215 41265198301 /tank/snap/db-01/20260915T0215
20260916T0215 48711229928 /tank/snap/db-01/20260916T0215
20260917T0215 46299679346 /tank/snap/db-01/20260917T0215
20260918T0215 41009358282 /tank/snap/db-01/20260918T0215
20260919T0215 44324252503 /tank/snap/db-01/20260919T0215
20260920T0215 42922230814 /tank/snap/db-01/20260920T0215
20260921T0215 44623935625 /tank/snap/db-01/20260921T0215
20260922T0215 49575595541 /tank/snap/db-01/20260922T0215
20260923T0215 47419710248 /tank/snap/db-01/20260923T0215
20260924T0215 47692593377 /tank/snap/db-01/20260924T0215
20260925T0215 46998635329 /tank/snap/db-01/20260925T0215
20260925T0930 44001847613 /tank/snap/db-01/20260925T0930
20260926T0215 45772616276 /tank/snap/db-01/20260926T0215
20260927T0215 42204825779 /tank/snap/db-01/20260927T0215
20260928T0215 47197195896 /tank/snap/db-01/20260928T0215
20260929T0215 45307598376 /tank/snap/db-01/20260929T0215
20260930T0215 40172290197 /tank/snap/db-01/20260930T0215
20260930T1400 49385064232 /tank/snap/db-01/20260930T1400
20261001T0215 49220625130 /tank/snap/db-01/20261001T0215
manual-before-pg17 45812002816 /tank/snap/db-01/manual-before-pg17
__FX__
mkdir -p var/manifests
cat > var/manifests/files-02.manifest <<'__FX__'
# files-02: exported by snapd 2026-10-01 23:50 UTC
20250105T0300 300390011013 /tank/snap/files-02/20250105T0300
20250112T0300 312071855009 /tank/snap/files-02/20250112T0300
20250119T0300 318922513664 /tank/snap/files-02/20250119T0300
20250126T0300 340690083444 /tank/snap/files-02/20250126T0300
20250202T0300 292407313526 /tank/snap/files-02/20250202T0300
20250209T0300 294079413280 /tank/snap/files-02/20250209T0300
20250216T0300 284015631765 /tank/snap/files-02/20250216T0300
20250223T0300 292624550477 /tank/snap/files-02/20250223T0300
20250302T0300 341278100252 /tank/snap/files-02/20250302T0300
20250309T0300 314387955904 /tank/snap/files-02/20250309T0300
20250316T0300 305959878206 /tank/snap/files-02/20250316T0300
20250323T0300 355443940401 /tank/snap/files-02/20250323T0300
20250330T0300 296960625887 /tank/snap/files-02/20250330T0300
20250406T0300 329955127403 /tank/snap/files-02/20250406T0300
20250413T0300 281782767117 /tank/snap/files-02/20250413T0300
20250420T0300 315920541748 /tank/snap/files-02/20250420T0300
20250427T0300 334523764491 /tank/snap/files-02/20250427T0300
20250504T0300 344698255897 /tank/snap/files-02/20250504T0300
20250511T0300 318274703860 /tank/snap/files-02/20250511T0300
20250518T0300 329182971358 /tank/snap/files-02/20250518T0300
20250525T0300 309782029033 /tank/snap/files-02/20250525T0300
20250601T0300 341125458121 /tank/snap/files-02/20250601T0300
20250608T0300 313463769794 /tank/snap/files-02/20250608T0300
20250615T0300 343809712768 /tank/snap/files-02/20250615T0300
20250622T0300 284619303584 /tank/snap/files-02/20250622T0300
20250629T0300 332836628720 /tank/snap/files-02/20250629T0300
20250706T0300 321106584013 /tank/snap/files-02/20250706T0300
20250713T0300 281676725090 /tank/snap/files-02/20250713T0300
20250720T0300 354492881164 /tank/snap/files-02/20250720T0300
20250727T0300 339897835493 /tank/snap/files-02/20250727T0300
20250803T0300 338124888182 /tank/snap/files-02/20250803T0300
20250810T0300 353911717176 /tank/snap/files-02/20250810T0300
20250817T0300 292327444792 /tank/snap/files-02/20250817T0300
20250824T0300 338640780613 /tank/snap/files-02/20250824T0300
20250831T0300 356454757988 /tank/snap/files-02/20250831T0300
20250907T0300 297043774366 /tank/snap/files-02/20250907T0300
20250914T0300 284639649555 /tank/snap/files-02/20250914T0300
20250921T0300 284496516377 /tank/snap/files-02/20250921T0300
20250928T0300 290118335202 /tank/snap/files-02/20250928T0300
20251005T0300 288798724949 /tank/snap/files-02/20251005T0300
20251012T0300 299680941567 /tank/snap/files-02/20251012T0300
20251019T0300 353945918918 /tank/snap/files-02/20251019T0300
20251026T0300 322667678237 /tank/snap/files-02/20251026T0300
20251102T0300 322242031932 /tank/snap/files-02/20251102T0300
20251109T0300 330603664756 /tank/snap/files-02/20251109T0300
20251116T0300 332418371081 /tank/snap/files-02/20251116T0300
20251123T0300 292839768767 /tank/snap/files-02/20251123T0300
20251130T0300 348553612992 /tank/snap/files-02/20251130T0300
20251207T0300 300687313020 /tank/snap/files-02/20251207T0300
20251214T0300 347410513103 /tank/snap/files-02/20251214T0300
20251221T0300 353942325056 /tank/snap/files-02/20251221T0300
20251228T0300 348599647224 /tank/snap/files-02/20251228T0300
20260104T0300 309750571191 /tank/snap/files-02/20260104T0300
20260111T0300 321069813907 /tank/snap/files-02/20260111T0300
20260118T0300 352349569738 /tank/snap/files-02/20260118T0300
20260125T0300 281476134002 /tank/snap/files-02/20260125T0300
20260201T0300 299100620613 /tank/snap/files-02/20260201T0300
20260208T0300 296357743979 /tank/snap/files-02/20260208T0300
20260215T0300 325582552120 /tank/snap/files-02/20260215T0300
20260222T0300 349526309311 /tank/snap/files-02/20260222T0300
20260301T0300 287704675734 /tank/snap/files-02/20260301T0300
20260308T0300 349298595652 /tank/snap/files-02/20260308T0300
20260315T0300 328055736661 /tank/snap/files-02/20260315T0300
20260322T0300 284072260499 /tank/snap/files-02/20260322T0300
20260329T0300 311258859202 /tank/snap/files-02/20260329T0300
20260405T0300 305009223163 /tank/snap/files-02/20260405T0300
20260412T0300 342619202077 /tank/snap/files-02/20260412T0300
20260419T0300 341134613693 /tank/snap/files-02/20260419T0300
20260426T0300 338647365510 /tank/snap/files-02/20260426T0300
20260503T0300 336384359539 /tank/snap/files-02/20260503T0300
20260510T0300 321857211530 /tank/snap/files-02/20260510T0300
20260517T0300 355775397956 /tank/snap/files-02/20260517T0300
20260524T0300 304798016787 /tank/snap/files-02/20260524T0300
20260531T0300 356252217531 /tank/snap/files-02/20260531T0300
20260607T0300 327240567446 /tank/snap/files-02/20260607T0300
20260614T0300 350341801882 /tank/snap/files-02/20260614T0300
20260621T0300 316325574160 /tank/snap/files-02/20260621T0300
20260628T0300 302521596193 /tank/snap/files-02/20260628T0300
20260705T0300 300055966616 /tank/snap/files-02/20260705T0300
20260712T0300 320110936403 /tank/snap/files-02/20260712T0300
20260719T0300 351239362001 /tank/snap/files-02/20260719T0300
20260726T0300 279140095949 /tank/snap/files-02/20260726T0300
20260802T0300 287175567061 /tank/snap/files-02/20260802T0300
20260809T0300 282783463687 /tank/snap/files-02/20260809T0300
20260816T0300 298682914987 /tank/snap/files-02/20260816T0300
20260823T0300 350921753287 /tank/snap/files-02/20260823T0300
20260830T0300 298681817889 /tank/snap/files-02/20260830T0300
20260906T0300 314061330199 /tank/snap/files-02/20260906T0300
20260913T0300 318842478633 /tank/snap/files-02/20260913T0300
20260920T0300 316522081733 /tank/snap/files-02/20260920T0300
20260921T0300 297726016879 /tank/snap/files-02/20260921T0300
20260922T0300 305694452092 /tank/snap/files-02/20260922T0300
20260923T0300 309501421392 /tank/snap/files-02/20260923T0300
20260924T0300 346701792419 /tank/snap/files-02/20260924T0300
20260925T0300 317144651353 /tank/snap/files-02/20260925T0300
20260926T0300 340142227352 /tank/snap/files-02/20260926T0300
20260927T0300 322319295347 /tank/snap/files-02/20260927T0300
20260928T0300 294282182395 /tank/snap/files-02/20260928T0300
20260929T0300 319259211883 /tank/snap/files-02/20260929T0300
20260930T0300 296019680738 /tank/snap/files-02/20260930T0300
20261001T0300 338911881611 /tank/snap/files-02/20261001T0300
__FX__
KEEPSET_LOG=/dev/null bin/keepset plan var/manifests/*.manifest >/dev/null 2>&1 </dev/null
touch -t 202610020030 var/plan/*.plan
