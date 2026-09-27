// The ChatGPT plan behind the Codex CLI login: "plus", "prolite" (Pro 5x), or
// "pro" (Pro 20x). Codex has no command that prints it, so this reads the
// `chatgpt_plan_type` claim from the id_token payload in $CODEX_HOME/auth.json.
// Only that claim leaves this function; tokens are never returned or logged.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function codexPlan() {
  try {
    const auth = JSON.parse(
      fs.readFileSync(path.join(codexHome(), "auth.json"), "utf8"),
    );
    const payload = auth?.tokens?.id_token?.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const plan = claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type;
    return typeof plan === "string" ? plan.toLowerCase() : null;
  } catch {
    return null;
  }
}

// ChatGPT plans grouped by Codex quota (developers.openai.com/codex/pricing):
// "none" has no Codex CLI worth delegating to; "plus" covers Plus and the
// seats that get Plus-sized limits (Team, Standard Business, Enterprise and
// Edu without flexible pricing, usage-based seats); "pro5x" is Pro 5x and the
// $100 self-serve Business plan; "pro20x" is Pro 20x. Unknown plans: null.
const TIERS = {
  guest: "none",
  free: "none",
  go: "none",
  free_workspace: "none",
  plus: "plus",
  team: "plus",
  business: "plus",
  self_serve_business_usage_based: "plus",
  enterprise: "plus",
  hc: "plus",
  ent26: "plus",
  enterprise_cbp_automation: "plus",
  enterprise_cbp_usage_based: "plus",
  edu: "plus",
  education: "plus",
  edu_plus: "plus",
  edu_pro: "plus",
  prolite: "pro5x",
  self_serve_business_prolite: "pro5x",
  pro: "pro20x",
};

export function codexTier(plan) {
  return TIERS[String(plan ?? "").toLowerCase()];
}

function readModel(file) {
  try {
    const value = Bun.TOML.parse(fs.readFileSync(file, "utf8")).model;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The model a Codex run uses when the command line names none: the `-p`
 * profile file's `model`, else the base config.toml's, else null (Codex's
 * own default, which is not knowable offline).
 */
export function configuredModel(profile) {
  const home = codexHome();
  if (profile && /^[\w-]+$/.test(profile)) {
    const fromProfile = readModel(path.join(home, `${profile}.config.toml`));
    if (fromProfile) return fromProfile;
  }
  return readModel(path.join(home, "config.toml"));
}
