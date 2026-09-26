// Browser backend factory for dotclaude.
// Selects between stock Playwright, agent-browser CLI, and CloakBrowser based on config.

import { spawn } from "node:child_process";

const FALSE = new Set(["0", "false", "no", "off", ""]);

function optionBool(key, fallback = false) {
  const raw = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`];
  if (raw === undefined) return fallback;
  return !FALSE.has(raw.trim().toLowerCase());
}

/**
 * Get the configured browser backend.
 * Priority: BROWSER_BACKEND env > plugin option > "agent-browser" default
 */
export function getBackend() {
  const env = process.env.BROWSER_BACKEND?.toLowerCase().trim();
  if (env === "cloakbrowser") return "cloakbrowser";
  if (env === "agent-browser") return "agent-browser";
  if (optionBool("cloakbrowser")) return "cloakbrowser";
  return "agent-browser";
}

/**
 * Check if CloakBrowser is available.
 */
export async function isCloakBrowserAvailable() {
  // Check for cloakbrowser Bun package
  try {
    const result = await runCommand("bun", ["list", "cloakbrowser", "--json"], {
      silent: true,
    });
    const data = JSON.parse(result.stdout);
    return data.dependencies?.cloakbrowser != null;
  } catch {
    // Try global install
    try {
      const result = await runCommand(
        "bun",
        ["list", "-g", "cloakbrowser", "--json"],
        { silent: true },
      );
      const data = JSON.parse(result.stdout);
      return data.dependencies?.cloakbrowser != null;
    } catch {
      return false;
    }
  }
}

/**
 * Check if agent-browser CLI is available.
 */
export async function isAgentBrowserAvailable() {
  try {
    await runCommand("which", ["agent-browser"], { silent: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get browser launch options with antibot defaults for CloakBrowser.
 */
export function getCloakBrowserDefaults(userOptions = {}) {
  const defaults = {
    humanize: true,
    headless: false,
    geoip: !!userOptions.proxy,
  };
  return { ...defaults, ...userOptions };
}

/**
 * Build CloakBrowser launch script (JS).
 */
export function buildCloakBrowserScript(options = {}) {
  const opts = getCloakBrowserDefaults(options);
  const licenseKey = process.env.CLOAKBROWSER_LICENSE_KEY || options.licenseKey;

  const optsObj = {
    humanize: opts.humanize,
    headless: opts.headless,
    ...(opts.geoip && { geoip: true }),
    ...(opts.proxy && { proxy: opts.proxy }),
    ...(licenseKey && { licenseKey }),
    ...(opts.userDataDir && { userDataDir: opts.userDataDir }),
  };

  return `
import { launch } from 'cloakbrowser';

const browser = await launch(${JSON.stringify(optsObj, null, 2)});
const page = await browser.newPage();
// Browser and page are now available with Playwright-compatible API
`.trim();
}

/**
 * Run a command and capture output.
 */
function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`${cmd} exited with ${code}: ${stderr}`));
    });
    proc.on("error", reject);
  });
}

export { runCommand };
