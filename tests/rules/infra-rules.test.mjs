// Infrastructure, dependency, TLS, and test-file rules of the Bash guard.
// Commands are plain strings here; nothing is executed.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { check } from "../../hooks/lib/_bash-rules.mjs";
import { nodeIo } from "../../hooks/lib/_io-node.mjs";

const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-infra-")),
);
execFileSync("git", ["init", "-q", root]);
fs.mkdirSync(path.join(root, "tests"));
fs.mkdirSync(path.join(root, "build"));
fs.writeFileSync(path.join(root, "tests", "a.test.js"), "x\n");
fs.writeFileSync(path.join(root, "build", "out.txt"), "x\n");
execFileSync("git", ["-C", root, "add", "tests/a.test.js", "build/out.txt"]);
fs.writeFileSync(path.join(root, "tests", "untracked.test.js"), "x\n");

const ctx = {
  root,
  cwd: root,
  allowedModels: ["claude-opus-5-5"],
  io: nodeIo(),
};

async function asks(command, c = ctx) {
  return (await check(command, c))
    .filter(([level]) => level === "ask")
    .map(([, reason]) => reason);
}

function withEnv(env, home = root, cwd = root) {
  return { ...ctx, cwd, io: { ...ctx.io, home, env: { ...env } } };
}

describe("infrastructure", () => {
  const ask = [
    "terraform destroy",
    "tofu destroy -auto-approve",
    "terragrunt run-all destroy",
    "terraform apply -destroy",
    "terraform apply -auto-approve",
    "terraform apply --auto-approve",
    "terraform state rm aws_instance.a",
    "terraform state mv a b",
    "terraform state push x.tfstate",
    "pulumi destroy",
    "pulumi up --yes",
    "pulumi up -y",
    "cdk destroy",
    "kubectl delete pod x",
    "kubectl -n prod drain node1",
    "kubectl replace --force -f x.yaml",
    "kubectl apply --prune -f x.yaml",
    "helm uninstall web",
    "helm delete web",
    "helm rollback web 1",
    "aws ec2 terminate-instances --instance-ids i-1",
    "aws --profile p rds delete-db-instance --db-instance-identifier x",
    "aws s3 rm s3://b --recursive",
    "aws s3 rb s3://b --force",
    "gcloud compute instances delete vm",
    "az group delete -n x",
    "fly apps destroy web",
    "flyctl apps destroy web",
    "prisma db push --accept-data-loss",
    "drizzle-kit push --force",
    "bunx drizzle-kit push --force",
  ];
  for (const command of ask)
    test(`asks: ${command}`, async () => {
      expect((await asks(command)).length).toBeGreaterThan(0);
    });

  const pass = [
    "terraform plan",
    "terraform init",
    "terraform validate",
    "terraform fmt",
    "terraform apply",
    "terraform plan -destroy",
    "pulumi up",
    "kubectl get pods",
    "kubectl describe pod x",
    "kubectl apply -f x.yaml",
    "helm install web ./chart",
    "aws s3 ls",
    "aws s3 rm s3://b/key",
    "gcloud compute instances list",
    "fly status",
    "prisma db push",
    "drizzle-kit push",
  ];
  for (const command of pass)
    test(`passes: ${command}`, async () => {
      expect(await asks(command)).toEqual([]);
    });

  test("says when the target is not known", async () => {
    const [reason] = await asks("kubectl delete pod x", withEnv({}));
    expect(reason).toContain("The target is not known");
  });

  test("names the kubectl flags", async () => {
    const [reason] = await asks(
      "kubectl --context prod --namespace web delete pod x",
      withEnv({}),
    );
    expect(reason).toContain("context `prod`");
    expect(reason).toContain("namespace `web`");
  });

  test("names the current context of KUBECONFIG", async () => {
    const file = path.join(root, "kubeconfig");
    fs.writeFileSync(file, "apiVersion: v1\ncurrent-context: staging\n");
    const [reason] = await asks(
      "kubectl delete pod x",
      withEnv({ KUBECONFIG: file }),
    );
    expect(reason).toContain("context `staging`");
  });

  test("names the current context of the home kube config", async () => {
    const home = fs.mkdtempSync(path.join(root, "home-"));
    fs.mkdirSync(path.join(home, ".kube"));
    fs.writeFileSync(
      path.join(home, ".kube", "config"),
      "current-context: minikube\n",
    );
    const [reason] = await asks("helm uninstall web", withEnv({}, home));
    expect(reason).toContain("context `minikube`");
  });

  test("an unreadable kubeconfig changes nothing", async () => {
    const file = path.join(root, "bad-kubeconfig");
    fs.writeFileSync(file, "a: [unclosed\n");
    const [reason] = await asks(
      "kubectl delete pod x",
      withEnv({ KUBECONFIG: file }),
    );
    expect(reason).toContain("The target is not known");
  });

  test("names AWS_PROFILE", async () => {
    const [reason] = await asks(
      "aws ec2 terminate-instances --instance-ids i-1",
      withEnv({ AWS_PROFILE: "prod" }),
    );
    expect(reason).toContain("profile `prod`");
  });

  test("names TF_WORKSPACE and the workspace file", async () => {
    const [fromEnv] = await asks(
      "terraform destroy",
      withEnv({ TF_WORKSPACE: "live" }),
    );
    expect(fromEnv).toContain("workspace `live`");
    const dir = fs.mkdtempSync(path.join(root, "tf-"));
    fs.mkdirSync(path.join(dir, ".terraform"));
    fs.writeFileSync(path.join(dir, ".terraform", "environment"), "dev\n");
    const [fromFile] = await asks("terraform destroy", withEnv({}, root, dir));
    expect(fromFile).toContain("workspace `dev`");
  });
});

