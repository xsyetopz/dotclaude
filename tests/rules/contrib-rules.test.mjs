// Contribution guard and AI policy catalog. Commands are plain strings here;
// nothing is executed and nothing reaches the network.

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  blobSha,
  loadCatalog,
  lookup,
  parseReadme,
  remoteKey,
  resetCatalogCache,
  upstreamChange,
} from "../../hooks/lib/_ai-policies.mjs";
import { check } from "../../hooks/lib/_bash-rules.mjs";

function repo(remotes) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-contrib-")),
  );
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  for (const [name, url] of Object.entries(remotes))
    execFileSync("git", ["-C", root, "remote", "add", name, url]);
  return root;
}

const ctxFor = (root) => ({
  root,
  cwd: root,
  allowedModels: ["claude-opus-5-5"],
  ghUser: "me",
});

function level(command, ctx) {
  const findings = check(command, ctx);
  for (const l of ["deny", "ask", "warn"])
    if (findings.some(([found]) => found === l)) return l;
  return "pass";
}

const reasons = (command, ctx) =>
  check(command, ctx)
    .map(([, r]) => r)
    .join(" ");

describe("catalog", () => {
  test("parses the upstream table into entries with repository keys", () => {
    const md = [
      "# list",
      "",
      "Project | Policy link | AI/LLMs allowed? | Disclosure required? | Policy includes copyright statement? | Requires human in the loop? | Notes",
      "--- | --- | --- | --- | --- | --- | ---",
      "[Alacritty](https://github.com/alacritty/alacritty) | [LLM](https://github.com/alacritty/alacritty/blob/master/CONTRIBUTING.md#llm) | No | - | - | - |",
      "[Forgejo](https://forgejo.org) | [AI](https://codeberg.org/forgejo/governance/src/branch/main/AIAgreement.md) | No | - | - | - | -",
      "[GIMP](https://www.gimp.org) | [AI](https://gitlab.gnome.org/GNOME/gimp/-/blob/master/CONTRIBUTING.md) | No | - | - | - |",
      "[QEMU](https://www.qemu.org) | [Provenance](https://www.qemu.org/docs/master/devel/code-provenance.html) | No | - | Yes | - |",
      "[Airflow](https://airflow.apache.org/) | [Gen-AI](https://github.com/apache/airflow/blob/main/x.rst) | Yes | Yes | Yes | Yes | note",
      "",
      "## Ongoing discussions",
      "- [not a row](https://github.com/x/y)",
    ].join("\n");
    const entries = parseReadme(md);
    expect(entries.map((e) => [e.project, e.allowed, e.keys])).toEqual([
      ["Alacritty", "No", ["github.com/alacritty/alacritty"]],
      ["Forgejo", "No", ["codeberg.org/forgejo"]],
      ["GIMP", "No", ["gitlab.gnome.org/gnome/gimp"]],
      ["QEMU", "No", ["gitlab.com/qemu-project/qemu", "github.com/qemu/qemu"]],
      ["Airflow", "Yes", ["github.com/apache/airflow"]],
    ]);
    expect(entries[4]).toMatchObject({ disclosure: "Yes", human: "Yes" });
  });

  test("reads git remote URLs in every form", () => {
    expect(remoteKey("git@github.com:Alacritty/alacritty.git")).toBe(
      "github.com/alacritty/alacritty",
    );
    expect(remoteKey("ssh://git@gitlab.gnome.org:2222/GNOME/gimp.git")).toBe(
      "gitlab.gnome.org/gnome/gimp",
    );
    expect(remoteKey("https://codeberg.org/forgejo/forgejo")).toBe(
      "codeberg.org/forgejo/forgejo",
    );
    expect(remoteKey("/srv/git/local")).toBeUndefined();
  });

  test("an organization-wide entry matches every repository of the owner", () => {
    expect(lookup("codeberg.org/forgejo/forgejo")?.project).toBe("Forgejo");
    expect(lookup("github.com/nobody/nothing")).toBeUndefined();
  });

  test("the blob hash matches git", () => {
    const file = path.join(os.tmpdir(), "blob.md");
    fs.writeFileSync(file, "| a | b |\nÄ\n");
    expect(blobSha(fs.readFileSync(file, "utf8"))).toBe(
      execFileSync("git", ["hash-object", file], { encoding: "utf8" }).trim(),
    );
  });
});

