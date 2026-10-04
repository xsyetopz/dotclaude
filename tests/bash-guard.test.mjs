import { expect, test } from "bun:test";
import { askFor } from "../hooks/lib/_bash-rules.mjs";

const ctx = { project: "/work/app", cwd: "/work/app", home: "/home/u" };
const asks = (command) => askFor(command, ctx).length > 0;

test.each([
  "git push --force",
  "git push -f origin main",
  "git push origin main --force-with-lease",
  "git push origin +main",
  "git -C /x push -fu origin main",
  "git reset --hard HEAD~1",
  "git clean -fd",
  "git checkout -- .",
  "git restore .",
  "git branch -D old",
  "rm -rf /",
  "rm -rf ~",
  "rm -rf $HOME/stuff",
  "rm -r ../other",
  "rm -rf /tmp/x",
  "rm -rf .",
  "rm -rf $DIR/x",
  "sudo ls",
  "dd if=a of=/dev/disk2",
  "mkfs.ext4 /dev/sda1",
  "chmod -R 777 .",
  "cat .env",
  "less ~/.ssh/id_ed25519",
  "head -n 3 $HOME/.aws/credentials",
  "echo hi && git reset --hard",
  "ls | xargs true; rm -rf /",
  "bash -c 'git push --force'",
  'sh -c "cd x && rm -rf /"',
  "FOO=1 git reset --hard",
  "(git reset --hard)",
])("asks for %s", (command) => {
  expect(asks(command)).toBe(true);
});

test.each([
  "git push origin main",
  "git push --dry-run",
  "git reset --soft HEAD~1",
  "git clean -nfd",
  "git restore --staged .",
  "git checkout main",
  "git branch -d merged",
  "rm -rf node_modules",
  "rm -rf ./dist/../build",
  "rm file.txt",
  "chmod 755 run.sh",
  "cat README.md",
  "cat .env.example",
  "cat ~/.ssh/id_rsa.pub",
  "echo 'git push --force'",
  "grep -r force src",
  "dd if=a of=out.img",
])("allows %s", (command) => {
  expect(asks(command)).toBe(false);
});

test("a reason names the command part and the cause", () => {
  const [found] = askFor("ls && git reset --hard HEAD", ctx);
  expect(found.part).toBe("git reset --hard HEAD");
  expect(found.reason).toContain("hard reset");
});

test("an rm target inside the project is allowed when the project is unknown only for others", () => {
  expect(askFor("rm -rf build", { ...ctx, project: "" })).toHaveLength(1);
});