describe("new dependencies", () => {
  const ask = [
    ["npm install left-pad", "left-pad"],
    ["npm i -D left-pad", "left-pad"],
    ["pnpm add zod", "zod"],
    ["yarn add zod", "zod"],
    ["bun add zod", "zod"],
    ["pip install requessts", "requessts"],
    ["pip3 install requests", "requests"],
    ["uv pip install requests", "requests"],
    ["uv add httpx", "httpx"],
    ["poetry add httpx", "httpx"],
    ["cargo add serde", "serde"],
    ["go get github.com/x/y", "github.com/x/y"],
    ["gem install rails", "rails"],
    ["composer require a/b", "a/b"],
    ["dotnet add package Newtonsoft.Json", "Newtonsoft.Json"],
  ];
  for (const [command, name] of ask)
    test(`asks: ${command}`, async () => {
      const [reason] = await asks(command);
      expect(reason).toContain(`\`${name}\``);
      expect(reason).toContain("exists");
    });

  test("names each package", async () => {
    const [reason] = await asks("npm install a b");
    expect(reason).toContain("`a`, `b`");
  });

  const pass = [
    "npm install",
    "npm i",
    "npm ci",
    "bun install",
    "bun install --frozen-lockfile",
    "yarn install --immutable",
    "yarn",
    "pnpm install --frozen-lockfile",
    "pip install -r requirements.txt",
    "pip install -e .",
    "pip install --editable .",
    "pip install .",
    "uv pip install -r requirements.txt",
    "uv sync --locked",
    "npm install ./local-pkg",
    "cargo add --path ../x",
    "cargo build",
    "go get ./...",
    "go build",
    "dotnet add reference ../x.csproj",
  ];
  for (const command of pass)
    test(`passes: ${command}`, async () => {
      expect(await asks(command)).toEqual([]);
    });
});

describe("TLS verification", () => {
  const ask = [
    "curl -k https://x",
    "curl --insecure https://x",
    "curl -sk https://x",
    "curl -ks https://x",
    "wget --no-check-certificate https://x",
    "NODE_TLS_REJECT_UNAUTHORIZED=0 node app.js",
    "GIT_SSL_NO_VERIFY=1 git pull",
    "GIT_SSL_NO_VERIFY=true git pull",
    "git config http.sslVerify false",
    "git config --global http.sslVerify false",
    "git -c http.sslVerify=false pull",
    "npm config set strict-ssl false",
    "pip install -r r.txt --trusted-host pypi.org",
  ];
  for (const command of ask)
    test(`asks: ${command}`, async () => {
      const reasons = await asks(command);
      expect(reasons.some((r) => r.includes("TLS verification"))).toBe(true);
    });

  const pass = [
    "curl https://x",
    "curl -sSL https://x",
    "curl -H 'X-Key: k' https://x",
    "curl -HX-Key:k https://x",
    "curl -k https://localhost:8443",
    "wget https://x",
    "NODE_TLS_REJECT_UNAUTHORIZED=1 node app.js",
    "git config http.sslVerify true",
    "git pull",
    "npm config set strict-ssl true",
  ];
  for (const command of pass)
    test(`passes: ${command}`, async () => {
      expect(await asks(command)).toEqual([]);
    });
});

describe("test files", () => {
  const ask = [
    "rm tests/a.test.js",
    "rm -rf tests",
    "git rm tests/a.test.js",
    "git rm -r tests",
    "mv tests/a.test.js old.js",
    "mv tests/a.test.js /tmp",
    "mv -t /tmp tests/a.test.js",
  ];
  for (const command of ask)
    test(`asks: ${command}`, async () => {
      const reasons = await asks(command);
      expect(reasons.some((r) => r.includes("a test file"))).toBe(true);
    });

  const pass = [
    "rm build/out.txt",
    "rm tests/untracked.test.js",
    "mv build/out.txt build/new.txt",
    "mv old.js tests/a.test.js",
    "git rm build/out.txt",
  ];
  for (const command of pass)
    test(`passes: ${command}`, async () => {
      expect(await asks(command)).toEqual([]);
    });

  test("keeps the existing rm finding", async () => {
    const findings = await check("rm -rf tests", ctx);
    expect(findings.some(([l]) => l === "warn")).toBe(true);
  });
});

