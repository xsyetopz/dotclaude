// parseYaml gives the same value as Bun.YAML.parse for the block-style subset
// that the frontmatter check and the gh `hosts.yml` reader use, and throws for
// input outside the subset.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { parseYaml } from "../../hooks/lib/_yaml.mjs";

const ROOT = path.resolve(import.meta.dir, "../..");

function frontmatterOf(file) {
  const text = fs.readFileSync(file, "utf8");
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
}

function markdownFiles(dir, name) {
  return fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      if (name && entry.isDirectory())
        return [path.join(ROOT, dir, entry.name, name)];
      return !name && entry.name.endsWith(".md")
        ? [path.join(ROOT, dir, entry.name)]
        : [];
    })
    .filter((file) => fs.existsSync(file));
}

const HOSTS_ONE = `github.com:
    user: octocat
    git_protocol: https
    oauth_token: gho_abc123
`;

const HOSTS_USERS = `github.com:
    users:
        octocat:
            oauth_token: gho_abc123
        other-user:
            oauth_token: gho_def456
    git_protocol: ssh
    user: octocat
`;

const HOSTS_MANY = `github.com:
    user: octocat
    git_protocol: https
ghe.example.com:
    user: "work.user"
    git_protocol: ssh
    users:
        work.user:
`;

const BLOCKS = `a: |
  x
   y

  z

b: >-
  a
  b

  c
  d
c: |+
  q

d: >
  one
  two

   indented
  last
e: |-
  keep
f: 1
`;

const CASES = {
  "hosts single host": HOSTS_ONE,
  "hosts users map of maps": HOSTS_USERS,
  "hosts several hosts": HOSTS_MANY,
  "hosts empty users": "github.com:\n    users:\n    user: a\n",
  "hosts users flow map": "github.com:\n  users: {}\n  user: a\n",
  "hosts with comment": "# config\ngithub.com: # host\n  user: a # login\n",
  "hosts with crlf": "github.com:\r\n  user: a\r\n  git_protocol: ssh\r\n",
  "hosts empty file": "",
  "hosts only comment": "# nothing\n",
  "blank text": "   \n\n",
  "nested maps": "a:\n  b:\n    c: 1\n  d: 2\ne: 3\n",
  "sequence of scalars": "- a\n- b\n- c\n",
  "sequence at key indent": "a:\n- 1\n- 2\nb: 3\n",
  "sequence indented": "a:\n  - 1\n  - 2\nb: 3\n",
  "sequence of maps": "a:\n- b: 2\n  c: 3\n- d: 4\n",
  "sequence of maps with dash line":
    "- name: x\n  value: 1\n- name: y\n  value: 2\n",
  "nested sequences": "- - a\n  - b\n- - c\n",
  "empty sequence item": "a:\n-\n  - x\n-\n- y\n",
  "plain scalars": "a: hello world\nb: with-dash\nc: a#b\nd: 'x'\n",
  "single quoted": "a: 'it''s'\nb: ''\nc: 'a: b'\n",
  "double quoted": 'a: "x\\ty\\n"\nb: ""\nc: "say \\"hi\\""\nd: "a: b # c"\n',
  "double quoted escapes": 'a: "\\u0041\\x42\\\\ \\/ \\0 \\e \\_"\n',
  "double quoted multi line": 'a: "x\n  y"\nb: 1\n',
  "plain multi line": "a: x\n  y\n  z\nb: 2\n",
  "booleans and null":
    "a: true\nb: false\nc: null\nd: ~\ne: True\nf: NULL\ng:\n",
  "yaml 1.1 words stay strings": "a: yes\nb: no\nc: on\nd: off\n",
  integers: "a: 1\nb: -3\nc: +4\nd: 0\ne: 010\nf: 0x1F\ng: 0o17\n",
  floats: "a: 1.5\nb: -0.25\nc: 1e3\nd: .5\ne: 2.5E-2\nf: 1.\n",
  "number-like strings": "a: 1_000\nb: 1.2.3\nc: 12abc\nd: v1.0\ne: 1:2\n",
  "version string": "version: 0.17.1\n",
  "date-like value": "date: 2026-10-02\n",
  "comments everywhere":
    "# top\na: 1 # one\n# middle\n\nb:\n  # inner\n  c: 2\n",
  "hash without space": "a: b#c\nb: 'x # y'\n",
  "empty values": "a:\nb:\nc: ''\nd:\n  e:\n",
  "flow sequence": "a: [a, b, c]\nb: []\nc: [1, 2.5, true, null]\n",
  "flow sequence quoted": "a: [\"x, y\", 'z', w]\n",
  "flow nested": "a: [1, [2, 3], {b: 4}]\n",
  "flow map": "a: {x: 1, y: two}\nb: {}\nc: {k: [1, 2], l: {m: n}}\n",
  "flow map empty value": "a: {x, y: 1, z: }\n",
  "flow multi line": "a: [\n  1,\n  2,\n  ]\nb: {x: 1,\n  y: 2}\n",
  "flow top level": "[a, b]",
  "flow in sequence": "- [a, b]\n- {c: d}\n",
  "quoted key with colon": "\"a: b\": 1\n'c: d': 2\n",
  "quoted key with space colon": '"k" : v\n',
  "key with spaces": "key with space: v\nother-key: w\n",
  "numeric keys": "1: a\ntrue: b\n",
  "duplicate keys": "a: 1\na: 2\n",
  "url value": "a: https://example.com:8080/x\nb: git@github.com:o/r\n",
  "value with colon no space": "a: b:c\n",
  "leading document marker": "---\na: 1\nb: 2\n",
  "block scalars": BLOCKS,
  "literal in sequence": "- |\n  a\n  b\n- c\n",
  "literal keep trailing": "a: |+\n  x\n\n\nb: 1\n",
  "literal strip": "a: |-\n  x\n  y\n\nb: 1\n",
  "literal explicit indent": "a: |2\n    x\n",
  "literal empty": "a: |\nb: 1\n",
  "folded in map in sequence": "- k: >\n    a\n    b\n  m: 1\n",
  "block scalar keeps hash": "a: |\n  # not a comment\n  x: y\n",
  "top level scalar": "hello",
  "tab after colon": "a:\tb\n",
  "no trailing newline": "a: 1",
  bom: "\uFEFFa: 1\n",
  "plain with apostrophe": 'a: it\'s here\nb: "q"x\n'.replace('"q"x', "q"),
  "proto key": "__proto__: 1\nb: 2\n",
};

