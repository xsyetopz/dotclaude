// Shell parsing for the guards.
// Commands are plain strings here, and nothing runs.

import { describe, expect, test } from "bun:test";
import { parse } from "../../hooks/lib/_shell.mjs";

const names = (command) => parse(command).commands.map((c) => c.name);
const argvs = (command) => parse(command).commands.map((c) => c.argv);

describe("parse quotes", () => {
  test("a here-string is not a heredoc", () => {
    expect(names('cat <<< "hello"\nrm -rf /tmp/zz\necho hi')).toEqual([
      "cat",
      "rm",
      "echo",
    ]);
    expect(parse('cat <<< "hello"').commands[0].heredoc).toBe("hello");
  });

  test("`<<` inside quotes starts no heredoc", () => {
    expect(names('echo "<<EOF"\nrm -rf /tmp/zz\nEOF')).toEqual([
      "echo",
      "rm",
      "EOF",
    ]);
  });

  test("a single quote inside double quotes leaves a substitution live", () => {
    expect(names("echo \"it's $(rm -rf /tmp/zz)\" ; echo 'x'")).toEqual([
      "rm",
      "echo",
      "echo",
    ]);
  });

  test("a quoted brace is a word, not a group", () => {
    expect(argvs('git push origin "{" --force')).toEqual([
      ["git", "push", "origin", "{", "--force"],
    ]);
    expect(names("{ echo a; echo b; }")).toEqual(["echo", "echo"]);
  });

  test("a digit is a descriptor only when it touches the redirect", () => {
    expect(argvs("echo 2 > f")).toEqual([["echo", "2"]]);
    expect(parse("echo 2 > f").commands[0].writes).toEqual(["f"]);
    expect(argvs("echo a 2>f")).toEqual([["echo", "a"]]);
    expect(parse("echo a 2>f").commands[0].writes).toEqual(["f"]);
  });

  test("ANSI-C quotes decode their escapes", () => {
    expect(argvs("echo $'a\\tb'")).toEqual([["echo", "a\tb"]]);
  });

  test("a `case` pattern inside a substitution does not close it", () => {
    const parsed = parse("echo $(case x in a) rm -rf /tmp/zz;; esac); ls");
    expect(parsed.unparsed).toEqual([]);
    expect(parsed.commands.map((c) => c.name)).toEqual([
      "case",
      "rm",
      "esac",
      "echo",
      "ls",
    ]);
  });

  test("an unterminated quote is unparsed", () => {
    expect(parse("echo 'x").unparsed).toEqual(["echo 'x"]);
  });
});

describe("parse heredocs", () => {
  test("an unquoted heredoc body runs its substitutions", () => {
    expect(names("cat > f <<EOF\n$(rm -rf /tmp/zz)\nEOF")).toEqual([
      "rm",
      "cat",
    ]);
  });

  test("a quoted heredoc body is text", () => {
    expect(names("cat > f <<'EOF'\n$(rm -rf /tmp/zz)\nEOF")).toEqual(["cat"]);
  });

  test("a heredoc inside a substitution keeps the outer heredocs in order", () => {
    const cmd =
      "git commit -m \"$(cat <<'EOF'\ndon't (keep) it\nEOF\n)\" && cat > f <<'X'\nbody\nX";
    const parsed = parse(cmd);
    expect(parsed.unparsed).toEqual([]);
    const cats = parsed.commands.filter((c) => c.name === "cat");
    expect(cats.map((c) => c.heredoc)).toEqual(["don't (keep) it", "body"]);
  });

  test("two heredocs on one line take their bodies in order", () => {
    const parsed = parse("a <<A; b <<B\none\nA\ntwo\nB");
    expect(parsed.commands.map((c) => c.heredoc)).toEqual(["one", "two"]);
  });
});
