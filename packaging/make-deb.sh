#!/bin/bash
# Builds a .deb: packaging/make-deb.sh <binary> <version> <output.deb>
set -euo pipefail
bin=$1; ver=$2; out=$3
here="$(cd "$(dirname "$0")" && pwd)"
root="$(mktemp -d)"; chmod 755 "$root"; trap 'rm -rf "$root"' EXIT
install -Dm755 "$bin" "$root/usr/bin/yt-research-scraper"
install -Dm644 "$here/icon.svg" "$root/usr/share/icons/hicolor/scalable/apps/yt-research-scraper.svg"
install -Dm644 /dev/stdin "$root/usr/share/applications/yt-research-scraper.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=YouTube Research Scraper
Comment=Build YouTube comment datasets for research
Exec=yt-research-scraper
Icon=yt-research-scraper
Terminal=true
Categories=Education;Science;
DESKTOP
doc="$root/usr/share/doc/yt-research-scraper"
install -Dm644 /dev/stdin "$doc/copyright" <<COPYRIGHT
Upstream-Name: yt-research-scraper
Source: https://github.com/tanim913/yt-research-scraper
License: MIT
 See https://github.com/tanim913/yt-research-scraper/blob/main/LICENSE
COPYRIGHT
printf 'yt-research-scraper (%s) unstable; urgency=low\n\n  * Release %s. See https://github.com/tanim913/yt-research-scraper/releases\n\n -- tanim913 <42853370+tanim913@users.noreply.github.com>  %s\n' "$ver" "$ver" "$(date -R)" | gzip -9n > "$doc/changelog.gz"
chmod 644 "$doc/changelog.gz"
size=$(du -sk "$root" | cut -f1)
install -Dm644 /dev/stdin "$root/DEBIAN/control" <<CONTROL
Package: yt-research-scraper
Version: $ver
Section: science
Priority: optional
Architecture: amd64
Depends: libc6 (>= 2.28), libstdc++6
Recommends: xdg-utils
Installed-Size: $size
Maintainer: tanim913 <42853370+tanim913@users.noreply.github.com>
Homepage: https://github.com/tanim913/yt-research-scraper
Description: Build YouTube comment datasets for research
 Describe the videos you need with rules, review them on a contact sheet,
 and scrape every comment to CSV. Runs locally and pools several API keys.
 Start it from the applications menu or with: yt-research-scraper
CONTROL
dpkg-deb --root-owner-group --build "$root" "$out" >/dev/null
echo "Built $out"
