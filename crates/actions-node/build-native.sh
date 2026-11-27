#!/bin/sh
# Build the actions engine's Node binding for this machine, into native/ or
# the folder named. An app's build runs this, so each machine it's built on
# has its own.
set -eu
out=$(realpath -m "${1:-$(dirname "$0")/native}")
cd "$(dirname "$0")"
cargo build --release
platform=$(node -p 'process.platform + "-" + process.arch')
case "$(uname -s)" in Darwin) lib=libworkspace_actions_node.dylib ;; *) lib=libworkspace_actions_node.so ;; esac
mkdir -p "$out"
cp "target/release/$lib" "$out/actions.$platform.node"
echo "$out/actions.$platform.node"
