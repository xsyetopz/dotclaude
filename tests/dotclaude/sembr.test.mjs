import { expect, test } from "bun:test";
import { register } from "../../plugins/dotclaude/hooks/index.mjs";
import {
  COMMAND_NOTE,
  lineBreakFixes,
  lineBreakNote,
  messageSpans,
  misbroken,
  proseBlocks,
  proseKind,
  rewrapCommand,
  rewrapText,
  SEMBR_COMMAND,
  sembrLines,
} from "../../plugins/dotclaude/lib/notes/sembr.mjs";

/**
 * A stub of `sembr`, not the real tool. It breaks each block after `, ` when
 * `because` follows, and it keeps two sentences on one line, as sembr can.
 */
const stub = async (_argv, stdin) => ({
  exitCode: 0,
  stdout: stdin
    .split("\n\n")
    .map((b) => b.replaceAll(", because", ",\nbecause"))
    .join("\n\n"),
});
const fails = async () => {
  throw new Error("not found");
};

test("proseKind gives the kind of prose in a file", () => {
  expect(proseKind("wiki/Home.md")).toBe("markdown");
  expect(proseKind("lib/notes/sembr.mjs")).toBe("slash");
  expect(proseKind("src/main.rs")).toBe("slash");
  expect(proseKind("tool.py")).toBe("hash");
  expect(proseKind("justfile")).toBe("hash");
  expect(proseKind("image.png")).toBeUndefined();
});

test("proseBlocks skips front matter, headings, fences, and tables", () => {
  const text = [
    "---",
    "status: done",
    "---",
    "# Title",
    "One line",
    "and the next.",
    "",
    "```js",
    "const a = 1;",
    "```",
    "| a | b |",
    "- An item",
    "  that goes on.",
    "- Another item.",
  ].join("\n");
  const blocks = proseBlocks(text, "markdown");
  expect(blocks.map((b) => b.bodies)).toEqual([
    ["One line", "and the next."],
    ["An item", "that goes on."],
    ["Another item."],
  ]);
  expect(blocks[1].prefix).toBe("- ");
  expect(blocks[1].rest).toBe("  ");
});

test("proseBlocks reads comment blocks and skips tags and directives", () => {
  const text = [
    "// A comment that",
    "// goes on.",
    "const a = 1;",
    "/**",
    " * A doc comment.",
    " * @param a the value",
    " */",
    "// eslint-disable-next-line",
  ].join("\n");
  expect(proseBlocks(text, "slash").map((b) => b.bodies)).toEqual([
    ["A comment that", "goes on."],
    ["A doc comment."],
  ]);
  expect(proseBlocks("# A hash\n# comment.", "hash")[0].bodies).toEqual([
    "A hash",
    "comment.",
  ]);
});

test("proseBlocks of a commit skips the subject and the trailers", () => {
  const text =
    "fix: the subject\n\nThe body.\n\nCo-Authored-By: Claude <noreply@anthropic.com>";
  expect(proseBlocks(text, "commit").map((b) => b.bodies)).toEqual([
    ["The body."],
  ]);
});

test("sembrLines sends one line per block and splits sentences", async () => {
  let input;
  const lines = await sembrLines(
    async (argv, stdin) => {
      input = { argv, stdin };
      return stub(argv, stdin);
    },
    proseBlocks("One. Two, because\nthree.\n\nFour.", "markdown"),
  );
  expect(input.argv).toEqual(SEMBR_COMMAND);
  expect(input.stdin).toBe("One. Two, because three.\n\nFour.");
  expect(lines).toEqual([["One.", "Two,", "because three."], ["Four."]]);
});

test("sembrLines rejects a result that changes the text", async () => {
  const changed = async () => ({ exitCode: 0, stdout: "Other text." });
  expect(
    await sembrLines(changed, proseBlocks("Some text.", "markdown")),
  ).toEqual([null]);
  expect(await sembrLines(fails, proseBlocks("Text.", "markdown"))).toBeNull();
  const short = async () => ({ exitCode: 0, stdout: "A." });
  expect(
    await sembrLines(short, proseBlocks("A.\n\nB.", "markdown")),
  ).toBeNull();
});

test("misbroken flags a column break and accepts semantic breaks", () => {
  const fixed = ["The note goes to the folder,", "because the hook reads it."];
  expect(
    misbroken(
      ["The note goes to the folder,", "because the hook reads it."],
      fixed,
    ),
  ).toBe(false);
  expect(
    misbroken(
      ["The note goes to the", "folder, because the hook reads it."],
      fixed,
    ),
  ).toBe(true);
  expect(misbroken(["One.", "Two."], ["One.", "Two."])).toBe(false);
  expect(misbroken(["One. Two."], ["One.", "Two."])).toBe(true);
});

