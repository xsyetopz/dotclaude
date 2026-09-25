---
name: recognize-captcha
description: Recognize text in a CAPTCHA image using offline OCR (ddddocr-rs). This is a FALLBACK only - prefer CloakBrowser to prevent CAPTCHAs from appearing. Use when a text-based challenge appears despite antibot measures.
allowed-tools: Bash(bun */captcha/ddddocr.mjs *)
---

# Offline CAPTCHA recognition with ddddocr-rs

This skill uses [ddddocr-rs](https://github.com/mzdk100/ddddocr-rs), a Rust implementation of ddddocr for fast offline CAPTCHA text recognition using an ONNX model.

## Philosophy: Prevention over solving

**CloakBrowser's job is to make CAPTCHAs never appear.** This OCR tool is only for the rare cases where a challenge still appears despite antibot measures.

Do **not** use CAPTCHA solving as the default strategy. The correct approach is:

1. Use CloakBrowser to prevent challenges
2. Use residential proxies for geographic legitimacy
3. If a CAPTCHA still appears, try this offline OCR as a last resort
4. For complex CAPTCHAs (image puzzles, reCAPTCHA v3), ask the user

## Installation

```bash
# Install the ddddocr-rs CLI
cargo install ddddocr-cli

# Download the ONNX model
mkdir -p ~/.local/share/ddddocr
curl -L -o ~/.local/share/ddddocr/ddddocr.onnx \
  https://github.com/mzdk100/ddddocr-rs/raw/main/models/ddddocr.onnx
```

Alternative model locations (checked in order):
- `$DDDDOCR_MODEL_PATH`
- `~/.local/share/ddddocr/ddddocr.onnx`
- `~/.ddddocr/ddddocr.onnx`
- `/usr/local/share/ddddocr/ddddocr.onnx`

## Usage

### Recognize a CAPTCHA image

```bash
# From a screenshot or image file
bun ${CLAUDE_PLUGIN_ROOT}/src/captcha/ddddocr.mjs /path/to/captcha.png

# Output:
# {"text": "A3Bx9"}
```

### Workflow: Screenshot element then recognize

```bash
# 1. Take screenshot of CAPTCHA element with agent-browser or CloakBrowser
bun ${CLAUDE_PLUGIN_ROOT}/src/browser/cloakbrowser-launch.mjs \
  --screenshot=/tmp/page.png \
  https://site-with-captcha.com

# 2. If there's a CAPTCHA, crop or screenshot just that element
# 3. Recognize the text
bun ${CLAUDE_PLUGIN_ROOT}/src/captcha/ddddocr.mjs /tmp/captcha.png
```

### Programmatic usage

```javascript
import { recognizeCaptcha } from './src/captcha/ddddocr.mjs';

const result = await recognizeCaptcha('/path/to/captcha.png');
console.log(result.text); // "A3Bx9"
```

## Configuration

Enable in plugin settings:
- Set `CAPTCHA_OCR=ddddocr` environment variable, or
- In `/config` under dotclaude: set `captcha_ocr` to `ddddocr`

## Limitations

- Works best on simple text CAPTCHAs (alphanumeric characters)
- Success rate varies by CAPTCHA style and distortion
- Does **not** work on:
  - Image selection puzzles (reCAPTCHA v2)
  - Invisible challenges (reCAPTCHA v3, hCaptcha)
  - Audio CAPTCHAs
  - Slider/puzzle CAPTCHAs

For these, ask the user to complete the challenge manually, or use `--auto-connect` with agent-browser to let them solve it in their own browser.

## Why offline OCR?

- **Fast**: Runs locally, no network latency
- **Private**: Images never leave the machine
- **Free**: No per-solve costs
- **No external dependencies**: Works offline after model download

But remember: the best CAPTCHA is the one that never appears. Use CloakBrowser.
