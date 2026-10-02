#!/usr/bin/env bash
# snapkeep: bash snapshot/prune CLI. HEAD is the feature branch feat/keep-daily
# (lib/prune.sh) with seven reviewer findings in the untracked REVIEW.md. Item 1
# is a cross-cutting rule (die with lib/exitcodes.sh codes, no bare exit in lib/)
# that the later fixes must follow. test/run.sh writes .check/result.txt with a
# digest of the end-to-end retention scenario.
set -euo pipefail

export GIT_AUTHOR_NAME="Tomasz Wrona" GIT_AUTHOR_EMAIL="tomasz@snapkeep.dev"
export GIT_COMMITTER_NAME="Tomasz Wrona" GIT_COMMITTER_EMAIL="tomasz@snapkeep.dev"
git init -q -b main
git config commit.gpgsign false
commit() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git commit -q -m "$2"; }

# --- snapkeep 0.4.0
cat > .gitignore <<'__FX__'
.check/
*.swp
__FX__
cat > README.md <<'__FX__'
# snapkeep

Keeps dated copies of a directory and prunes old ones. Plain bash, no
dependencies beyond coreutils. Runs nightly from a systemd timer on the build
boxes (see `contrib/`).

```
snapkeep create --from /srv/artifacts
snapkeep list
snapkeep prune --keep-daily 7
```

Snapshots live in `SNAPKEEP_DIR` (or `snapshot_dir=` in `/etc/snapkeep.conf`)
and are named `snap-YYYY-MM-DD`, `snap-YYYY-MM-DD.N` for further snapshots the
same day, or `snap-YYYY-MM-DD <label>` for manual ones.

Exit codes follow sysexits; see `lib/exitcodes.sh`.

## Development

`test/run.sh` runs the tests and the retention scenario; CI runs the same
script. `shellcheck bin/snapkeep lib/*.sh` should stay clean.
__FX__
cat > CHANGELOG.md <<'__FX__'
# Changelog

## Unreleased

## 0.4.0 - 2026-01-19

- `create --label` for manual snapshots.
- Exit codes now follow sysexits (`lib/exitcodes.sh`).

## 0.3.0 - 2025-11-02

- `list` prints oldest first.
- Config file support (`snapshot_dir=`).
__FX__
mkdir -p lib
cat > lib/exitcodes.sh <<'__FX__'
# shellcheck shell=bash
# Exit codes (sysexits.h). The systemd unit and the monitoring check map these to
# alerts, so every failure path must exit with one of them via die().
EX_OK=0
EX_USAGE=64      # bad command line: unknown command/option, invalid option value
EX_NOINPUT=66    # snapshot dir missing or not a directory
EX_SOFTWARE=70   # internal error
EX_CANTCREAT=73  # could not create a snapshot
EX_TEMPFAIL=75   # another snapkeep run holds the lock; retry later
EX_CONFIG=78     # config file problem
__FX__
mkdir -p lib
cat > lib/common.sh <<'__FX__'
# shellcheck shell=bash
# Logging and error helpers shared by all subcommands.

log() {
  [ "${SNAPKEEP_QUIET:-0}" = 1 ] && return 0
  printf '%s\n' "$*"
}

warn() {
  printf 'snapkeep: %s\n' "$*" >&2
}

# die <exit-code> <message...>
die() {
  local code=$1
  shift
  printf 'snapkeep: %s\n' "$*" >&2
  exit "$code"
}
__FX__
mkdir -p lib
cat > lib/config.sh <<'__FX__'
# shellcheck shell=bash
# Config: SNAPKEEP_DIR wins, otherwise snapshot_dir= from the config file.

SNAPKEEP_CONFIG=${SNAPKEEP_CONFIG:-/etc/snapkeep.conf}

config_get() {
  local key=$1 line
  [ -r "$SNAPKEEP_CONFIG" ] || return 1
  while IFS= read -r line; do
    case "$line" in
      "$key="*) printf '%s\n' "${line#*=}"; return 0 ;;
    esac
  done < "$SNAPKEEP_CONFIG"
  return 1
}

