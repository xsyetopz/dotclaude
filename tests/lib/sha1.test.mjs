// The pure `sha1` gives the same digest as `node:crypto` for every input.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sha1 } from "../../hooks/lib/_sha1.mjs";

const reference = (input) => createHash("sha1").update(input).digest("hex");

test("known strings", () => {
  for (const text of [
    "",
    "abc",
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "a".repeat(1_000_000),
  ]) {
    expect(sha1(text)).toBe(reference(text));
  }
  expect(sha1("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
});

test("every length from 0 to 200 bytes", () => {
  for (let length = 0; length <= 200; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 7 + 13) & 0xff);
    expect(sha1(bytes)).toBe(reference(bytes));
  }
});

test("non-ASCII text is hashed as UTF-8", () => {
  for (const text of [
    "héllo wörld",
    "😀🎉👨‍👩‍👧",
    "日本語のテキスト 你好",
    "a\0b",
  ]) {
    expect(sha1(text)).toBe(reference(text));
  }
});

test("50 random byte arrays", () => {
  for (let n = 0; n < 50; n++) {
    const bytes = new Uint8Array(Math.floor(Math.random() * 1000));
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.random() * 256;
    expect(sha1(bytes)).toBe(reference(bytes));
  }
});
