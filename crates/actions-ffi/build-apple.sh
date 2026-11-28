#!/bin/sh
# Build the actions engine's C binding for the iOS and Mac apps into
# WorkspaceActionsCore.xcframework, in apple/ or the folder named: the
# iPhone, the Simulator and the Mac, Apple silicon only. Runs on a Mac with
# Xcode and rustup.
#
# A dynamic framework, not a static library: each Rust static library carries
# its own copy of Rust's runtime, and an app that links two (Workspace links
# the .table core and the Markdown editor's already) fails on duplicate
# symbols (table-file-format#712). A framework keeps its runtime to itself.
# The framework's module is `WorkspaceActionsCore`: Swift imports it, and
# `workspace_actions_call` and `workspace_actions_free` are in it.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/apple}
mkdir -p "$out"
out=$(cd "$out" && pwd)
cd "$here"
name=WorkspaceActionsCore
lib=libworkspace_actions_ffi.dylib
min=26.0
targets="aarch64-apple-ios aarch64-apple-ios-sim aarch64-apple-darwin"
rustup target add $targets >/dev/null
for t in $targets; do
  IPHONEOS_DEPLOYMENT_TARGET=$min MACOSX_DEPLOYMENT_TARGET=$min cargo build --release --lib --target "$t"
done
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

plist() { # <path> <platform>
  cat > "$1" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>sh.workspace.actions.core</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleSupportedPlatforms</key><array><string>$2</string></array>
  <key>MinimumOSVersion</key><string>$min</string>
</dict></plist>
PLIST
}
modulemap() { # <dir>
  mkdir -p "$1"
  cat > "$1/module.modulemap" <<MAP
framework module $name {
  header "workspace_actions.h"
  export *
}
MAP
}
flat() { # <dir> <binary> <platform>: an iOS framework
  f="$1/$name.framework"
  mkdir -p "$f/Headers"
  cp "$2" "$f/$name"
  install_name_tool -id "@rpath/$name.framework/$name" "$f/$name"
  cp include/workspace_actions.h "$f/Headers/"
  modulemap "$f/Modules"
  plist "$f/Info.plist" "$3"
}
versioned() { # <dir> <binary>: a Mac framework
  f="$1/$name.framework"
  mkdir -p "$f/Versions/A/Headers" "$f/Versions/A/Resources"
  cp "$2" "$f/Versions/A/$name"
  install_name_tool -id "@rpath/$name.framework/Versions/A/$name" "$f/Versions/A/$name"
  cp include/workspace_actions.h "$f/Versions/A/Headers/"
  modulemap "$f/Versions/A/Modules"
  plist "$f/Versions/A/Resources/Info.plist" MacOSX
  ln -s A "$f/Versions/Current"
  ln -s "Versions/Current/$name" "$f/$name"
  ln -s Versions/Current/Headers "$f/Headers"
  ln -s Versions/Current/Modules "$f/Modules"
  ln -s Versions/Current/Resources "$f/Resources"
}
flat "$work/ios" "target/aarch64-apple-ios/release/$lib" iPhoneOS
flat "$work/ios-sim" "target/aarch64-apple-ios-sim/release/$lib" iPhoneSimulator
versioned "$work/macos" "target/aarch64-apple-darwin/release/$lib"
rm -rf "$out/$name.xcframework"
xcodebuild -create-xcframework \
  -framework "$work/ios/$name.framework" \
  -framework "$work/ios-sim/$name.framework" \
  -framework "$work/macos/$name.framework" \
  -output "$out/$name.xcframework" >/dev/null
echo "$out/$name.xcframework"
