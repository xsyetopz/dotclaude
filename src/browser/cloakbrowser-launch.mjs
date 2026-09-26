#!/usr/bin/env bun

// CloakBrowser launcher CLI for dotclaude.
// Usage: bun src/browser/cloakbrowser-launch.mjs [options] [url]
//
// Options:
//   --headless          Run in headless mode (default: false for antibot)
//   --no-humanize       Disable human-like behavior simulation
//   --no-geoip          Disable GeoIP timezone/locale matching
//   --proxy=<url>       Use proxy (enables geoip by default)
//   --profile=<dir>     Persistent profile directory
//   --screenshot=<path> Take screenshot and save to path
//   --wait=<ms>         Wait before screenshot (default: 2000)
//   --eval=<code>       Evaluate JS in page context
//   --output=<format>   Output format: json, text, html (default: json)

import path from "node:path";
import { parseArgs } from "node:util";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true, // --no-humanize, --no-geoip
  options: {
    headless: { type: "boolean", default: false },
    humanize: { type: "boolean", default: true },
    geoip: { type: "boolean", default: true },
    proxy: { type: "string" },
    profile: { type: "string" },
    screenshot: { type: "string" },
    wait: { type: "string", default: "2000" },
    eval: { type: "string" },
    output: { type: "string", default: "json" },
    help: { type: "boolean", short: "h" },
  },
});

if (opts.help) {
  console.log(`
CloakBrowser launcher for dotclaude

Usage: bun src/browser/cloakbrowser-launch.mjs [options] <url>

Options:
  --headless          Run in headless mode (default: false for antibot)
  --no-humanize       Disable human-like behavior
  --no-geoip          Disable GeoIP matching
  --proxy=<url>       Use residential proxy
  --profile=<dir>     Persistent browser profile
  --screenshot=<path> Save screenshot to file
  --wait=<ms>         Wait before actions (default: 2000)
  --eval=<code>       Evaluate JavaScript in page
  --output=<format>   Output: json, text, html (default: json)
  -h, --help          Show this help

Environment:
  CLOAKBROWSER_LICENSE_KEY  License key for CloakBrowser Pro
  BROWSER_BACKEND           Set to "cloakbrowser" to use by default

CloakBrowser uses source-level Chromium patches to evade antibot detection.
It prevents CAPTCHAs from appearing by looking like a real human browser.
`);
  process.exit(0);
}

const url = positionals[0];
if (!url) {
  console.error("Error: URL required");
  process.exit(1);
}

async function main() {
  let launch;
  try {
    const mod = await import("cloakbrowser");
    launch = mod.launch || mod.default?.launch;
  } catch {
    console.error(`
CloakBrowser not installed. Install with:
  bun install cloakbrowser
  # or with GeoIP support:
  bun install cloakbrowser cloakbrowser-geoip

Then set your license key:
  export CLOAKBROWSER_LICENSE_KEY=your-key

Or use the free tier (limited features).
`);
    process.exit(1);
  }

  const licenseKey = process.env.CLOAKBROWSER_LICENSE_KEY;

  const launchOpts = {
    humanize: opts.humanize,
    headless: opts.headless,
    geoip: opts.geoip && opts.proxy != null,
    ...(opts.proxy && { proxy: opts.proxy }),
    ...(opts.profile && { userDataDir: opts.profile }),
    ...(licenseKey && { licenseKey }),
  };

  const browser = await launch(launchOpts);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(parseInt(opts.wait, 10));

    if (opts.eval) {
      const result = await page.evaluate(opts.eval);
      console.log(JSON.stringify({ evalResult: result }));
    }

    if (opts.screenshot) {
      const screenshotPath = path.resolve(opts.screenshot);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`Screenshot saved: ${screenshotPath}`);
    }

    const result = {
      url: page.url(),
      title: await page.title(),
    };

    if (opts.output === "html") {
      result.content = await page.content();
    } else if (opts.output === "text") {
      result.content = await page.evaluate(() => document.body.innerText);
    } else {
      result.content = await page.evaluate(() =>
        document.body.innerText?.slice(0, 5000),
      );
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
