import { expect, test } from "bun:test";
import {
  askFor,
  autoModeText,
  writeFor,
} from "../../plugins/dotclaude/lib/guards/bash.mjs";
import { cite } from "../../plugins/dotclaude/lib/terms.mjs";

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
  "git checkout scripts/evals/test_harness.py",
  "git checkout HEAD src/main",
  "git checkout -- src/main",
  "git checkout ./src",
  "git checkout -f main",
  "git restore README.md",
  "git restore --staged --worktree a.md",
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
  "codegraph init -y",
  "codegraph uninit",
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
  "git commit --no-verify -m x",
  "git commit -nm x",
  "HUSKY=0 git commit -m x",
  "git -c core.hooksPath=/dev/null commit",
  "npm publish",
  "yarn npm publish",
  "cargo publish",
  "docker push app:1",
  "gh pr merge 1",
  "gh release create v1",
  "gh api -X DELETE repos/a/b",
  "gh api --method=POST repos/a/b/issues",
  "gh api repos/a/b/issues -f title=x",
  `gh api graphql -f query='mutation { addStar(input: {}) { clientMutationId } }'`,
  "gh api graphql -F query=@star.graphql",
  'psql -c "DROP TABLE t"',
  "redis-cli FLUSHALL",
  "dropdb app",
  "npx prisma migrate reset",
  "python manage.py flush",
  "rails db:drop",
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
  "git checkout feature/login",
  "git checkout v1.2.0",
  "git checkout -b fix origin/main",
  "git checkout -",
  "git restore --staged a.md",
  "git branch -d merged",
  "rm -rf node_modules",
  "rm -rf ./dist/../build",
  "codegraph index",
  "codegraph sync",
  'codegraph explore "init"',
  "rm file.txt",
  "chmod 755 run.sh",
  "cat README.md",
  "cat .env.example",
  "cat ~/.ssh/id_rsa.pub",
  "echo 'git push --force'",
  "grep -r force src",
  "dd if=a of=out.img",
  "git push -n",
  "git commit -m x",
  "npm publish --dry-run",
  "npm install",
  "docker pull app:1",
  "gh pr view 1",
  "gh pr list",
  "gh api repos/a/b",
  "gh api -X GET repos/a/b",
  "gh api graphql -f query='{ viewer { login } }'",
  `gh api graphql -f query='query($n: String!) { repository(name: $n) { id } }' -F n=x`,
  'psql -c "SELECT 1"',
  "redis-cli GET k",
  "npx prisma migrate dev",
  "python manage.py migrate",
])("allows %s", (command) => {
  expect(asks(command)).toBe(false);
});

test("a reason names the command part and the cause", () => {
  const [found] = askFor("ls && git reset --hard HEAD", ctx);
  expect(found.part).toBe("git reset --hard HEAD");
  expect(found.reason).toContain("hard reset");
});

test("each flagged rm target has its own reason", () => {
  const [found] = askFor(`rm -rf /tmp/a.sh "\${TMPDIR}"tmp.* build`, ctx);
  expect(found.reason).toBe(
    `\`/tmp/a.sh\`: The target is outside the project. \`\${TMPDIR}tmp.*\`: The target is known only at run time.`,
  );
});

const wctx = { ...ctx, tmp: "/var/folders/x/T/" };
const writes = (command) => writeFor(command, wctx).length > 0;

test.each([
  "sed -i '' 's/a/b/' Sources/kk.lproj/Localizable.strings",
  "sed -i.bak -e 's/a/b/' src/a.c",
  "gsed --in-place 's/a/b/' README.md",
  "perl -pi -e 's/a/b/' lib/x.pm",
  "echo hi > notes.md",
  "echo hi >> /work/app/notes.md",
  "printf x 2>errors.log",
  "make &>build.log",
  "cat > src/a.txt <<'EOF'\nhello > there\nEOF",
  "echo x | tee -a docs/a.md",
  "bash -c 'echo x > a.txt'",
  `python3 -c "open('src/a.txt', 'w').write('x')"`,
  `python3 - <<'EOF'\np = "Sources/mn.lproj/Localizable.strings"\nwith open(p, "w") as f:\n    f.write(t)\nEOF`,
  `python3 -c "from pathlib import Path; Path('a.md').write_text('x')"`,
  `node -e "require('fs').writeFileSync('src/a.js', 'x')"`,
  `bun -e "await Bun.write('a.json', '{}')"`,
  "cd src && echo x > a.md",
  "cd /tmp && echo x > /work/app/a.md",
  "(cd /tmp) && echo x > a.md",
  `bun -e "import { f } from './lib/f.mjs'; const p = 'out/a.json'; await Bun.write(p, f())"`,
])("denies the project write %s", (command) => {
  expect(writes(command)).toBe(true);
});

test.each([
  "sed -n '1,5p' src/a.c",
  "sed 's/a/b/' src/a.c > /tmp/out.c",
  "sed -i '' 's/a/b/' /tmp/x.txt",
  "echo hi > /dev/null",
  "cmd 2>&1 | tail",
  "echo x > $TMPDIR/a.txt",
  "echo x > /var/folders/x/T/a.txt",
  "echo x > ~/notes.md",
  "echo x > ../other/a.md",
  "tee /tmp/log < in.txt",
  "git commit -F - <<'EOF'\nfix: a > b\nEOF",
  `python3 -c "import json; print(json.load(open('package.json')))"`,
  `python3 -c "open('/tmp/a.txt', 'w').write(open('src/a.txt').read())"`,
  `node -e "console.log(require('fs').readFileSync('a.json', 'utf8'))"`,
  "git commit -m \"writeFileSync('a.txt') > done\"",
  'cd "$TMPDIR/c18" && jq . a.json > cases.jsonl',
  "cd /tmp/x && echo x > a.txt",
  "cd $OUT && echo x > a.txt",
  `bun -e "import { f } from './lib/f.mjs'; await Bun.write(process.argv[1] + '/s.txt', f())" "$TMPDIR"`,
])("allows %s", (command) => {
  expect(writes(command)).toBe(false);
});

test("a write reason names the part, the tools to use, and the rule", () => {
  const [found] = writeFor("ls && sed -i '' 's/a/b/' a.md", wctx);
  expect(found.part).toBe("sed -i  s/a/b/ a.md");
  expect(found.reason).toContain("`Edit` or `Write`");
  expect(found.reason).toContain("If you have no `Edit` or `Write`");
  expect(found.reason).toContain(cite("edit-tools"));
});

test("the auto-mode text gets the edit rule in place of its Bash edits", () => {
  const relaxed =
    "While auto mode is active:\n\nYou can do much of your work through the Bash tool when it is the simpler route: read files with cat, and make small, mechanical file changes with sed, heredocs, or short scripts instead of the dedicated Read, Edit, or Write tools. The choice is yours: prefer Edit or Write when a shell edit would be fragile, such as sed/awk flags that differ between GNU and BSD/macOS.";
  const strict =
    "Do your work through the Bash tool wherever it can accomplish the job: make file changes with sed, heredocs, or short scripts. Fall back to a dedicated tool only when Bash genuinely cannot do the job.";
  for (const text of [relaxed, strict]) {
    const out = autoModeText(text);
    expect(out).not.toContain("sed");
    expect(out).toContain("Edit a project file only with `Edit` or `Write`");
  }
  expect(autoModeText(relaxed)).toStartWith("While auto mode is active:\n\n");
  expect(autoModeText("other text")).toBe("other text");
});

test("an rm target inside the project is allowed when the project is unknown only for others", () => {
  expect(askFor("rm -rf build", { ...ctx, project: "" })).toHaveLength(1);
});
