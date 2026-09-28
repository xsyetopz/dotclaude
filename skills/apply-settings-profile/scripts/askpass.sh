#!/bin/sh
# SUDO_ASKPASS helper for install-managed.mjs: asks for the admin password in
# a desktop dialog, because Claude Code's Bash tool has no terminal for sudo's
# own prompt. sudo passes its prompt text as $1. Cancel exits non-zero, and
# sudo then gives up without running anything.
#
#   SUDO_ASKPASS=/path/askpass.sh sudo -A "$(command -v bun)" install-managed.mjs --apply

prompt="dotclaude: install the managed-settings lock. ${1:-Password:}"

if [ "$(uname -s)" = Darwin ]; then
  exec osascript \
    -e 'on run argv' \
    -e 'text returned of (display dialog (item 1 of argv) default answer "" with hidden answer with title "sudo" with icon caution buttons {"Cancel", "OK"} default button "OK")' \
    -e 'end run' \
    "$prompt"
fi
if command -v zenity >/dev/null 2>&1; then
  exec zenity --password --title="sudo" --text="$prompt"
fi
if command -v kdialog >/dev/null 2>&1; then
  exec kdialog --title sudo --password "$prompt"
fi
for helper in ssh-askpass ksshaskpass lxqt-openssh-askpass; do
  if command -v "$helper" >/dev/null 2>&1; then
    exec "$helper" "$prompt"
  fi
done
echo "askpass.sh: no password dialog found (osascript, zenity, kdialog, ssh-askpass). Run the sudo command in your own terminal." >&2
exit 1