snapshot_dir() {
  local dir=${SNAPKEEP_DIR:-}
  if [ -z "$dir" ]; then
    dir=$(config_get snapshot_dir) || die "$EX_CONFIG" "no snapshot_dir in $SNAPKEEP_CONFIG and SNAPKEEP_DIR is unset"
  fi
  [ -d "$dir" ] || die "$EX_NOINPUT" "snapshot dir $dir does not exist"
  printf '%s\n' "$dir"
}
__FX__
mkdir -p lib
cat > lib/lock.sh <<'__FX__'
# shellcheck shell=bash
# One snapkeep run per snapshot dir. mkdir is atomic, so it doubles as the lock.

acquire_lock() {
  local dir=$1
  if ! mkdir "$dir/.snapkeep.lock" 2>/dev/null; then
    echo "snapkeep: $dir is locked by another run" >&2
    exit 1
  fi
}

release_lock() {
  rmdir "$1/.snapkeep.lock" 2>/dev/null || true
}
__FX__
mkdir -p lib
cat > lib/list.sh <<'__FX__'
# shellcheck shell=bash

cmd_list() {
  [ $# -eq 0 ] || die "$EX_USAGE" "list takes no arguments"
  local dir s n=0
  dir=$(snapshot_dir)
  for s in $(ls -1 "$dir" | grep '^snap-'); do
    printf '%s\n' "$s"
    n=$((n + 1))
  done
  [ "$n" -gt 0 ] || warn "no snapshots in $dir"
}
__FX__
mkdir -p lib
cat > lib/create.sh <<'__FX__'
# shellcheck shell=bash

# Snapshot names are snap-YYYY-MM-DD, optionally followed by ".N" for further
# snapshots on the same day, or by " <label>" for manual ones.
cmd_create() {
  local label="" src="" dir day name n
  while [ $# -gt 0 ]; do
    case "$1" in
      --label) label=${2:-}; [ -n "$label" ] || die "$EX_USAGE" "--label needs a value"; shift 2 ;;
      --from) src=${2:-}; [ -d "$src" ] || die "$EX_USAGE" "--from needs a directory"; shift 2 ;;
      *) die "$EX_USAGE" "create: unknown option $1" ;;
    esac
  done
  [ -n "$src" ] || die "$EX_USAGE" "create: --from is required"
  dir=$(snapshot_dir)
  day=${SNAPKEEP_TODAY:-$(date +%Y-%m-%d)}
  name="snap-$day"
  if [ -n "$label" ]; then
    name="$name $label"
  else
    n=1
    while [ -e "$dir/$name" ]; do
      n=$((n + 1))
      name="snap-$day.$n"
    done
  fi
  [ ! -e "$dir/$name" ] || die "$EX_CANTCREAT" "$name already exists"
  acquire_lock "$dir"
  cp -R "$src" "$dir/$name" || { release_lock "$dir"; die "$EX_CANTCREAT" "copy failed"; }
  release_lock "$dir"
  log "created $name"
}
__FX__
mkdir -p bin
cat > bin/snapkeep <<'__FX__'
#!/usr/bin/env bash
# snapkeep: keep dated directory snapshots and prune old ones.
set -euo pipefail

SNAPKEEP_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SNAPKEEP_HOME/lib/exitcodes.sh"
. "$SNAPKEEP_HOME/lib/common.sh"
. "$SNAPKEEP_HOME/lib/config.sh"
. "$SNAPKEEP_HOME/lib/lock.sh"
. "$SNAPKEEP_HOME/lib/list.sh"
. "$SNAPKEEP_HOME/lib/create.sh"

SNAPKEEP_VERSION=0.4.0

