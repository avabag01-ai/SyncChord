#!/bin/bash
# Build Rust WASM and copy to extension directory
set -e

echo "🔨 Building SyncChord WASM..."
wasm-pack build --target web --out-dir ../extension/wasm --out-name syncchord_wasm

# Clean unnecessary files
rm -f ../extension/wasm/.gitignore
rm -f ../extension/wasm/package.json

echo "✅ WASM built → extension/wasm/"