describe("review fixes", () => {
  const ask = ['pip install ".[dev]"', "pip install .[dev]", "uv add .[dev]"];
  test("an extras spec of the current folder is local", async () => {
    for (const c of ask) expect(await asks(c)).toEqual([]);
  });

  const tlsAsk = [
    "export NODE_TLS_REJECT_UNAUTHORIZED=0",
    "cd x && export NODE_TLS_REJECT_UNAUTHORIZED=0",
    "declare -x GIT_SSL_NO_VERIFY=1",
    "NODE_TLS_REJECT_UNAUTHORIZED=0 vitest",
    "curl -k https://evil.com -H 'X: //localhost/'",
    "python -m pip install x --trusted-host h",
    "python3 -m pip install x --trusted-host h",
  ];
  for (const c of tlsAsk)
    test(`asks: ${c}`, async () => {
      const reasons = await asks(c);
      expect(reasons.some((r) => r.includes("TLS verification"))).toBe(true);
    });

  const asksAny = [
    "npx cdk destroy",
    "npx -y cdk destroy",
    "bunx cdk destroy",
    "pnpx terraform destroy",
    "python -m pip install requessts",
    "python3 -m pip install requessts",
    "kubectl --as admin delete pod x",
    "kubectl -v 6 delete pod x",
    "kubectl --as-group g delete pod x",
    "fly destroy web",
    "flyctl destroy web",
  ];
  for (const c of asksAny)
    test(`asks: ${c}`, async () => {
      expect((await asks(c)).length).toBeGreaterThan(0);
    });

  const pass = [
    "npm install --loglevel silent",
    "pip install --progress-bar off -r r.txt",
    "pip install -U pip",
    "python -m pip install --upgrade pip",
    "kubectl delete pod x --dry-run=client",
    "kubectl delete pod x --dry-run=server",
    "git rm --cached tests/a.test.js",
    "mv tests/a.test.js tests/b.test.js",
    "mv tests/a.test.js tests/old/",
    "mv -t build tests/untracked.test.js",
    "mv -vt build build/out.txt",
    "curl -k https://127.0.0.1:8443 -H 'X: y'",
    "constructor foo",
    "toString",
  ];
  for (const c of pass)
    test(`passes: ${c}`, async () => {
      expect(await asks(c)).toEqual([]);
    });

  test("mv -vt DIR takes the folder as the destination", async () => {
    const reasons = await asks("mv -vt /tmp tests/a.test.js");
    expect(reasons.some((r) => r.includes("a test file"))).toBe(true);
  });

  test("a device as kubeconfig is not read", async () => {
    const [reason] = await asks(
      "kubectl delete pod x",
      withEnv({ KUBECONFIG: "/dev/zero" }),
    );
    expect(reason).toContain("The target is not known");
  });
});

describe("second review fixes", () => {
  const asksAny = [
    "pulumi --stack prod destroy",
    "pulumi -s prod destroy",
    "cdk --profile x destroy",
    "fly -a app destroy",
    "flyctl --app app apps destroy x",
    "terragrunt run-all apply --terragrunt-non-interactive",
    "TF_CLI_ARGS_apply=-auto-approve terraform apply",
    "TF_CLI_ARGS=-auto-approve terraform apply",
    "pnpm -F web add x",
    "pnpm --filter web add x",
    "pnpm -C app add x",
    "yarn workspace web add x",
    "python3.12 -m pip install x",
    "GIT_SSL_NO_VERIFY=yes git pull",
    "npm_config_strict_ssl=false npm ci",
    "git -c http.https://x.sslVerify=false pull",
    "gcloud compute instances delete describe",
    "mv tests tests_old",
  ];
  for (const c of asksAny)
    test(`asks: ${c}`, async () => {
      expect((await asks(c)).length).toBeGreaterThan(0);
    });

  const pass = [
    "pulumi --stack prod preview",
    "cdk --profile x diff",
    "fly -a app status",
    "terragrunt run-all plan",
    "TF_CLI_ARGS_plan=-lock=false terraform apply",
    "pnpm -F web install",
    "yarn workspace web test",
    "python3.12 -m pip install -r r.txt",
    "npm_config_strict_ssl=true npm ci",
    "terraform destroy -help",
    "kubectl delete --help",
    "gcloud compute instances describe delete",
  ];
  for (const c of pass)
    test(`passes: ${c}`, async () => {
      expect(await asks(c)).toEqual([]);
    });

  test("names the real git key", async () => {
    const [r] = await asks('git -c "http.https://x.sslVerify=false" pull');
    expect(r).toContain("http.https://x.sslVerify=false");
  });

  test("mv of a test folder does not say delete", async () => {
    const [r] = await asks("mv tests tests_old");
    expect(r).not.toContain("deletes");
  });
});
