#!/usr/bin/env bash
# Build the Rust games to wasm/ (committed, because GitHub Pages has no build step).
set -euo pipefail
cd "$(dirname "$0")"
wasm-pack build --target web --out-dir ../wasm --out-name arcade --release
# wasm-pack drops a .gitignore that would hide the artifact we need to commit
rm -f ../wasm/.gitignore
echo "built -> wasm/arcade_bg.wasm"
