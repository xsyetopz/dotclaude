---
name: recognize-captcha
description: "Read a text CAPTCHA image with offline OCR (ddddocr-rs). Use as a fallback when a text CAPTCHA appears despite antibot measures; prefer CloakBrowser, which keeps CAPTCHAs from appearing."
allowed-tools: Bash(bun */captcha/ddddocr.mjs *)
---

<task>
Read the text in a CAPTCHA image with [ddddocr-rs](https://github.com/mzdk100/ddddocr-rs), a Rust implementation of ddddocr that recognizes CAPTCHA text offline with an ONNX model.
</task>

<approach>
The best CAPTCHA is one that never appears, so this OCR covers only the rare challenge that appears anyway. Do not make CAPTCHA solving your default strategy, because a site that keeps challenging you keeps escalating, and prevention avoids that. Work through these in order:

1. Use CloakBrowser to prevent challenges.
2. Use residential proxies for geographic legitimacy.
3. If a CAPTCHA still appears, try this offline OCR as a last resort.
4. For complex CAPTCHAs (image puzzles, reCAPTCHA v3), ask the user.

Offline OCR is the fallback of choice because it runs locally with no network latency, keeps images on the machine, has no per-solve cost, and works offline after the model download.
</approach>

<installation>

```bash
# Install the ddddocr-rs CLI
cargo install ddddocr-cli

# Download the ONNX model
mkdir -p ~/.local/share/ddddocr
curl -L -o ~/.local/share/ddddocr/ddddocr.onnx \
  https://github.com/mzdk100/ddddocr-rs/raw/main/models/ddddocr.onnx
```

The script looks for the model in these locations, in order:

- `$DDDDOCR_MODEL_PATH`
- `~/.local/share/ddddocr/ddddocr.onnx`
- `~/.ddddocr/ddddocr.onnx`
- `/usr/local/share/ddddocr/ddddocr.onnx`
</installation>

<usage>
Recognize a CAPTCHA from a screenshot or image file; the script prints JSON:

```bash
# From a screenshot or image file
bun ${CLAUDE_PLUGIN_ROOT}/src/captcha/ddddocr.mjs /path/to/captcha.png

# Output:
# {"text": "A3Bx9"}
```

From a page, take a screenshot, then crop it to the CAPTCHA element before recognizing it, since the model reads a single challenge image, not a whole page:

```bash
# 1. Take screenshot of CAPTCHA element with agent-browser or CloakBrowser
bun ${CLAUDE_PLUGIN_ROOT}/src/browser/cloakbrowser-launch.mjs \
  --screenshot=/tmp/page.png \
  https://site-with-captcha.com

# 2. If there's a CAPTCHA, crop or screenshot just that element
# 3. Recognize the text
bun ${CLAUDE_PLUGIN_ROOT}/src/captcha/ddddocr.mjs /tmp/captcha.png
```

From code, import the function (the path is relative to the plugin root):

```javascript
import { recognizeCaptcha } from './src/captcha/ddddocr.mjs';

const result = await recognizeCaptcha('/path/to/captcha.png');
console.log(result.text); // "A3Bx9"
```

</usage>

<configuration>
The user enables this with the `CAPTCHA_OCR=ddddocr` environment variable, or with the `captcha_ocr_ddddocr` option in `/config` under dotclaude (off by default). When the option is on, a `<browser_preferences>` note at session start says so.
</configuration>

<limitations>
The OCR works best on simple alphanumeric text CAPTCHAs, and its success rate varies with style and distortion. It does not work on:

- Image selection puzzles (reCAPTCHA v2)
- Invisible challenges (reCAPTCHA v3, hCaptcha)
- Audio CAPTCHAs
- Slider/puzzle CAPTCHAs

For these, ask the user to complete the challenge manually, or use `--auto-connect` with agent-browser so they can solve it in their own browser.
</limitations>
