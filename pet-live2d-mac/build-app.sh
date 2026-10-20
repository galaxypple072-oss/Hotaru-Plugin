#!/bin/zsh
set -eu
pet_dir="${0:A:h}"
app="$pet_dir/build/Emilia Live2D.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
export CLANG_MODULE_CACHE_PATH="$pet_dir/build/module-cache"
mkdir -p "$CLANG_MODULE_CACHE_PATH"
if command -v pnpm >/dev/null 2>&1; then
  pnpm --dir "$pet_dir" run build
elif command -v npm >/dev/null 2>&1; then
  npm --prefix "$pet_dir" run build
else
  echo 'Install Node.js and pnpm or npm before building the optional pet.' >&2
  exit 1
fi
sdk="$(xcrun --show-sdk-path)"
xcrun swiftc -sdk "$sdk" -target "$(uname -m)-apple-macosx13.0" -O -framework AppKit -framework WebKit "$pet_dir/Live2DPet.swift" -o "$app/Contents/MacOS/emilia-live2d"
cp "$pet_dir/Info.plist" "$app/Contents/Info.plist"
ditto "$pet_dir/dist" "$app/Contents/Resources/web"
codesign --force --sign - "$app"
echo "$app"