describe("parseYaml matches Bun.YAML", () => {
  for (const [name, text] of Object.entries(CASES)) {
    test(name, () => {
      expect(parseYaml(text)).toStrictEqual(Bun.YAML.parse(text));
    });
  }

  test("special floats", () => {
    const text = "a: .inf\nb: -.inf\nc: .nan\n";
    expect(parseYaml(text)).toStrictEqual(Bun.YAML.parse(text));
  });

  test("a mapping with a key without a value after a sequence", () => {
    const text = "a:\n- 1\nb:\n- 2\nc:\n";
    expect(parseYaml(text)).toStrictEqual(Bun.YAML.parse(text));
  });
});

describe("parseYaml matches Bun.YAML on the frontmatter of this repository", () => {
  const files = [
    ...markdownFiles("agents"),
    ...markdownFiles("skills", "SKILL.md"),
    ...markdownFiles("output-styles"),
  ];

  test("the repository has files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const block = frontmatterOf(file);
    if (block === undefined) continue;
    test(path.relative(ROOT, file), () => {
      expect(parseYaml(block)).toStrictEqual(Bun.YAML.parse(block));
    });
  }
});

describe("parseYaml throws outside the subset", () => {
  const THROWS = {
    anchor: "a: &x 1\nb: 2\n",
    alias: "a: &x 1\nb: *x\n",
    tag: "a: !!str 1\n",
    "custom tag": "a: !custom x\n",
    "two documents": "a: 1\n---\nb: 2\n",
    "document end": "a: 1\n...\n",
    "complex key": "? a\n: b\n",
    "colon in plain value": "a: b: c\n",
    "unclosed flow": "a: [1, 2\n",
    "unclosed quote": 'a: "x\n',
    "bad escape": 'a: "\\q"\n',
    "text after quote": "a: 'x' y\n",
    "bad indent": "a: 1\n  b: 2\n",
    "key after sequence": "- a\nb: 1\n",
  };
  for (const [name, text] of Object.entries(THROWS)) {
    test(name, () => {
      expect(() => parseYaml(text)).toThrow(Error);
    });
  }
});

test("hosts.yml shape gives the login", () => {
  expect(parseYaml(HOSTS_USERS)["github.com"].user).toBe("octocat");
  expect(parseYaml(HOSTS_USERS)["github.com"].users.octocat).toStrictEqual({
    oauth_token: "gho_abc123",
  });
});
