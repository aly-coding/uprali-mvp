#!/usr/bin/env bash
# Builds contract/res/uprali_ledger.wasm with Rust 1.81, the last release whose wasm
# output NEAR accepts without extra flags. Test-only dependencies are left out
# because some of them need a newer Cargo than 1.81 can parse.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(mktemp -d)"
rustup toolchain install 1.81.0 --profile minimal --target wasm32-unknown-unknown >/dev/null
cp -r "$ROOT/contract/src" "$BUILD/"
mkdir -p "$BUILD/.cargo" && cp "$ROOT/contract/.cargo/config.toml" "$BUILD/.cargo/"
sed '/\[dev-dependencies\]/,+1d' "$ROOT/contract/Cargo.toml" > "$BUILD/Cargo.toml"
( cd "$BUILD" && cargo +stable generate-lockfile -q && cargo +1.81.0 build --release --target wasm32-unknown-unknown -q )
mkdir -p "$ROOT/contract/res"
cp "$BUILD/target/wasm32-unknown-unknown/release/uprali_ledger.wasm" "$ROOT/contract/res/"
sha256sum "$ROOT/contract/res/uprali_ledger.wasm"
