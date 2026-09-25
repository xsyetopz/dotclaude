#!/usr/bin/env bun
// ddddocr-rs offline CAPTCHA OCR for dotclaude.
// Usage: bun src/captcha/ddddocr.mjs <image_path>
//
// This is a FALLBACK only. CloakBrowser should prevent CAPTCHAs from appearing.
// Use this only when a text-based CAPTCHA still appears despite antibot measures.
//
// Environment:
//   DDDDOCR_MODEL_PATH  Path to ddddocr.onnx model (default: ~/.local/share/ddddocr/ddddocr.onnx)
//   CAPTCHA_OCR         Set to "ddddocr" to enable in plugin

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODEL_PATHS = [
  process.env.DDDDOCR_MODEL_PATH,
  path.join(os.homedir(), ".local/share/ddddocr/ddddocr.onnx"),
  path.join(os.homedir(), ".ddddocr/ddddocr.onnx"),
  "/usr/local/share/ddddocr/ddddocr.onnx",
].filter(Boolean);

function findModel() {
  for (const p of MODEL_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Check if ddddocr-rs binary is available.
 */
async function findDdddocrBinary() {
  // Check for pre-built binary
  const binaryNames = ["ddddocr", "ddddocr-cli"];
  for (const name of binaryNames) {
    try {
      const result = await runCommand("which", [name]);
      if (result.stdout.trim()) return result.stdout.trim();
    } catch {}
  }
  return null;
}

/**
 * Recognize text in a CAPTCHA image using ddddocr-rs.
 * @param {string} imagePath - Path to the CAPTCHA image
 * @returns {Promise<{text: string, confidence?: number}>}
 */
export async function recognizeCaptcha(imagePath) {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Image not found: ${absPath}`);
  }

  const binary = await findDdddocrBinary();
  const model = findModel();

  if (binary) {
    // Use native binary (fastest)
    const args = model ? ["--model", model, absPath] : [absPath];
    const result = await runCommand(binary, args);
    return parseResult(result.stdout);
  }

  // Try Rust crate via cargo run (development fallback)
  try {
    const args = ["run", "--release", "--", absPath];
    if (model) args.splice(3, 0, "--model", model);
    const result = await runCommand("cargo", args, {
      cwd: getDdddocrCrateDir(),
    });
    return parseResult(result.stdout);
  } catch {
    throw new Error(`
ddddocr-rs not available. Install with one of:

1. Install pre-built binary:
   cargo install ddddocr-cli
   # or download from https://github.com/mzdk100/ddddocr-rs/releases

2. Download the ONNX model:
   mkdir -p ~/.local/share/ddddocr
   curl -L -o ~/.local/share/ddddocr/ddddocr.onnx \\
     https://github.com/mzdk100/ddddocr-rs/raw/main/models/ddddocr.onnx

For more info: https://github.com/mzdk100/ddddocr-rs
`);
  }
}

function parseResult(output) {
  const text = output.trim();
  // ddddocr-rs outputs just the recognized text
  // Some versions may output JSON with confidence
  try {
    const json = JSON.parse(text);
    return {
      text: json.text || json.result || text,
      confidence: json.confidence,
    };
  } catch {
    return { text };
  }
}

function getDdddocrCrateDir() {
  // Look for local clone of ddddocr-rs
  const candidates = [
    path.join(process.cwd(), "ddddocr-rs"),
    path.join(os.homedir(), "ddddocr-rs"),
    path.join(os.homedir(), ".cargo/registry/ddddocr-rs"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "Cargo.toml"))) return dir;
  }
  return null;
}

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

// CLI entry point
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("ddddocr.mjs")
) {
  const imagePath = process.argv[2];

  if (!imagePath || imagePath === "--help" || imagePath === "-h") {
    console.log(`
ddddocr-rs CAPTCHA OCR for dotclaude

Usage: bun src/captcha/ddddocr.mjs <image_path>

This is a FALLBACK for when CAPTCHAs appear despite CloakBrowser.
Prefer CloakBrowser to prevent challenges from appearing at all.

Requirements:
  1. Install ddddocr-rs: cargo install ddddocr-cli
  2. Download model: curl -L -o ~/.local/share/ddddocr/ddddocr.onnx \\
       https://github.com/mzdk100/ddddocr-rs/raw/main/models/ddddocr.onnx

Environment:
  DDDDOCR_MODEL_PATH  Custom path to ddddocr.onnx
  CAPTCHA_OCR=ddddocr Enable in plugin settings

Success rate varies by CAPTCHA style. Works best on simple text CAPTCHAs.
`);
    process.exit(0);
  }

  recognizeCaptcha(imagePath)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((e) => {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    });
}

export { findDdddocrBinary, findModel };