usage() {
  cat <<USAGE
usage: snapkeep <command> [options]

commands:
  list                         list snapshots, oldest first
  create --from DIR [--label L]
                               copy DIR into a new snapshot for today
  version                      print the version

The snapshot directory comes from SNAPKEEP_DIR or snapshot_dir= in
\$SNAPKEEP_CONFIG (default /etc/snapkeep.conf).
USAGE
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  list) cmd_list "$@" ;;
  create) cmd_create "$@" ;;
  version) echo "snapkeep $SNAPKEEP_VERSION" ;;
  -h | --help | help) usage ;;
  '') usage >&2; die "$EX_USAGE" "missing command" ;;
  *) usage >&2; die "$EX_USAGE" "unknown command: $cmd" ;;
esac
__FX__
chmod +x bin/snapkeep
mkdir -p etc
cat > etc/snapkeep.conf.example <<'__FX__'
# /etc/snapkeep.conf
snapshot_dir=/var/backups/snapkeep
__FX__
mkdir -p test
cat > test/lib.sh <<'__FX__'
# shellcheck shell=bash
# Helpers for test/*.t.sh. Each test file runs in its own subshell with a fresh
# snapshot dir in $SNAPKEEP_DIR.

SK="$ROOT/bin/snapkeep"

mksnap() {
  local n
  for n in "$@"; do mkdir -p "$SNAPKEEP_DIR/$n" && echo "$n" > "$SNAPKEEP_DIR/$n/marker"; done
}

snaps() {
  ( cd "$SNAPKEEP_DIR" && for s in snap-*; do [ -d "$s" ] && printf '%s|' "$s"; done; echo )
}

check() {
  local name=$1 want=$2 got=$3
  if [ "$want" = "$got" ]; then
    echo "ok - $name"
    PASSED=$((PASSED + 1))
  else
    echo "not ok - $name"
    echo "  want: $want"
    echo "  got:  $got"
    FAILED=$((FAILED + 1))
  fi
}
__FX__
mkdir -p test
cat > test/cli.t.sh <<'__FX__'
# shellcheck shell=bash

out=$("$SK" version)
check "version" "snapkeep 0.4.0" "$out"

"$SK" bogus >/dev/null 2>&1 && code=0 || code=$?
check "unknown command is a usage error" 64 "$code"

SNAPKEEP_DIR=/nonexistent "$SK" list >/dev/null 2>&1 && code=0 || code=$?
check "missing snapshot dir" 66 "$code"
__FX__
mkdir -p test
cat > test/create.t.sh <<'__FX__'
# shellcheck shell=bash

src=$(mktemp -d)
echo hello > "$src/file"
SNAPKEEP_TODAY=2026-03-01 "$SK" create --from "$src" >/dev/null
SNAPKEEP_TODAY=2026-03-01 "$SK" create --from "$src" >/dev/null
check "second snapshot on a day gets .2" "snap-2026-03-01|snap-2026-03-01.2|" "$(snaps)"

SNAPKEEP_TODAY=2026-03-02 "$SK" create --from "$src" --label before-upgrade >/dev/null
check "labelled snapshot" "hello" "$(cat "$SNAPKEEP_DIR/snap-2026-03-02 before-upgrade/file")"
rm -rf "$src"
__FX__
mkdir -p test
cat > test/list.t.sh <<'__FX__'
# shellcheck shell=bash

mksnap snap-2026-01-02 snap-2026-01-01 snap-2026-01-03
check "list is oldest first" "snap-2026-01-01 snap-2026-01-02 snap-2026-01-03" "$("$SK" list | tr '\n' ' ' | sed 's/ $//')"
__FX__
mkdir -p test
cat > test/run.sh <<'__FX__'
#!/usr/bin/env bash
# CI entry point: runs test/*.t.sh.
# Summary goes to .check/result.txt.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT
PASSED=0
FAILED=0

counts=$(mktemp)
for t in "$ROOT"/test/*.t.sh; do
  echo "# ${t##*/}"
  (
    SNAPKEEP_DIR=$(mktemp -d)
    export SNAPKEEP_DIR
    PASSED=0 FAILED=0
    . "$ROOT/test/lib.sh"
    . "$t"
    echo "$PASSED $FAILED" >> "$counts"
    rm -rf "$SNAPKEEP_DIR"
  )
