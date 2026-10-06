// Edit and Write guard rules. `editReasons(tool, input, existing)` gives the
// reasons to ask before an edit. `existing` is the text of the file before a
// `Write`, or null when the file is new or unreadable.

/** The reason to ask before a `PublishPlugin` call. */
export const PUBLISH_PLUGIN_REASON =
  "This call publishes a plugin to the claude.ai library of the organization. Other people of the organization can then see and install it. Check the plugin and its files before you publish.";

const SETTINGS =
  /(^|\/)\.claude\/settings(\.local)?\.json$|(^|\/)managed-settings(\.d\/[^/]+)?\.json$/;
const GENERATED =
  /\.min\.(js|css)$|(^|\/)(dist|build|out|target|\.next|node_modules|vendor)\/|\.generated\.\w+$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec|specs)\/|(^|\/)test_[^/]+\.py$|_test\.(py|go|rs)$|\.(test|spec)\.[cm]?[jt]sx?$/;
const ASSERT =
  /\bassert\w*\b|\bexpect\s*\(|\bt\.(Error|Fatal|Fail)\w*\(|\bverify\s*\(/g;
const SKIP =
  /\b(it|test|describe)\.(skip|todo|only)\b|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|#\[ignore\]|\bt\.Skip(Now|f)?\(/g;

const REDACTED = /\[REDACTED:/g;

const count = (re, text) => (text.match(re) ?? []).length;

/** The old and new text of an edit, or null for old text of a new file. */
function beforeAfter(tool, input, existing) {
  switch (tool) {
    case "Edit":
      return { before: input.old_string ?? "", after: input.new_string ?? "" };
    case "MultiEdit": {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      return {
        before: edits.map((e) => e.old_string ?? "").join("\n"),
        after: edits.map((e) => e.new_string ?? "").join("\n"),
      };
    }
    default:
      return {
        before: existing,
        after: input.content ?? input.new_source ?? "",
      };
  }
}

export function editReasons(tool, input, existing = null) {
  const file = input.file_path || input.notebook_path || "";
  if (!file) return [];
  const name = `\`${file.split("/").pop()}\``;
  const out = [];
  if (SETTINGS.test(file))
    out.push(
      `${name} holds Claude Code settings. An edit can change permissions or hooks. Make the edit only if the user asked for this change.`,
    );
  if (GENERATED.test(file))
    out.push(
      `${name} is generated, vendored, or a lockfile. Edit its source or run the generator instead.`,
    );
  const { before, after } = beforeAfter(tool, input, existing);
  // The secret redaction (`secrets.mjs`) writes this marker into tool output.
  if (count(REDACTED, after) > count(REDACTED, before ?? ""))
    out.push(
      `The edit writes a \`[REDACTED:\` marker into ${name}. The secret redaction put this marker in a tool output in place of a value. The edit can replace the real value in the file. Keep the old text in the place of the marker.`,
    );
  if (TEST_PATH.test(file)) {
    // A new test file weakens no test.
    if (before !== null) {
      const removed = count(ASSERT, before) - count(ASSERT, after);
      if (removed > 0)
        out.push(
          `The edit removes ${removed} assertion(s) from the test file ${name}. A test with fewer assertions can hide a defect. Keep each assertion, or tell the user why you remove it.`,
        );
      if (count(SKIP, after) > count(SKIP, before))
        out.push(
          `The edit adds a \`skip\`, \`xfail\`, \`todo\`, or focus marker to the test file ${name}. The marker stops tests from running, so a failure stays hidden. Fix the cause of the failure and keep each test on.`,
        );
    }
  }
  return out;
}
