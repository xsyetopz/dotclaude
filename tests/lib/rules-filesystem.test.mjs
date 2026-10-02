import { describe, expect, test } from "bun:test";
import { disk } from "../../hooks/lib/_rules-filesystem.mjs";
import { parse } from "../../hooks/lib/_shell.mjs";

const first = (command) => parse(command).commands[0];

describe("disk", () => {
  test.each([
    ["mkfs.ext4 /dev/sda1"],
    ["/sbin/mkfs.ext4 /dev/sda1"],
    // `program` splits on `\`, so the name of this argv0 is `x`.
    [String.raw`"mkfs\x" /dev/sda1`],
    [String.raw`"/sbin/mkfs\x" /dev/sda1`],
  ])("asks for %s", (command) => {
    const [[level, reason]] = disk(first(command));
    expect(level).toBe("ask");
    expect(reason).toContain("formats a device");
  });

  test.each([["mkdir /tmp/x"], ["fsck /dev/sda1"]])("passes %s", (command) => {
    expect(disk(first(command))).toEqual([]);
  });
});
