# Guard Asks

Part of the [hooks](hooks.md) page of the [dotclaude documentation](README.md).
These asks belong to the Bash guard and the Edit guard, and they came in 0.19.0.
Each one is an ask, never a deny.
Turn them off with `guard_bash` or `guard_edit`.

## Bash Guard Asks

**What:** asks before an infrastructure command that destroys resources or
applies changes with no review.
Examples are `terraform destroy`, `terraform apply -auto-approve`,
`pulumi destroy`, `cdk destroy`, `kubectl delete`, `helm uninstall`,
`aws s3 rm --recursive`, `gcloud … delete`, `az … delete`, and
`fly apps destroy`.
The reason names the target when a file or flag shows it.
The target is the Kubernetes context and namespace, the `AWS_PROFILE` or
`--profile`, or the Terraform workspace.
When no target shows, the reason says that the target is not known.

**Why:** the same command can hit a test account or production, and the
command line does not say which.
A destroy cannot be undone.
The reason lets you check the target before you approve.

**What:** asks before a command adds a new dependency, such as
`npm install <name>`, `pip install <name>`, `uv add`, `cargo add`, or
`go get`.
The reason names each package.
A bare install, a requirements file, an editable install, and a lockfile
install pass.

**Why:** a model can name a package that does not exist, and an attacker can
publish a package under such a name.
The reason asks Claude to check that the package exists, that its name is
spelled correctly, and that the task needs it.

**What:** asks before a command turns off TLS checks, such as `curl -k`,
`wget --no-check-certificate`, `NODE_TLS_REJECT_UNAUTHORIZED=0`,
`GIT_SSL_NO_VERIFY`, `git config http.sslVerify false`, and
`pip --trusted-host`.

**Why:** without the check, an attacker on the network can read or change the
data.
A certificate problem has a cause that Claude can fix, or that you can
accept on purpose.

**What:** asks before `rm`, `git rm`, or `mv` removes a tracked test file.
A `mv` to another test path is a rename and passes.
A file that git does not track passes.
When you approve one of these asks, the tool runs, and the other test deletions
pass until your next message.
Your next message ends the approval.

**Why:** a deleted test can hide a failure, as a removed assertion does.
The [Edit guard](hooks.md#edit-guard-guard_edit) covers edits to a test, and this ask
covers the shell commands that remove the whole file.

**What:** the database reset ask also covers
`prisma db push --accept-data-loss` and `drizzle-kit push --force`.
It already covered `dropdb`, `prisma migrate reset`, and similar commands.

**Why:** both flags let the tool drop data to make the schema match.

## Edit Guard Asks

**What:** asks when an edit adds a proof escape in a `.lean`, `.v`, `.thy`,
`.agda`, or `.idr` file.
The escapes are `sorry`, `admit`, `Admitted`, `axiom`, `postulate`, and
`native_decide`.
The guard ignores comments, and it counts only escapes that the edit adds.

**Why:** these tokens make the checker accept a step that nobody proved.
The reason tells Claude to finish the proof, or to name the open step.

**What:** asks when an edit turns off TLS checks in code, for example
`verify=False`, `rejectUnauthorized: false`, or `InsecureSkipVerify: true`.
It applies to source files, shell scripts, YAML, and `.env` files.
It counts only the settings that the edit adds.

**Why:** the same reason as the Bash ask for `curl -k`.
Code that skips the check keeps skipping it after the session.
