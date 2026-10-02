import { describe, expect, test } from "bun:test";
import { isUnder } from "../../hooks/lib/_bash-args.mjs";
import { commandBase, expandHome } from "../../hooks/lib/_bash-writes.mjs";
import { posix, win32 } from "../../hooks/lib/_path.mjs";
import { program } from "../../hooks/lib/_shell-command.mjs";

describe("program", () => {
  test("keeps the posix basename", () => {
    expect(program("rm")).toBe("rm");
    expect(program("/usr/bin/rm")).toBe("rm");
    expect(program("\\rm")).toBe("rm");
    expect(program("./bin/rm/")).toBe("rm");
    expect(program("/")).toBe("");
    expect(program("")).toBe("");
  });
  test("finds the program in a Windows path", () => {
    expect(program("C:\\Windows\\rm")).toBe("rm");
  });
});

describe("isUnder", () => {
  test("uses the path module that the caller passes", () => {
    expect(isUnder("/a/b", "/a", posix)).toBe(true);
    expect(isUnder("/a", "/a", posix)).toBe(true);
    expect(isUnder("/ab", "/a", posix)).toBe(false);
    expect(isUnder("/a/../b", "/a", posix)).toBe(false);
    expect(isUnder("C:\\a\\b", "C:\\a", win32)).toBe(true);
    expect(isUnder("D:\\b", "C:\\a", win32)).toBe(false);
  });
});

describe("expandHome", () => {
  test("replaces a leading tilde with home", () => {
    expect(expandHome("~/x", "/h")).toBe("/h/x");
    expect(expandHome("~", "/h")).toBe("/h");
    expect(expandHome("a/~", "/h")).toBe("a/~");
  });
  test("keeps the tilde when home is absent", () => {
    expect(expandHome("~/x", undefined)).toBe("~/x");
  });
});

describe("commandBase", () => {
  test("resolves a cd hint against cwd and home", () => {
    expect(commandBase({}, "/w", "/h")).toBe("/w");
    expect(commandBase({ cwdHint: "sub" }, "/w", "/h")).toBe("/w/sub");
    expect(commandBase({ cwdHint: "~/p" }, "/w", "/h")).toBe("/h/p");
    expect(commandBase({ cwdHint: "/abs" }, "/w", undefined)).toBe("/abs");
  });
  test("is unknown for an unresolvable hint", () => {
    expect(commandBase({ cwdHint: "$D" }, "/w", "/h")).toBeUndefined();
    expect(commandBase({ cwdHint: "~/p" }, "/w", undefined)).toBeUndefined();
    expect(commandBase({ cwdHint: "~/p" }, "/w", "")).toBeUndefined();
    expect(commandBase({ cwdHint: "~u/p" }, "/w", "/h")).toBeUndefined();
  });
});
