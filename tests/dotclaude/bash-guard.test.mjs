import { expect, test } from "bun:test";
import { askFor } from "../../plugins/dotclaude/lib/guards/bash.mjs";

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

test("an rm target inside the project is allowed when the project is unknown only for others", () => {
  expect(askFor("rm -rf build", { ...ctx, project: "" })).toHaveLength(1);
});