test("rewrapText fixes only the blocks that break at a column", async () => {
  const text =
    "# Title\n\nThe note goes to the\nfolder, because the hook reads it.\n\nGood.";
  expect(await rewrapText(stub, text, "markdown")).toBe(
    "# Title\n\nThe note goes to the folder,\nbecause the hook reads it.\n\nGood.",
  );
  expect(await rewrapText(fails, text, "markdown")).toBe(text);
});

test("messageSpans finds heredoc and quoted messages", () => {
  const heredoc = "git commit -F - <<'EOF'\nsubject\n\nBody -m \"x\".\nEOF";
  const spans = messageSpans(heredoc, true);
  expect(spans).toHaveLength(1);
  expect(heredoc.slice(spans[0].start, spans[0].end)).toBe(
    'subject\n\nBody -m "x".',
  );
  expect(spans[0].kind).toBe("commit");
  const quoted = `gh pr create --title t --body "A body." -b 'B'`;
  expect(
    messageSpans(quoted, false).map((s) => quoted.slice(s.start, s.end)),
  ).toEqual(["A body.", "B"]);
  expect(messageSpans(`git commit -m "$(cat msg)"`, true)).toEqual([]);
});

test("rewrapCommand keeps the subject and the trailer", async () => {
  const command =
    "git commit -F - <<'EOF'\nfix: the note goes to the folder, because it is long\n\nThe note goes to the\nfolder, because the hook reads it.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF";
  expect(await rewrapCommand(stub, command, true)).toBe(
    "git commit -F - <<'EOF'\nfix: the note goes to the folder, because it is long\n\nThe note goes to the folder,\nbecause the hook reads it.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nEOF",
  );
});

test("lineBreakNote gives the fixed text of each block", async () => {
  const fixes = await lineBreakFixes(
    stub,
    "The note goes to the\nfolder, because the hook reads it.",
    "markdown",
  );
  const note = lineBreakNote("Home.md", fixes);
  expect(note).toContain("`Home.md`");
  expect(note).toContain(
    "<fixed_text>\nThe note goes to the folder,\nbecause the hook reads it.\n</fixed_text>",
  );
});

/** A fake of the engine's `$` with the stub sembr. It is a test double. */
function engine(run = stub) {
  return {
    session: { cwd: async () => "/work/app", root: async () => "/work/app" },
    env: { get: async () => undefined },
    fs: {
      read: async () => {
        throw new Error("missing");
      },
    },
    process: {
      run: async (argv, init) =>
        argv[0] === "sembr"
          ? run(argv, init.stdin)
          : { exitCode: 0, stdout: "[]", stderr: "" },
    },
  };
}

async function toolCall(options, $, e) {
  const handlers = {};
  register((event, fn) => {
    handlers[event] = fn;
  }, options);
  let seen;
  const r = await handlers["tool.call"]($, e, async (x) => {
    seen = x;
    return { result: "ok" };
  });
  return { r, seen };
}

const COMMIT = {
  tool: "Bash",
  command:
    "git commit -F - <<'EOF'\nfix: a subject\n\nThe note goes to the\nfolder, because the hook reads it.\nEOF",
};
const EDIT = {
  tool: "Edit",
  file_path: "/work/app/wiki/Home.md",
  old_string: "x",
  new_string: "The note goes to the\nfolder, because the hook reads it.",
};

test("a commit gets semantic line breaks before it runs", async () => {
  const { r, seen } = await toolCall({}, engine(), COMMIT);
  expect(seen.command).toContain("to the folder,\nbecause the hook");
  expect(r.context).toContain(COMMAND_NOTE);
});

test("an Edit of Markdown that breaks at a column gets the note", async () => {
  const { r, seen } = await toolCall({}, engine(), EDIT);
  expect(seen).toEqual(EDIT);
  expect(r.context.join("\n")).toContain("<fixed_text>");
});

test("the sembr option off or a missing sembr changes nothing", async () => {
  for (const [options, $] of [
    [{ sembr: false }, engine()],
    [{}, engine(fails)],
  ])
    for (const e of [COMMIT, EDIT]) {
      const { r, seen } = await toolCall(options, $, e);
      expect(seen).toEqual(e);
      expect(r.context).toBeUndefined();
    }
});