describe("lazy upstream check", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetCatalogCache();
  });

  function online() {
    delete process.env.DOTCLAUDE_OFFLINE;
    process.env.CLAUDE_PLUGIN_DATA = fs.mkdtempSync(
      path.join(os.tmpdir(), "dotclaude-data-"),
    );
    resetCatalogCache();
  }

  test("reports a changed upstream hash and fetches once a day", () => {
    online();
    let calls = 0;
    const fetchSha = () => {
      calls += 1;
      return "f".repeat(40);
    };
    const now = Date.now();
    expect(upstreamChange(now, fetchSha)).toBe("f".repeat(40));
    expect(upstreamChange(now + 60_000, fetchSha)).toBe("f".repeat(40));
    expect(calls).toBe(1);
    upstreamChange(now + 25 * 60 * 60 * 1000, fetchSha);
    expect(calls).toBe(2);
  });

  test("stays quiet when the hash matches or the fetch fails", () => {
    online();
    const sha = loadCatalog().sha;
    expect(upstreamChange(Date.now(), () => sha)).toBeUndefined();
    online();
    expect(
      upstreamChange(Date.now(), () => {
        throw new Error("offline");
      }),
    ).toBeUndefined();
  });

  test("an updated catalog in the data directory wins", () => {
    online();
    fs.writeFileSync(
      path.join(process.env.CLAUDE_PLUGIN_DATA, "ai-policies.json"),
      JSON.stringify({ sha: "abc", entries: [] }),
    );
    expect(loadCatalog().sha).toBe("abc");
  });

  test("offline, nothing is fetched", () => {
    let calls = 0;
    expect(
      upstreamChange(Date.now(), () => {
        calls += 1;
        return "x";
      }),
    ).toBeUndefined();
    expect(calls).toBe(0);
  });
});

describe("contribution guard", () => {
  const forbidden = repo({
    origin: "git@github.com:me/alacritty.git",
    upstream: "https://github.com/alacritty/alacritty.git",
  });
  const foreign = repo({ origin: "https://github.com/someone/tool.git" });
  const own = repo({ origin: "git@github.com:Me/project.git" });

  test.each([
    'git commit -m "fix"',
    "git push upstream main",
    'gh pr create --title x --body "y"',
    "gh issue comment 3 --body hi",
    "gh pr review 4 --approve",
    "gh discussion create --category General --title x --body y",
    "gh discussion comment 7 --body hi",
  ])("denies %s in a project that forbids AI contributions", (command) => {
    expect(level(command, ctxFor(forbidden))).toBe("deny");
    expect(reasons(command, ctxFor(forbidden))).toContain("Alacritty");
  });

  test.each([
    "gh issue create -R alacritty/alacritty --title x --body y",
    "gh pr comment https://github.com/alacritty/alacritty/pull/9 --body y",
    "gh api repos/alacritty/alacritty/issues -f title=x",
    "gh api -X POST repos/alacritty/alacritty/issues/3/comments",
  ])("denies %s from any folder", (command) => {
    expect(level(command, ctxFor(own))).toBe("deny");
  });

  test("asks before a push or GitHub write to another owner", () => {
    for (const command of [
      "git push origin main",
      "git push",
      "gh pr create --fill",
    ]) {
      expect(level(command, ctxFor(foreign))).toBe("ask");
      expect(reasons(command, ctxFor(foreign))).toContain("someone/tool");
    }
  });

  test("asks before a GraphQL mutation that posts, whose target is unknown", () => {
    const command =
      "gh api graphql -F id=D_1 -f query='mutation($id: ID!) { addDiscussionComment(input: {discussionId: $id, body: hi}) { comment { id } } }'";
    expect(level(command, ctxFor(own))).toBe("ask");
    expect(reasons(command, ctxFor(own))).toContain("addDiscussionComment");
    expect(
      reasons(
        "gh api graphql -f query='query { viewer { login } }'",
        ctxFor(own),
      ),
    ).not.toContain("contributions made with AI");
  });

  test("a local commit to another owner's clone passes", () => {
    expect(level('git commit -m "x"', ctxFor(foreign))).toBe("pass");
  });

  test("the user's own repository passes", () => {
    expect(level("git push origin main", ctxFor(own))).toBe("pass");
    expect(level('git commit -m "x"', ctxFor(own))).toBe("pass");
    expect(reasons("gh pr create --fill", ctxFor(own))).not.toContain(
      "do not own",
    );
  });

  test("reads do not count as contributions", () => {
    expect(level("gh pr view 4", ctxFor(forbidden))).toBe("pass");
    expect(level("git log -1", ctxFor(forbidden))).toBe("pass");
    expect(
      level("gh api repos/alacritty/alacritty/issues", ctxFor(forbidden)),
    ).toBe("pass");
  });

  test("with no gh login, only the catalog applies", () => {
    const ctx = { ...ctxFor(foreign), ghUser: "" };
    expect(level("git push origin main", ctx)).toBe("pass");
    expect(
      level("git push upstream main", { ...ctxFor(forbidden), ghUser: "" }),
    ).toBe("deny");
  });
});
