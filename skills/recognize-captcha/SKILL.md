---
name: recognize-captcha
description: Recognize text in a CAPTCHA image using offline OCR (ddddocr-rs). This is a fallback: prefer CloakBrowser to prevent CAPTCHAs from appearing. Use when a text-based challenge appears despite antibot measures.
allowed-tools: Bash(bun */captcha/ddddocr.mjs *)
---

<task>
Read the text in a CAPTCHA image with [ddddocr-rs](https://github.com/mzdk100/ddddocr-rs), a Rust implementation of ddddocr that recognizes CAPTCHA text offline with an ONNX model.
</task>

<approach>
CloakBrowser's job is to keep CAPTCHAs from appearing at all; this OCR tool covers only the rare case where a challenge appears anyway. Do not make CAPTCHA solving your default strategy, because a site that keeps challenging you will keep escalating, and prevention avoids that. Work through these in order:

1. Use CloakBrowser to prevent challenges.
2. Use residential proxies for geographic legitimacy.
3. If a CAPTCHA still appears, try this offline OCR as a last resort.
4. For complex CAPTCHAs (image puzzles, reCAPTCHA v3), ask the user.
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
Recognize a CAPTCHA image from a screenshot or image file. The script prints the result as JSON:

```bash
# From a screenshot or image file
bun ${CLAUDE_PLUGIN_ROOT}/src/captcha/ddddocr.mjs /path/to/captcha.png

# Output:
# {"text": "A3Bx9"}
```

To go from a page to a recognized CAPTCHA, screenshot the page, isolate the CAPTCHA, then recognize it:

```bash
# 1. Take screenshot of CAPTCHA element with agent-browser or CloakBrowser
bun ${CLAUDE_PLUGIN_ROOT}/src/browser/cloakbrowser-launch.mjs \
  --screenshot=/tmp/page.png \
  https://site-with-captcha.com

# 2. If there's a CAPTCHA, crop or screenshot just that element
# 3. Recognize the text
bun ${CLAUDE_PLUGIN_ROOT}/src/captcha/ddddocr.mjs /tmp/captcha.png
```

Crop to the CAPTCHA element before step 3, since the model reads a single challenge image, not a whole page.

From code, import the function (the path is relative to the plugin root):

```javascript
import { recognizeCaptcha } from './src/captcha/ddddocr.mjs';

const result = await recognizeCaptcha('/path/to/captcha.png');
console.log(result.text); // "A3Bx9"
```

</usage>

<configuration>
The user enables this in the plugin settings in either of two ways:

- Set the `CAPTCHA_OCR=ddddocr` environment variable.
- Turn on the `captcha_ocr_ddddocr` option in `/config` under dotclaude (off by default). When it is on, a `<browser_preferences>` note at session start says so.
</configuration>

<limitations>
The OCR works best on simple text CAPTCHAs (alphanumeric characters), and its success rate varies with the CAPTCHA's style and distortion. It does not work on:

- Image selection puzzles (reCAPTCHA v2)
- Invisible challenges (reCAPTCHA v3, hCaptcha)
- Audio CAPTCHAs
- Slider/puzzle CAPTCHAs

For these, ask the user to complete the challenge manually, or use `--auto-connect` with agent-browser so they can solve it in their own browser.
</limitations>

<why_offline>
Offline OCR is the fallback of choice because it is:

- **Fast**: it runs locally, with no network latency.
- **Private**: images never leave the machine.
- **Free**: there are no per-solve costs.
- **Self-contained**: it works offline after the model download.

Still, the best CAPTCHA is the one that never appears, so reach for CloakBrowser first.
</why_offline>
