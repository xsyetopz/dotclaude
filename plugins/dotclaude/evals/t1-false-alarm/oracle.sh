#!/usr/bin/env bash
# The correct code stays unchanged.
set -euo pipefail
git diff --quiet HEAD -- duration.mjs
