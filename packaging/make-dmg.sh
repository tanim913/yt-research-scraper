#!/bin/bash
# Builds a macOS .app inside a .dmg: packaging/make-dmg.sh <binary> <version> <output.dmg>
set -euo pipefail
bin=$1; ver=$2; out=$3
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
app="$work/dmg/YouTube Research Scraper.app"
mkdir -p "$app/Contents/MacOS"
cp "$bin" "$app/Contents/MacOS/yt-research-scraper-bin"
# The app is a local server, so it needs a window to stop it: open it in Terminal.
cat > "$app/Contents/MacOS/YouTube Research Scraper" <<'LAUNCH'
#!/bin/bash
open -a Terminal "$(cd "$(dirname "$0")" && pwd)/yt-research-scraper-bin"
LAUNCH
chmod +x "$app/Contents/MacOS/"*
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>YouTube Research Scraper</string>
  <key>CFBundleDisplayName</key><string>YouTube Research Scraper</string>
  <key>CFBundleExecutable</key><string>YouTube Research Scraper</string>
  <key>CFBundleIdentifier</key><string>io.github.tanim913.yt-research-scraper</string>
  <key>CFBundleVersion</key><string>$ver</string>
  <key>CFBundleShortVersionString</key><string>$ver</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$app" # ad-hoc: Apple Silicon refuses unsigned code; this is not notarization
ln -s /Applications "$work/dmg/Applications"
hdiutil create -volname "YouTube Research Scraper" -srcfolder "$work/dmg" -ov -format UDZO "$out" >/dev/null
echo "Built $out"