done
while read -r p f; do
  PASSED=$((PASSED + p))
  FAILED=$((FAILED + f))
done < "$counts"
rm -f "$counts"

echo "tests: $PASSED passed, $FAILED failed"

mkdir -p "$ROOT/.check"
printf 'tests: %s passed, %s failed\n' "$PASSED" "$FAILED" > "$ROOT/.check/result.txt"
[ "$FAILED" -eq 0 ]
__FX__
git add -A
commit "2026-01-19T09:00:00Z" "snapkeep 0.4.0"

# --- contrib: systemd units and monitoring check
mkdir -p contrib
cat > contrib/snapkeep.service <<'__FX__'
[Unit]
Description=snapkeep nightly snapshot and prune

[Service]
Type=oneshot
ExecStart=/usr/local/bin/snapkeep create --from /srv/artifacts
ExecStart=/usr/local/bin/snapkeep prune --keep-daily 14
# EX_TEMPFAIL (75): another run holds the lock, try again on the next timer tick.
SuccessExitStatus=75
__FX__
mkdir -p contrib
cat > contrib/snapkeep.timer <<'__FX__'
[Unit]
Description=Run snapkeep nightly

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
__FX__
mkdir -p contrib
cat > contrib/check_snapkeep.sh <<'__FX__'
#!/usr/bin/env bash
# Monitoring check: maps the last snapkeep exit status to an alert level.
status=$(systemctl show -p ExecMainStatus --value snapkeep.service)
case "$status" in
  0 | 75) echo "OK - snapkeep exit $status"; exit 0 ;;
  64 | 78) echo "WARNING - snapkeep misconfigured (exit $status)"; exit 1 ;;
  *) echo "CRITICAL - snapkeep exit $status"; exit 2 ;;
esac
__FX__
chmod +x contrib/check_snapkeep.sh
git add -A
commit "2026-02-02T16:20:00Z" "contrib: systemd units and monitoring check"

# --- prune: --keep-daily retention
git checkout -q -b feat/keep-daily
mkdir -p lib
cat > lib/prune.sh <<'__FX__'
# shellcheck shell=bash
# prune: keep the snapshots of the most recent days, delete the rest.

cmd_prune() {
  local keep=7 dry=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep-daily) keep=${2:-}; shift 2 ;;
      --dry-run) dry=1; shift ;;
      *) die "$EX_USAGE" "prune: unknown option $1" ;;
    esac
  done
  case "$keep" in
    '' | *[!0-9]*) keep=0 ;;
  esac

  local dir s kept=0
  dir=$(snapshot_dir)
  acquire_lock "$dir"
  # newest first
  for s in $(ls -1r "$dir" | grep '^snap-'); do
    if [ "$kept" -lt "$keep" ]; then
      kept=$((kept + 1))
      log "keep   $s"
      continue
    fi
    if [ "$dry" = 1 ]; then
      log "would delete $s"
    fi
    rm -rf "${dir:?}/$s"
    log "delete $s"
  done
  release_lock "$dir"
}
__FX__
mkdir -p bin
cat > bin/snapkeep <<'__FX__'
#!/usr/bin/env bash
# snapkeep: keep dated directory snapshots and prune old ones.
set -euo pipefail

SNAPKEEP_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SNAPKEEP_HOME/lib/exitcodes.sh"
. "$SNAPKEEP_HOME/lib/common.sh"
. "$SNAPKEEP_HOME/lib/config.sh"
. "$SNAPKEEP_HOME/lib/lock.sh"
. "$SNAPKEEP_HOME/lib/list.sh"
. "$SNAPKEEP_HOME/lib/create.sh"
. "$SNAPKEEP_HOME/lib/prune.sh"

SNAPKEEP_VERSION=0.5.0-dev

