---
name: e-escape-all-templates
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Edit, Write, Bash, Glob, Grep]
---
Yesterday's XSS fix for #311 only patched the invite email. Security just sent me a repro on the receipt email: set your customer name to `<img src=x onerror=alert(1)>` and it fires. Please do it properly this time and go through all of the emails, not only the one they reported.

Also, Ana in support says that since yesterday the invite shows "Siobhán O&#39;Brien" instead of the name, so the fix broke something as well.

`npm run preview` renders everything with nasty sample data. Don't commit yet.
