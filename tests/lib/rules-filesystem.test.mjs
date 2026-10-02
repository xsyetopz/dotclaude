import { describe, expect, test } from "bun:test";
import { check } from "../../hooks/lib/_bash-rules.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";
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

describe("check routes mkfs to disk", () => {
  const ctx = { root: "/tmp", cwd: "/tmp", io: nodeIo() };

  test.each([
    [String.raw`"mkfs\x" /dev/sda1`],
    [String.raw`"/sbin/mkfs\x" /dev/sda1`],
    ["mkfs.ntfs /dev/sda1"],
    ["mkfs.exfat /dev/sda1"],
    ["mkfs.ext4 /dev/sda1"],
  ])("asks for %s", async (command) => {
    const findings = await check(command, ctx);
    expect(findings.some(([level]) => level === "ask")).toBe(true);
  });

  test("passes fsck", async () => {
    expect(await check("fsck /dev/sda1", ctx)).toEqual([]);
  });
});