usage() {
  cat <<USAGE
usage: snapkeep <command> [options]

commands:
  list                         list snapshots, oldest first
  create --from DIR [--label L]
                               copy DIR into a new snapshot for today
  prune [--keep-daily N] [--dry-run]
                               apply the retension policy (default: 7 days)
  version                      print the version

The snapshot directory comes from SNAPKEEP_DIR or snapshot_dir= in
\$SNAPKEEP_CONFIG (default /etc/snapkeep.conf).
USAGE
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  list) cmd_list "$@" ;;
  create) cmd_create "$@" ;;
  prune) cmd_prune "$@" ;;
  version) echo "snapkeep $SNAPKEEP_VERSION" ;;
  -h | --help | help) usage ;;
  '') usage >&2; die "$EX_USAGE" "missing command" ;;
  *) usage >&2; die "$EX_USAGE" "unknown command: $cmd" ;;
esac
__FX__
chmod +x bin/snapkeep
mkdir -p test
cat > test/cli.t.sh <<'__FX__'
# shellcheck shell=bash

out=$("$SK" version)
check "version" "snapkeep 0.5.0-dev" "$out"

"$SK" bogus >/dev/null 2>&1 && code=0 || code=$?
check "unknown command is a usage error" 64 "$code"

SNAPKEEP_DIR=/nonexistent "$SK" list >/dev/null 2>&1 && code=0 || code=$?
check "missing snapshot dir" 66 "$code"
__FX__
mkdir -p test
cat > test/prune.t.sh <<'__FX__'
# shellcheck shell=bash

mksnap snap-2026-02-01 snap-2026-02-02 snap-2026-02-03 snap-2026-02-04 snap-2026-02-05
"$SK" prune --keep-daily 3 >/dev/null
check "prune keeps the newest days" "snap-2026-02-03|snap-2026-02-04|snap-2026-02-05|" "$(snaps)"

"$SK" prune --keep-daily 2 --bogus >/dev/null 2>&1 && code=0 || code=$?
check "prune rejects unknown options" 64 "$code"
check "rejected prune deletes nothing" "snap-2026-02-03|snap-2026-02-04|snap-2026-02-05|" "$(snaps)"
__FX__
mkdir -p docs
cat > docs/retention.md <<'__FX__'
# Retention

`snapkeep prune --keep-daily N` keeps the newest snapshot of each of the N most
recent days that have a snapshot, and deletes everything else. The day comes from
the snapshot name, not from file times (copies keep the source mtimes).

`--dry-run` prints what would be kept and deleted without touching anything.

Default: `--keep-daily 7`.

The nightly timer runs `snapkeep create` and then `snapkeep prune`; both take the
lock, so a slow copy makes prune exit with EX_TEMPFAIL and the timer retries.
__FX__
git add -A
commit "2026-02-24T11:05:00Z" "prune: --keep-daily retention"

# --- test: end-to-end retention scenario in test/run.sh
mkdir -p test
cat > test/scenario.sh <<'__FX__'
#!/usr/bin/env bash
# End-to-end retention scenario. Prints one line per step: exit code and the
# snapshots left afterwards. test/run.sh records a digest of this output.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SK="$ROOT/bin/snapkeep"
export SNAPKEEP_DIR SNAPKEEP_QUIET=1
SNAPKEEP_DIR=$(mktemp -d)

seed() {
  rm -rf "${SNAPKEEP_DIR:?}"/snap-*
  local n
  for n in snap-2026-02-10 snap-2026-02-20 snap-2026-02-20.2 snap-2026-02-25 \
    "snap-2026-02-27 pre-upgrade" snap-2026-02-28 snap-2026-03-01 snap-2026-03-01.2; do
    mkdir -p "$SNAPKEEP_DIR/$n"
  done
}

left() {
  ( cd "$SNAPKEEP_DIR" && for s in snap-*; do [ -d "$s" ] && printf '%s|' "$s"; done )
}

step() {
  local name=$1 code
  shift
  "$@" >/dev/null 2>&1 && code=0 || code=$?
  printf '%-12s exit=%-3s left=%s\n' "$name" "$code" "$(left)"
}

