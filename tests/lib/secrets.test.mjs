import { expect, test } from "bun:test";
import { redact, strings } from "../../hooks/lib/_secrets.mjs";

const find = (rule, secret) => ({ rule, secret });

test("redact replaces each secret in a string", () => {
  const { value, count } = redact("a=SECRET1 b=SECRET1", [
    find("r1", "SECRET1"),
  ]);
  expect(value).toBe("a=[REDACTED:r1] b=[REDACTED:r1]");
  expect(count).toBe(2);
});

test("redact keeps the shape of nested objects and arrays", () => {
  const out = {
    stdout: "key: TOKEN-A",
    stderr: "",
    interrupted: false,
    lines: ["x", { deep: "TOKEN-B and TOKEN-A" }],
    n: 3,
  };
  const { value, count } = redact(out, [
    find("a", "TOKEN-A"),
    find("b", "TOKEN-B"),
  ]);
  expect(value).toStrictEqual({
    stdout: "key: [REDACTED:a]",
    stderr: "",
    interrupted: false,
    lines: ["x", { deep: "[REDACTED:b] and [REDACTED:a]" }],
    n: 3,
  });
  expect(count).toBe(3);
});

test("a longer secret that contains a shorter one is replaced whole", () => {
  const { value } = redact("LONGSECRET-123 and SECRET", [
    find("short", "SECRET"),
    find("long", "LONGSECRET-123"),
  ]);
  expect(value).toBe("[REDACTED:long] and [REDACTED:short]");
});

test("no findings give the same value back", () => {
  const out = { stdout: "clean", code: 0 };
  expect(redact(out, [])).toStrictEqual({ value: out, count: 0 });
});

test("strings lists every string in order", () => {
  expect(strings({ a: "1", b: [2, "3", { c: "4" }], d: null })).toStrictEqual([
    "1",
    "3",
    "4",
  ]);
});
