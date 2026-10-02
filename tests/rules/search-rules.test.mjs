// Bash guard rule for recursive walks into gitignored directories. Commands
// are plain strings here; nothing is executed.

import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../../hooks/lib/_bash-rules.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";

// A native path as a command writes it. Git Bash on Windows reads `\` as an
// escape and takes `C:/` paths.
const sh = (p) => p.split(path.sep).join("/");

function tempDir() {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-test-")),
  );
}

// A repo with large ignored build output at the root and large ignored
// dependencies in a subdirectory. `src` has only a small ignored cache.
function makeRepo() {
  const root = tempDir();
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    ".build/\nnode_modules/\n__pycache__/\n",
  );
  for (const dir of ["src/__pycache__", ".build/out", "web/node_modules/pkg"])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.swift"), "let x = 1\n");
  fs.writeFileSync(path.join(root, "src", "__pycache__", "a.pyc"), "\0");
  for (let i = 0; i < 200; i += 1) {
    fs.writeFileSync(path.join(root, ".build", "out", `${i}.o`), "\0");
    fs.writeFileSync(
      path.join(root, "web", "node_modules", "pkg", `${i}.js`),
      "",
    );
  }
  fs.writeFileSync(path.join(root, "web", "main.js"), "");
  execFileSync("git", [
    "-C",
    root,
    "add",
    ".gitignore",
    "src/app.swift",
    "web/main.js",
  ]);
  return root;
}

const root = makeRepo();
const outside = tempDir();
const ctx = {
  root,
  cwd: root,
  allowedModels: ["claude-opus-5-5"],
  io: nodeIo(),
};

async function level(command, c = ctx) {
  const findings = await check(command, c);
  for (const l of ["deny", "ask", "warn"])
    if (findings.some(([found]) => found === l)) return l;
  return "pass";
}

const DENY = [
  "grep -rn needle .",
  "grep -r needle",
  "grep -R --include='*.swift' needle .",
  "grep -rn --exclude-dir=.build needle .",
  "grep -rn --exclude-dir={.build,dist} needle .",
  "egrep -r 'a|b' .",
  "timeout 30 grep -r needle .",
  "cd web && grep -r needle .",
  "grep -r needle web",
  "grep -r needle web/*",
  "grep -rn needle *",
  "find . -name '*.swift'",
  "find . -type f -not -path './.build/*'",
  "find . -maxdepth 5 -name '*.o'",
  `find ${sh(path.dirname(root))} -name '*.swift'`,
  "rg --no-ignore needle",
  "rg -uu needle .",
  "rg -u -e needle",
  "rg --files --no-ignore",
  "rg --no-ignore-vcs -g '!.build' needle",
  "fd -I swift",
  "fd -u . web",
  "fd --no-ignore-vcs -e swift",
  "tree",
  "tree -L 4",
  "ls -R",
  "ag -u needle",
  "ack needle",
  "git grep --no-index needle",
  "git grep --untracked --no-exclude-standard needle",
];

const PASS = [
  "rg needle",
  "rg -n needle .",
  "rg --hidden needle",
  "fd -e swift",
  "fd -H swift",
  "git grep needle",
  "git grep --untracked needle",
  "git grep --no-index --exclude-standard needle",
  "grep -rn needle src",
  // `src/__pycache__/` is ignored but small.
  "find src -type f",
  "grep -n needle src/app.swift",
  "grep -r needle .build/out",
  "grep -r needle src .build",
  "grep -rn --exclude-dir=.build --exclude-dir=node_modules needle .",
  "grep -rn --exclude-dir={.build,node_modules} needle .",
  "rg --no-ignore -g '!{.build,node_modules}' needle",
  "git ls-files | xargs grep -n needle",
  "find src -name '*.swift'",
  "find . -maxdepth 2 -type d",
  "find . \\( -name .build -o -name node_modules \\) -prune -o -name '*.swift' -print",
  "find . -path ./.build -prune -o -path '*/node_modules' -prune -o -print",
  "rg --no-ignore -g '!.build' -g '!node_modules' needle",
  "rg --no-ignore --max-depth 1 needle",
  "fd -I -E .build -E node_modules swift",
  "tree --gitignore",
  "tree -L 2",
  "tree -I '.build|node_modules'",
  "ls -la",
  "ag needle",
  `grep -r needle ${outside}`,
  // The shell expands a glob before grep runs, here to files only.
  "grep -rn needle web/*.js",
  "grep -rn needle web/*.none",
];

for (const command of DENY) {
  test(`deny: ${command}`, async () =>
    expect(
      await level(command),
      JSON.stringify(await check(command, ctx)),
    ).toBe("deny"));
}
for (const command of PASS) {
  test(`pass: ${command}`, async () =>
    expect(
      await level(command),
      JSON.stringify(await check(command, ctx)),
    ).toBe("pass"));
}

test("the reason names the ignored directories and the alternatives", async () => {
  const [[, reason]] = await check("grep -r needle .", ctx);
  expect(reason).toContain("`.build/`");
  expect(reason).toContain("`web/node_modules/`");
  expect(reason).toContain("`rg`");
});

test("a directory outside any git repository passes", async () => {
  const plain = tempDir();
  fs.mkdirSync(path.join(plain, "build"));
  expect(
    await level("grep -r needle .", { ...ctx, root: plain, cwd: plain }),
  ).toBe("pass");
});

test("a `cd ~/...` hint resolves against HOME, not the project", async () => {
  const saved = process.env.HOME;
  process.env.HOME = outside;
  fs.mkdirSync(path.join(outside, "logs"), { recursive: true });
  try {
    expect(await level("cd ~/logs && find . -name '*.jsonl'")).toBe("pass");
    expect(await level("cd ~ && find . -name '*.jsonl'")).toBe("pass");
  } finally {
    process.env.HOME = saved;
  }
});

test("a `cd $DIR` hint leaves the base unknown", async () => {
  expect(await level("cd $DIR && find . -name '*.swift'")).toBe("pass");
});

test("an explicit ignore bypass over ignored notes passes, over build output it is denied", async () => {
  const notes = tempDir();
  execFileSync("git", ["init", "-q", notes]);
  fs.writeFileSync(path.join(notes, ".gitignore"), "docs/external/\ndist/\n");
  for (const dir of ["docs/external", "dist"]) {
    fs.mkdirSync(path.join(notes, dir), { recursive: true });
    for (let i = 0; i < 200; i += 1)
      fs.writeFileSync(path.join(notes, dir, `${i}.md`), "");
  }
  const c = { ...ctx, root: notes, cwd: notes };
  for (const command of [
    'rg -n -uu "Task" docs',
    "fd -I -e md . docs",
    "git grep --no-index Task docs",
  ])
    expect(await level(command, c)).toBe("pass");
  expect(await level('rg -n -uu "Task" .', c)).toBe("deny");
  expect(await level("grep -rn Task docs", c)).toBe("deny");
});