seed; printf '%-12s lines=%s\n' list "$("$SK" list 2>/dev/null | grep -c .)"
seed; step dry-run "$SK" prune --keep-daily 3 --dry-run
seed; step keep-3 "$SK" prune --keep-daily 3
seed; step keep-0 "$SK" prune --keep-daily 0
seed; step negative "$SK" prune --keep-daily -1
seed; step not-a-number "$SK" prune --keep-daily three
seed; mkdir "$SNAPKEEP_DIR/.snapkeep.lock"; step locked "$SK" prune --keep-daily 3; rmdir "$SNAPKEEP_DIR/.snapkeep.lock"

rm -rf "$SNAPKEEP_DIR"
__FX__
chmod +x test/scenario.sh
mkdir -p test
cat > test/run.sh <<'__FX__'
#!/usr/bin/env bash
# CI entry point: runs test/*.t.sh, then the retention scenario.
# Summary goes to .check/result.txt.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT
PASSED=0
FAILED=0

counts=$(mktemp)
for t in "$ROOT"/test/*.t.sh; do
  echo "# ${t##*/}"
  (
    SNAPKEEP_DIR=$(mktemp -d)
    export SNAPKEEP_DIR
    PASSED=0 FAILED=0
    . "$ROOT/test/lib.sh"
    . "$t"
    echo "$PASSED $FAILED" >> "$counts"
    rm -rf "$SNAPKEEP_DIR"
  )
done
while read -r p f; do
  PASSED=$((PASSED + p))
  FAILED=$((FAILED + f))
done < "$counts"
rm -f "$counts"

echo "tests: $PASSED passed, $FAILED failed"

echo "# scenario"
scenario=$("$ROOT/test/scenario.sh")
echo "$scenario"
digest=$(printf '%s\n' "$scenario" | git hash-object --stdin | cut -c1-10)
steps=$(printf '%s\n' "$scenario" | grep -c .)
echo "scenario: $steps steps [$digest]"

mkdir -p "$ROOT/.check"
printf 'tests: %s passed, %s failed\nscenario: %s steps [%s]\n' "$PASSED" "$FAILED" "$steps" "$digest" > "$ROOT/.check/result.txt"
[ "$FAILED" -eq 0 ]
__FX__
chmod +x test/run.sh
git add -A
commit "2026-02-26T18:40:00Z" "test: end-to-end retention scenario in test/run.sh"

# --- uncommitted
cat > REVIEW.md <<'__FX__'
Review from Priya on "prune: --keep-daily retention" (copied from the PR)

1. General, applies to everything in this PR: failures have to go through
   `die <code> ...` with the constants from lib/exitcodes.sh, never a bare
   `exit N` in lib/. contrib/check_snapkeep.sh alerts on the exit status, and an
   exit 1 pages whoever is on call.

2. lib/prune.sh: `--keep-daily N` is supposed to keep the newest snapshot of
   each of the N most recent days (that's what docs/retention.md says). The loop
   counts snapshots, so two snapshots on the same day use up two slots.

3. lib/prune.sh: `--dry-run` still deletes. The `rm -rf` runs whether or not we
   are in dry-run mode.

4. lib/prune.sh: `--keep-daily -1` or `--keep-daily three` falls through to
   keep=0 and wipes the box. Invalid values must be rejected without deleting
   anything.

5. `for s in $(ls ...)` in prune.sh and list.sh splits names on spaces, and
   labelled snapshots have a space in the name ("snap-2026-02-27 pre-upgrade").
   They are never pruned and list prints them as two lines.

6. lib/lock.sh: when the lock is held we exit 1. The service file treats 75 as
   "retry next tick", that's the code we want here.

7. lib/prune.sh: even with `--keep-daily 0`, never delete the newest snapshot.
   We always want at least one copy on the box.

8. nit: "retension" in the usage text.

9. Please add a CHANGELOG entry under Unreleased.
__FX__
