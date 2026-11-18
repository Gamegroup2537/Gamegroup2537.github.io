#!/usr/bin/env bash
# Kept for convenience; the real build script is tools/build.mjs
cd "$(dirname "$0")/.." && exec node tools/build.mjs "$@"
