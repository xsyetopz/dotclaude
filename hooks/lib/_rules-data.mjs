// Bash guard rules for destructive database statements and test snapshot
// updates.

// --- databases --------------------------------------------------------------

const SQL_DESTRUCTIVE =
  /\b(drop\s+(table|database|schema|index|view)|truncate\s+(table\s+)?\w|delete\s+from\s+[\w."`]+\s*(;|$|\)|'|")|flushall|flushdb|\.drop(database)?\(\))/i;

export const DB_CLIENTS = [
  "psql",
  "mysql",
  "mariadb",
  "sqlite3",
  "duckdb",
  "clickhouse-client",
  "clickhouse",
  "mongosh",
  "mongo",
  "redis-cli",
  "sqlcmd",
  "cockroach",
  "turso",
];

const DB_RESET =
  /\b(dropdb|prisma\s+migrate\s+reset|prisma\s+db\s+push\s+.*--force-reset|db:drop|db:reset|migrate:fresh|migrate:reset|flush\s+--no-input)\b/;

export function db(cmd) {
  const text = `${cmd.args.join(" ")}\n${cmd.heredoc ?? ""}`;
  return SQL_DESTRUCTIVE.test(text)
    ? [
        [
          "ask",
          `\`${cmd.name}\` runs a destructive statement (DROP, TRUNCATE, or DELETE without WHERE)`,
        ],
      ]
    : [];
}

export function dbReset(cmd) {
  return DB_RESET.test([cmd.name, ...cmd.args].join(" "))
    ? [["ask", "command drops or resets a database"]]
    : [];
}

// --- snapshot blessing ------------------------------------------------------

const RUNNERS =
  /\b(jest|vitest|playwright|pytest|go\s+test|flutter\s+test|ava|mocha|bun\s+test|swift\s+test)\b/;

const BLESS_FLAGS = new Set([
  "-u",
  "--updateSnapshot",
  "--update-snapshots",
  "--snapshot-update",
  "--update-goldens",
  "-update",
  "--update",
]);

const BLESS_ENV = new Set([
  "UPDATE_EXPECT",
  "INSTA_UPDATE",
  "UPDATE_SNAPSHOTS",
  "SNAPSHOT_UPDATE",
  "UPDATE_GOLDEN",
  "BLESS",
  "TRYBUILD",
  "SNAPSHOTS",
]);

export function snapshotBless(cmd) {
  const joined = [cmd.name, ...cmd.args].join(" ");
  if (/\b(cargo\s+insta|insta)\s+(accept|review)\b/.test(joined))
    return [["ask", "`insta accept` overwrites expected snapshots"]];
  if (
    Object.entries(cmd.assigns).some(
      ([k, v]) => BLESS_ENV.has(k) && !["", "0", "no", "false"].includes(v),
    )
  ) {
    return [["ask", "environment variable rewrites expected test output"]];
  }
  if (
    cmd.name !== "git" &&
    RUNNERS.test(joined) &&
    cmd.args.some((a) => BLESS_FLAGS.has(a))
  ) {
    return [
      ["ask", "test run with snapshot update overwrites expected output"],
    ];
  }
  return [];
}
